import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { throwError, of } from 'rxjs';
import { CollectionService } from '../../core/services/collection.service';
import { ClothingItem } from '../../core/models/clothing-item.model';
import { AddToCollectionModalComponent } from './add-to-collection-modal.component';
import { Collection } from '../../core/models/collection.model';

const ITEM: ClothingItem = {
  id: 'item-1',
  imageUrl: '/assets/item-1.jpg',
  tags: [],
  colours: [],
  brand: 'Test Brand',
  category: 'Tops',
  price: null,
  notes: null,
  dateAdded: null,
  wearCount: 0,
  estimatedMarketValue: null,
  purchaseDate: null,
  condition: null,
};

const COLLECTIONS: Collection[] = [
  {
    id: 'c-1',
    ownerId: 'u-1',
    name: 'Wardrobe Favs',
    description: null,
    isPublic: false,
    clothingItemIds: ['item-1'],
    memberUserIds: ['u-1'],
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'c-2',
    ownerId: 'u-1',
    name: 'Seasonal',
    description: 'Cold weather',
    isPublic: true,
    clothingItemIds: [],
    memberUserIds: ['u-1'],
    createdAt: '2026-01-02T00:00:00Z',
  },
];

describe('AddToCollectionModalComponent', () => {
  let component: AddToCollectionModalComponent;
  let fixture: ComponentFixture<AddToCollectionModalComponent>;
  let collectionService: {
    collections: ReturnType<typeof signal>;
    loadAll: ReturnType<typeof vi.fn>;
    addItem: ReturnType<typeof vi.fn>;
  };

  const createFixture = () => {
    fixture = TestBed.createComponent(AddToCollectionModalComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('item', ITEM);
    fixture.detectChanges();
  };

  beforeEach(async () => {
    collectionService = {
      collections: signal(COLLECTIONS),
      loadAll: vi.fn().mockReturnValue(of(COLLECTIONS)),
      addItem: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [AddToCollectionModalComponent],
      providers: [{ provide: CollectionService, useValue: collectionService }],
    }).compileComponents();

    createFixture();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows loading state while loading', () => {
    collectionService.loadAll.mockReturnValue(of(COLLECTIONS));
    (component as any).loading.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Loading collections…');
  });

  it('shows empty state when there are no collections', () => {
    collectionService.collections.set([]);
    collectionService.loadAll.mockReturnValue(of([]));
    fixture = TestBed.createComponent(AddToCollectionModalComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('item', ITEM);
    (component as any).loading.set(false);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('You have no collections yet.');
  });

  it('renders existing collections and marks already-added items', () => {
    collectionService.loadAll.mockReturnValue(of(COLLECTIONS));
    fixture = TestBed.createComponent(AddToCollectionModalComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('item', ITEM);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Wardrobe Favs');
    expect(fixture.nativeElement.textContent).toContain('ADDED');
  });

  it('selects and deselects collections and emits close when saving with nothing selected', () => {
    const closed = vi.fn();
    collectionService.loadAll.mockReturnValue(of(COLLECTIONS));
    collectionService.addItem.mockReturnValue(of(undefined));
    component.closed.subscribe(closed);
    (component as any).selectedIds.set(new Set());

    component.save();

    expect(collectionService.addItem).not.toHaveBeenCalled();
    expect(closed).toHaveBeenCalledTimes(1);
    expect((component as any).saving()).toBe(false);
  });

  it('adds item to all selected collections on save', () => {
    collectionService.loadAll.mockReturnValue(of(COLLECTIONS));
    collectionService.addItem.mockReturnValue(of(undefined));
    const closed = vi.fn();
    component.closed.subscribe(closed);

    (component as any).toggleCollection('c-1');
    (component as any).toggleCollection('c-2');
    component.save();

    expect(collectionService.addItem).toHaveBeenCalledTimes(2);
    expect(collectionService.addItem).toHaveBeenNthCalledWith(1, 'c-1', ITEM.id);
    expect(collectionService.addItem).toHaveBeenNthCalledWith(2, 'c-2', ITEM.id);
    expect(closed).toHaveBeenCalledTimes(1);
    expect((component as any).errorMessage()).toBeNull();
    expect((component as any).saving()).toBe(false);
  });

  it('keeps modal open and shows error when any add fails', () => {
    collectionService.loadAll.mockReturnValue(of(COLLECTIONS));
    collectionService.addItem.mockImplementation((id: string) =>
      id === 'c-2'
        ? throwError(() => new Error('nope'))
        : of(undefined),
    );
    const closed = vi.fn();
    component.closed.subscribe(closed);

    (component as any).toggleCollection('c-1');
    (component as any).toggleCollection('c-2');
    component.save();

    expect(collectionService.addItem).toHaveBeenCalledTimes(2);
    expect(closed).not.toHaveBeenCalled();
    expect((component as any).errorMessage()).toContain('Failed to add item to 1 collection(s).');
  });

  it('closes when clicking the backdrop', () => {
    const closed = vi.fn();
    component.closed.subscribe(closed);

    const target = document.createElement('div');
    component.onBackdropClick({ target, currentTarget: target } as unknown as MouseEvent);

    expect(closed).toHaveBeenCalledTimes(1);
  });
});
