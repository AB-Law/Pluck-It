import { ComponentFixture, TestBed } from '@angular/core/testing';
import { throwError, of } from 'rxjs';
import { CreateCollectionModalComponent } from './create-collection-modal.component';
import { CollectionService } from '../../core/services/collection.service';
import { Collection } from '../../core/models/collection.model';
import { WritableSignal } from '@angular/core';

describe('CreateCollectionModalComponent', () => {
  let fixture: ComponentFixture<CreateCollectionModalComponent>;
  let component: CreateCollectionModalComponent;
  let collectionService: { create: ReturnType<typeof vi.fn> };
  type CreateCollectionModalComponentInternals = {
    saving: WritableSignal<boolean>;
    error: WritableSignal<string | null>;
    save: () => void;
    onBackdropClick: (event: MouseEvent) => void;
  };
  const asInternal = (): CreateCollectionModalComponentInternals =>
    component as unknown as CreateCollectionModalComponentInternals;

  const CREATED: Collection = {
    id: 'c-1',
    ownerId: 'user',
    name: 'Spring Capsule',
    description: null,
    isPublic: false,
    clothingItemIds: [],
    memberUserIds: [],
    createdAt: '2026-03-11T00:00:00Z',
  };

  beforeEach(async () => {
    collectionService = { create: vi.fn() };
    await TestBed.configureTestingModule({
      imports: [CreateCollectionModalComponent],
      providers: [{ provide: CollectionService, useValue: collectionService }],
    }).compileComponents();

    fixture = TestBed.createComponent(CreateCollectionModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('does not emit created when name is empty', () => {
    component.name = '   ';
    let emitted = false;
    component.created.subscribe(() => { emitted = true; });

    component.save();

    expect(collectionService.create).not.toHaveBeenCalled();
    expect(emitted).toBe(false);
  });

  it('creates collection and emits created output on success', () => {
    collectionService.create.mockReturnValue(of(CREATED));
    let emitted: Collection | null = null;
    component.created.subscribe((value) => { emitted = value; });
    component.name = 'Summer';
    component.description = 'A set';
    component.isPublic = true;

    component.save();
    fixture.detectChanges();

    expect(collectionService.create).toHaveBeenCalledWith({
      name: 'Summer',
      description: 'A set',
      isPublic: true,
      clothingItemIds: [],
    });
    expect(emitted).toEqual(CREATED);
    expect(asInternal().saving()).toBe(false);
  });

  it('surfaces an error message when create fails', () => {
    collectionService.create.mockReturnValue(throwError(() => new Error('failed')));
    component.name = 'Summer';

    component.save();
    fixture.detectChanges();

    expect(asInternal().error()).toBe('Failed to create collection. Please try again.');
    expect(asInternal().saving()).toBe(false);
  });

  it('emits cancelled when backdrop click occurs on backdrop', () => {
    let cancelled = 0;
    component.cancelled.subscribe(() => { cancelled += 1; });
    const target = { id: 'target' } as HTMLElement;
    const backdropEvent = new MouseEvent('click');
    Object.defineProperty(backdropEvent, 'target', { value: target });
    Object.defineProperty(backdropEvent, 'currentTarget', { value: target });
    component.onBackdropClick(backdropEvent);
    expect(cancelled).toBe(1);
  });

  it('does not emit cancelled for clicks inside dialog', () => {
    let cancelled = 0;
    component.cancelled.subscribe(() => { cancelled += 1; });
    const target = { id: 'child' } as HTMLElement;
    const currentTarget = { id: 'container' } as HTMLElement;
    const backdropEvent = new MouseEvent('click');
    Object.defineProperty(backdropEvent, 'target', { value: target });
    Object.defineProperty(backdropEvent, 'currentTarget', { value: currentTarget });
    component.onBackdropClick(backdropEvent);
    expect(cancelled).toBe(0);
  });
});
