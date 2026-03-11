import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { CollectionsComponent } from './collections.component';
import { CollectionService } from '../../core/services/collection.service';
import { WardrobeService } from '../../core/services/wardrobe.service';
import { AuthService } from '../../core/services/auth.service';
import { Observable, of } from 'rxjs';
import { signal } from '@angular/core';
import { Collection } from '../../core/models/collection.model';
import { ClothingItem } from '../../core/models/clothing-item.model';

describe('CollectionsComponent', () => {
  let component: CollectionsComponent;
  let fixture: ComponentFixture<CollectionsComponent>;
  let router: { navigate: ReturnType<typeof vi.fn> };
  let authUser: ReturnType<typeof signal>;
  let collectionService: {
    collections: ReturnType<typeof signal<Collection[]>>,
    loadAll: ReturnType<typeof vi.fn>,
    delete: ReturnType<typeof vi.fn>,
    join: ReturnType<typeof vi.fn>,
    leave: ReturnType<typeof vi.fn>,
    removeItem: ReturnType<typeof vi.fn>,
  };
  let wardrobeService: { getAll: ReturnType<typeof vi.fn> };
  let route: { snapshot: { queryParamMap: ReturnType<typeof convertToParamMap> }; queryParamMap: any };

  const COLLECTION: Collection = {
    id: 'c-1',
    ownerId: 'user-1',
    name: 'Daily',
    description: 'A set',
    isPublic: true,
    clothingItemIds: ['item-1'],
    memberUserIds: [],
    createdAt: '2026-03-11T00:00:00Z',
  };
  const ITEM: ClothingItem = {
    id: 'item-1',
    imageUrl: '/img/1.png',
    tags: [],
    colours: [],
    brand: 'Uniqlo',
    category: 'Shirt',
    price: { amount: 10, originalCurrency: 'USD' },
    notes: null,
    dateAdded: '2026-03-11T00:00:00Z',
    wearCount: 1,
    estimatedMarketValue: 10,
    purchaseDate: null,
    condition: 'New',
  };

  beforeEach(async () => {
    collectionService = {
      collections: signal<Collection[]>([]),
      loadAll: vi.fn(() => {
        collectionService.collections.set([COLLECTION]);
        return of([COLLECTION]);
      }),
      delete: vi.fn().mockReturnValue(of({})),
      join: vi.fn().mockReturnValue(of(COLLECTION)),
      leave: vi.fn().mockReturnValue(of({})),
      removeItem: vi.fn().mockReturnValue(of({})),
    };
    wardrobeService = {
      getAll: vi.fn().mockReturnValue(of({ items: [ITEM], pageInfo: {} })),
    };
    route = {
      snapshot: { queryParamMap: convertToParamMap({}) },
      queryParamMap: of(convertToParamMap({})),
    };
    router = { navigate: vi.fn() };
    authUser = signal(null);

    await TestBed.configureTestingModule({
      imports: [CollectionsComponent],
      providers: [
        { provide: ActivatedRoute, useValue: route },
        { provide: Router, useValue: router },
        { provide: CollectionService, useValue: collectionService },
        { provide: WardrobeService, useValue: wardrobeService },
        { provide: AuthService, useValue: { user: authUser } },
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(CollectionsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('loads collections on init and removes loading indicator', () => {
    expect((component as any).loading()).toBe(false);
    expect(component.collections()).toEqual([COLLECTION]);
  });

  it('selecting a collection loads wardrobe items for that collection', () => {
    component.selectCollection(COLLECTION);
    expect(wardrobeService.getAll).toHaveBeenCalledWith({ pageSize: 200 });
    expect(component.collectionItems()).toEqual([ITEM]);
    expect((component as any).activeCollection()?.id).toBe('c-1');
  });

  it('handles create flow and selected collection', () => {
    component.onCollectionCreated(COLLECTION);
    expect((component as any).showCreateModal()).toBe(false);
    expect((component as any).activeCollection()?.id).toBe('c-1');
  });

  it('copies share link with optimistic label updates', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    component.copyShareLink(COLLECTION);
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith(`${globalThis.location.origin}/collections?join=c-1`);
    expect((component as any).shareLabel()).toBe('Copied!');
    vi.advanceTimersByTime(2000);
    expect((component as any).shareLabel()).toBe('Copy Link');
  });

  it('prevents destructive actions unless confirmed and removes items when removed from collection', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    component.deleteCollection(COLLECTION);
    expect(collectionService.delete).not.toHaveBeenCalled();

    component.selectCollection(COLLECTION);
    (component as any).collectionItemsMap.set({ 'c-1': [ITEM] });
    component.removeItemFromCollection(COLLECTION, 'item-1');
    expect(wardrobeService.getAll).toHaveBeenCalledTimes(1);
    expect(collectionService.removeItem).toHaveBeenCalledWith('c-1', 'item-1');
  });

  it('loads shared collections from query param and selects the joined collection', () => {
    route.snapshot.queryParamMap = convertToParamMap({ join: 'c-1' });
    route.queryParamMap = of(convertToParamMap({ join: 'c-1' }));
    collectionService.join = vi.fn().mockReturnValue(of(COLLECTION));
    collectionService.loadAll = vi.fn()
      .mockReturnValueOnce(of([COLLECTION]))
      .mockReturnValueOnce(of([COLLECTION]));

    fixture = TestBed.createComponent(CollectionsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    expect(collectionService.join).toHaveBeenCalledWith('c-1');
    expect((component as any).activeCollection()?.id).toBe('c-1');
    expect(router.navigate).toHaveBeenCalledWith([], { queryParams: {} });
  });

  it('renders loading state before collections are loaded', () => {
    collectionService.loadAll = vi.fn().mockReturnValue(new Observable(() => {}));
    fixture = TestBed.createComponent(CollectionsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Loading…');
  });

  it('renders empty state when no collections exist', () => {
    collectionService.collections.set([]);
    collectionService.loadAll = vi.fn().mockReturnValue(of([]));

    fixture = TestBed.createComponent(CollectionsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('No collections yet.');
    expect(fixture.nativeElement.textContent).toContain('Create one');
  });

  it('computes ownership based on current auth user', () => {
    authUser.set({ name: 'Owner', email: 'owner@x.com', userId: 'user-1' });
    expect(component.isOwner(COLLECTION)).toBe(true);

    authUser.set({ name: 'Other', email: 'other@x.com', userId: 'user-2' });
    expect(component.isOwner(COLLECTION)).toBe(false);
  });

  it('does not re-fetch collection items when there are none', () => {
    const before = wardrobeService.getAll.mock.calls.length;
    component.selectCollection({ ...COLLECTION, clothingItemIds: [] });
    expect(wardrobeService.getAll).toHaveBeenCalledTimes(before);
  });

  it('confirms destructive operations and clears active collection on leave/delete', () => {
    component.selectCollection(COLLECTION);
    const confirmSpy = vi.spyOn(window, 'confirm');
    confirmSpy.mockReturnValue(false);
    component.deleteCollection(COLLECTION);
    component.leaveCollection(COLLECTION);
    expect(collectionService.delete).not.toHaveBeenCalled();
    expect(collectionService.leave).not.toHaveBeenCalled();
    expect((component as any).activeCollection()).toEqual(COLLECTION);

    confirmSpy.mockReturnValue(true);
    component.deleteCollection(COLLECTION);
    component.leaveCollection(COLLECTION);
    expect(collectionService.delete).toHaveBeenCalledWith('c-1');
    expect(collectionService.leave).toHaveBeenCalledWith('c-1');
    expect((component as any).activeCollection()).toBeNull();
  });

  it('renders owner and non-owner collection actions appropriately', () => {
    const richMembers: Collection = {
      ...COLLECTION,
      memberUserIds: ['u-a', 'u-b', 'u-c', 'u-d', 'u-e', 'u-f', 'u-g', 'u-h', 'u-i', 'u-j'],
    };

    collectionService.collections.set([richMembers]);
    collectionService.loadAll = vi.fn().mockReturnValue(of([richMembers]));
    authUser.set({ name: 'Owner', email: 'owner@x.com', userId: 'user-1' });

    fixture = TestBed.createComponent(CollectionsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    component.selectCollection(richMembers);
    fixture.detectChanges();

    const ownerText = fixture.nativeElement.textContent;
    expect(ownerText).toContain('Copy Link');
    expect(ownerText).toContain('Delete');
    expect(ownerText).toContain('+3');

    authUser.set({ name: 'Guest', email: 'guest@x.com', userId: 'user-2' });
    fixture = TestBed.createComponent(CollectionsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    component.selectCollection(richMembers);
    fixture.detectChanges();

    const guestText = fixture.nativeElement.textContent;
    expect(guestText).toContain('Leave');
    expect(guestText).not.toContain('Delete');
  });

  it('renders empty collection state and create modal block', () => {
    const emptyItemsCollection: Collection = {
      ...COLLECTION,
      clothingItemIds: [],
    };
    collectionService.collections.set([emptyItemsCollection]);
    collectionService.loadAll = vi.fn().mockReturnValue(of([emptyItemsCollection]));

    fixture = TestBed.createComponent(CollectionsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    component.selectCollection(emptyItemsCollection);
    fixture.detectChanges();

    expect((component as any).collectionItems()).toEqual([]);
    expect(fixture.nativeElement.textContent).toContain('No items in this collection yet.');

    (component as any).showCreateModal.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-create-collection-modal')).toBeTruthy();
  });
});
