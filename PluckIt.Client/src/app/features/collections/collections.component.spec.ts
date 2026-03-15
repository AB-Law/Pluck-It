import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { CollectionsComponent } from './collections.component';
import { CollectionService } from '../../core/services/collection.service';
import { WardrobeService } from '../../core/services/wardrobe.service';
import { AuthService } from '../../core/services/auth.service';
import { Observable, of } from 'rxjs';
import { signal, WritableSignal } from '@angular/core';
import { Collection } from '../../core/models/collection.model';
import { ClothingItem } from '../../core/models/clothing-item.model';
import { MobileNavState } from '../../shared/layout/mobile-nav.state';

describe('CollectionsComponent', () => {
  let component: CollectionsComponent;
  let fixture: ComponentFixture<CollectionsComponent>;
  let router: {
    navigate: ReturnType<typeof vi.fn>;
    createUrlTree: ReturnType<typeof vi.fn>;
    serializeUrl: ReturnType<typeof vi.fn>;
    isActive: ReturnType<typeof vi.fn>;
  };
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
  let route: {
    snapshot: { queryParamMap: ReturnType<typeof convertToParamMap> };
    queryParamMap: Observable<ReturnType<typeof convertToParamMap>>;
  };
  let mobileNavState: MobileNavState;
  type CollectionsComponentInternals = CollectionsComponent & {
    loading: () => boolean;
    activeCollection: WritableSignal<Collection | null>;
    showCreateModal: WritableSignal<boolean>;
    shareLabel: WritableSignal<string>;
    collectionItemsMap: WritableSignal<Record<string, ClothingItem[]>>;
    settingsOpen: WritableSignal<boolean>;
    collectionItems: () => ClothingItem[];
    closeSettingsPanel: () => void;
    openSettings: () => void;
    onWindowResize: () => void;
    selectCollection: (col: Collection) => void;
  };
  const asInternal = (): CollectionsComponentInternals =>
    component as unknown as CollectionsComponentInternals;

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
    router = {
      navigate: vi.fn(),
      createUrlTree: vi.fn((commands: unknown) => ({
        toString: () => (typeof commands === 'string' ? commands : `/${(commands as unknown[]).join('/')}`),
      })),
      serializeUrl: vi.fn((tree: { toString: () => string }) => tree.toString()),
      isActive: vi.fn(() => false),
    };
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
    mobileNavState = TestBed.inject(MobileNavState);
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    mobileNavState.closePanel();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('loads collections on init and removes loading indicator', () => {
    expect(asInternal().loading()).toBe(false);
    expect(component.collections()).toEqual([COLLECTION]);
  });

  it('selecting a collection loads wardrobe items for that collection', () => {
    component.selectCollection(COLLECTION);
    expect(wardrobeService.getAll).toHaveBeenCalledWith({ pageSize: 200 });
    expect(component.collectionItems()).toEqual([ITEM]);
    expect(asInternal().activeCollection()?.id).toBe('c-1');
  });

  it('handles create flow and selected collection', () => {
    component.onCollectionCreated(COLLECTION);
    expect(asInternal().showCreateModal()).toBe(false);
    expect(asInternal().activeCollection()?.id).toBe('c-1');
  });

  it('copies share link with optimistic label updates', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    component.copyShareLink(COLLECTION);
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith(`${globalThis.location.origin}/collections?join=c-1`);
    expect(asInternal().shareLabel()).toBe('Copied!');
    vi.advanceTimersByTime(2000);
    expect(asInternal().shareLabel()).toBe('Copy Link');
  });

  it('prevents destructive actions unless confirmed and removes items when removed from collection', () => {
    vi.spyOn(globalThis, 'confirm').mockReturnValue(false);
    component.deleteCollection(COLLECTION);
    expect(collectionService.delete).not.toHaveBeenCalled();

    component.selectCollection(COLLECTION);
    asInternal().collectionItemsMap.set({ 'c-1': [ITEM] });
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
    expect(asInternal().activeCollection()?.id).toBe('c-1');
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
    const confirmSpy = vi.spyOn(globalThis, 'confirm');
    confirmSpy.mockReturnValue(false);
    component.deleteCollection(COLLECTION);
    component.leaveCollection(COLLECTION);
    expect(collectionService.delete).not.toHaveBeenCalled();
    expect(collectionService.leave).not.toHaveBeenCalled();
    expect(asInternal().activeCollection()).toEqual(COLLECTION);

    confirmSpy.mockReturnValue(true);
    component.deleteCollection(COLLECTION);
    component.leaveCollection(COLLECTION);
    expect(collectionService.delete).toHaveBeenCalledWith('c-1');
    expect(collectionService.leave).toHaveBeenCalledWith('c-1');
    expect(asInternal().activeCollection()).toBeNull();
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

    expect(asInternal().collectionItems()).toEqual([]);
    expect(fixture.nativeElement.textContent).toContain('No items in this collection yet.');

    asInternal().showCreateModal.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-create-collection-modal')).toBeTruthy();
  });

  it('routes settings open to shell profile panel on mobile and local panel on desktop', () => {
    Object.defineProperty(globalThis.window, 'innerWidth', { value: 390, configurable: true });
    asInternal().onWindowResize();
    mobileNavState.closePanel();
    asInternal().openSettings();
    expect(mobileNavState.activePanel()).toBe('profile');
    expect(asInternal().settingsOpen()).toBe(false);

    mobileNavState.closePanel();
    Object.defineProperty(globalThis.window, 'innerWidth', { value: 1200, configurable: true });
    asInternal().onWindowResize();
    asInternal().openSettings();
    expect(asInternal().settingsOpen()).toBe(true);
    expect(mobileNavState.activePanel()).toBe('none');
  });

  it('restores main focus target after settings panel close', async () => {
    const focusSpy = vi.spyOn(
      fixture.nativeElement.querySelector('[aria-label="Collection details"]') as HTMLElement,
      'focus',
    );

    asInternal().settingsOpen.set(true);
    asInternal().closeSettingsPanel();

    await Promise.resolve();
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('clears stale mobile panel before opening settings', () => {
    Object.defineProperty(globalThis.window, 'innerWidth', { value: 390, configurable: true });
    asInternal().onWindowResize();
    mobileNavState.openDigest();
    const closeSpy = vi.spyOn(mobileNavState, 'closePanel');

    asInternal().openSettings();

    expect(closeSpy).toHaveBeenCalled();
    expect(mobileNavState.activePanel()).toBe('profile');
  });
});
