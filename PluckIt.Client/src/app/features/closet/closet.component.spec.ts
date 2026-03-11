import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, ParamMap, Router, convertToParamMap } from '@angular/router';
import { of, throwError } from 'rxjs';
import { WardrobeComponent } from './closet.component';
import { WardrobeService } from '../../core/services/wardrobe.service';
import { ClothingItem } from '../../core/models/clothing-item.model';

describe('WardrobeComponent', () => {
  let component: WardrobeComponent;
  let fixture: ComponentFixture<WardrobeComponent>;
  let wardrobeService: {
    getAll: ReturnType<typeof vi.fn>;
    getDrafts: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    uploadForDraft: ReturnType<typeof vi.fn>;
    retryDraft: ReturnType<typeof vi.fn>;
    dismissDraft: ReturnType<typeof vi.fn>;
    acceptDraft: ReturnType<typeof vi.fn>;
  };
  let router: { navigate: ReturnType<typeof vi.fn> };
  let route: { snapshot: { queryParamMap: ParamMap }; queryParamMap: any };

  const BASE_ITEM: ClothingItem = {
    id: 'item-1',
    imageUrl: 'img.jpg',
    tags: ['minimal'],
    colours: [{ name: 'Black', hex: '#000' }],
    brand: 'Acme',
    category: 'Tops',
    price: null,
    notes: null,
    dateAdded: null,
    wearCount: 1,
    estimatedMarketValue: 120,
    purchaseDate: null,
    condition: null,
  };

  const READY_DRAFT: ClothingItem = {
    ...BASE_ITEM,
    id: 'draft-1',
    draftStatus: 'Ready',
    category: 'Outerwear',
  };

  const PROCESSING_DRAFT: ClothingItem = {
    ...BASE_ITEM,
    id: 'draft-2',
    draftStatus: 'Processing',
    category: 'Dresses',
  };

  beforeEach(async () => {
    wardrobeService = {
      getAll: vi.fn().mockReturnValue(of({ items: [BASE_ITEM], pageInfo: {}, nextContinuationToken: 'next-1' })),
      getDrafts: vi.fn().mockReturnValue(of({ items: [READY_DRAFT] })),
      update: vi.fn().mockReturnValue(of({})),
      delete: vi.fn().mockReturnValue(of({})),
      uploadForDraft: vi.fn().mockReturnValue(of({ ...READY_DRAFT, draftStatus: 'Processing' })),
      retryDraft: vi.fn().mockReturnValue(of({ ...BASE_ITEM, draftStatus: 'Processing' })),
      dismissDraft: vi.fn().mockReturnValue(of({})),
      acceptDraft: vi.fn().mockReturnValue(of(READY_DRAFT)),
    };
    router = { navigate: vi.fn() };
    route = {
      snapshot: { queryParamMap: convertToParamMap({}) },
      queryParamMap: of(convertToParamMap({})),
    };

    await TestBed.configureTestingModule({
      imports: [WardrobeComponent],
      providers: [
        { provide: ActivatedRoute, useValue: route },
        { provide: WardrobeService, useValue: wardrobeService },
        { provide: Router, useValue: router },
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(WardrobeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('loads items and drafts on init', () => {
    expect(wardrobeService.getAll).toHaveBeenCalledTimes(1);
    expect(wardrobeService.getDrafts).toHaveBeenCalledTimes(1);
    expect(component.allItems()).toHaveLength(1);
    expect(component.serverOnlyDrafts()).toHaveLength(1);
  });

  it('builds upload query via selectCategory and pushes URL updates', () => {
    component.selectCategory('Outerwear');
    expect(component['selectedCategory']()).toBe('Outerwear');
    expect(wardrobeService.getAll).toHaveBeenCalledTimes(2);
    expect(router.navigate).toHaveBeenCalledWith([], expect.objectContaining({
      queryParams: { category: 'Outerwear', sortField: null, sortDir: null },
      replaceUrl: true,
    }));
  });

  it('rebuilds query on sort change', () => {
    component.onSortChange('wearCount:asc');
    expect(component['sortField']()).toBe('wearCount');
    expect(component['sortDir']()).toBe('asc');
    expect(wardrobeService.getAll).toHaveBeenCalledTimes(2);
  });

  it('does not load more when continuation token is missing', () => {
    component['loadingMore'].set(false);
    component['nextToken'].set(null);
    component.loadMore();
    expect(wardrobeService.getAll).toHaveBeenCalledTimes(1);
    expect(component['loadingMore']()).toBe(false);
  });

  it('loads more items when a continuation token exists', () => {
    component['nextToken'].set('token-1');
    component['loadingMore'].set(false);
    wardrobeService.getAll.mockReturnValueOnce(of({ items: [BASE_ITEM], nextContinuationToken: undefined }));
    component.loadMore();
    expect(component['loadingMore']()).toBe(false);
    expect(component['hasMore']()).toBe(false);
    expect(component.allItems().length).toBeGreaterThan(0);
  });

  it('resets loadingMore on loadMore error', () => {
    component['nextToken'].set('token-1');
    component['loadingMore'].set(false);
    wardrobeService.getAll.mockReturnValueOnce(throwError(() => new Error('network')));
    component.loadMore();
    expect(component['loadingMore']()).toBe(false);
  });

  it('updates queue state on upload accepted', () => {
    const qi = { localId: 'q1', file: new File(['a'], 'shirt.jpg'), status: 'uploading' as const };
    component.uploadQueue.set([qi]);

    (component as any)._onUploadAccepted(qi, () => undefined, { ...READY_DRAFT, draftStatus: 'Processing' });
    expect(component.uploadQueue()[0].status).toBe('processing');
    expect(component.uploadQueue()[0].draftId).toBe('draft-1');
  });

  it('updates queue state on upload failure', () => {
    const qi = { localId: 'q1', file: new File(['a'], 'shirt.jpg'), status: 'uploading' as const };
    component.uploadQueue.set([qi]);
    const errSpy = vi.fn();

    (component as any)._onUploadFailed(qi, errSpy, { error: { detail: 'broken image' } });
    expect(component.uploadQueue()[0].status).toBe('failed');
    expect(component.uploadQueue()[0].error).toBe('broken image');
    expect(errSpy).toHaveBeenCalled();
  });

  it('moves queue entries to ready when processing draft succeeds', () => {
    component.uploadQueue.set([{
      localId: 'q1',
      file: new File(['a'], 'shirt.jpg'),
      status: 'processing',
      draftId: 'draft-1',
    }]);
    (component as any)._reconcileQueueWithDrafts([READY_DRAFT]);
    expect(component.uploadQueue()[0].status).toBe('ready');
    expect(component.uploadQueue()[0].category).toBe('Outerwear');
  });

  it('moves queue entries to failed when draft processing fails', () => {
    component.uploadQueue.set([{
      localId: 'q2',
      file: new File(['a'], 'shirt.jpg'),
      status: 'processing',
      draftId: 'draft-fail',
    }]);
    (component as any)._reconcileQueueWithDrafts([{ ...PROCESSING_DRAFT, id: 'draft-fail', draftStatus: 'Failed', draftError: 'bad blob' }]);
    expect(component.uploadQueue()[0].status).toBe('failed');
    expect(component.uploadQueue()[0].error).toBe('bad blob');
  });

  it('reviews a ready draft from a queue item', () => {
    component.uploadQueue.set([{
      localId: 'q1',
      file: new File(['a'], 'shirt.jpg'),
      status: 'ready',
      draftId: 'draft-1',
    }]);
    component['drafts'].set([READY_DRAFT]);
    component.onQueueItemReview({ localId: 'q1', file: new File(['a'], 'shirt.jpg'), status: 'ready', draftId: 'draft-1' });
    expect(component.reviewingDraft()).toEqual(READY_DRAFT);
  });

  it('retries a failed queue item', () => {
    component.uploadQueue.set([{ localId: 'q1', file: new File(['a'], 'shirt.jpg'), status: 'failed', draftId: 'draft-r' }]);
    component['drafts'].set([{ ...BASE_ITEM, id: 'draft-r', draftStatus: 'Failed' }]);
    component.onQueueItemRetry({ localId: 'q1', file: new File(['a'], 'shirt.jpg'), status: 'failed', draftId: 'draft-r' });
    expect(component.uploadQueue()[0].status).toBe('processing');
  });

  it('displays upload error when queue retry fails', () => {
    wardrobeService.retryDraft.mockReturnValueOnce(throwError(() => new Error('nope')));
    component.onQueueItemRetry({ localId: 'q1', file: new File(['a'], 'shirt.jpg'), status: 'failed', draftId: 'draft-r' });
    expect(component.uploadError()).toBe('Retry failed. Please try again.');
  });

  it('dismisses queue item and clears draft data', () => {
    component.uploadQueue.set([{ localId: 'q1', file: new File(['a'], 'shirt.jpg'), status: 'ready', draftId: 'draft-1' }]);
    component['drafts'].set([READY_DRAFT]);
    component.onQueueItemDismiss({ localId: 'q1', file: new File(['a'], 'shirt.jpg'), status: 'ready', draftId: 'draft-1' });
    expect(component.uploadQueue()).toHaveLength(0);
    expect(component['drafts']()).toHaveLength(0);
    expect(wardrobeService.dismissDraft).toHaveBeenCalledWith('draft-1');
  });

  it('updates draft states when server draft retry succeeds', () => {
    component['drafts'].set([{ ...BASE_ITEM, id: 'srv-1', draftStatus: 'Failed' }]);
    component.onServerDraftRetry({ ...BASE_ITEM, id: 'srv-1', draftStatus: 'Failed' });
    expect(wardrobeService.retryDraft).toHaveBeenCalledWith('srv-1');
    expect(component['retryingDraftIds']().has('srv-1')).toBe(false);
  });

  it('sets upload error when server draft retry fails', () => {
    wardrobeService.retryDraft.mockReturnValueOnce(throwError(() => new Error('nope')));
    component.onServerDraftRetry({ ...BASE_ITEM, id: 'srv-1', draftStatus: 'Failed' });
    expect(component.uploadError()).toBe('Retry failed. Please try again.');
  });

  it('dismisses server draft and removes it from state', () => {
    component['drafts'].set([READY_DRAFT]);
    component.onServerDraftDismiss(READY_DRAFT);
    expect(component['drafts']()).toHaveLength(0);
    expect(wardrobeService.dismissDraft).toHaveBeenCalledWith('draft-1');
  });

  it('accepts a reviewed draft and moves it to wardrobe items on success', () => {
    component.reviewingDraft.set(PROCESSING_DRAFT);
    wardrobeService.update.mockReturnValueOnce(of(PROCESSING_DRAFT));
    wardrobeService.acceptDraft.mockReturnValueOnce(of(PROCESSING_DRAFT));
    component.onDraftReviewSaved(PROCESSING_DRAFT);
    expect(component.reviewingDraft()).toBeNull();
    expect(component.allItems()[0]).toEqual(PROCESSING_DRAFT);
  });

  it('keeps reviewing draft open and sets error on failed accept', () => {
    component.reviewingDraft.set(PROCESSING_DRAFT);
    wardrobeService.update.mockReturnValueOnce(throwError(() => ({ error: { detail: 'Nope' } })));
    component.onDraftReviewSaved(PROCESSING_DRAFT);
    expect(component.uploadError()).toBe('Nope');
    expect(component.reviewingDraft()).toBeNull();
  });

  it('toggles edit modal and saves edited item', () => {
    component.onEditItem(BASE_ITEM);
    expect(component.editingItem()).toEqual(BASE_ITEM);

    const updated = { ...BASE_ITEM, notes: 'updated' };
    component.onItemUpdated(updated);
    expect(component.editingItem()).toBeNull();
    expect(component.allItems()[0]).toEqual(updated);
  });

  it('handles update failure and exposes upload error', () => {
    component.onEditItem(BASE_ITEM);
    wardrobeService.update.mockReturnValueOnce(throwError(() => ({ message: 'Bad save' })));
    component.onItemUpdated({ ...BASE_ITEM, notes: 'bad' });
    expect(component.uploadError()).toBe('Bad save');
    expect(component.editingItem()).toBeNull();
  });

  it('opens delete confirmation and removes item when confirmed', () => {
    component.allItems.set([BASE_ITEM]);
    component.onDeleteItem(BASE_ITEM);
    expect(component.deletingItem()).toEqual(BASE_ITEM);

    component.confirmDelete();
    expect(component.allItems()).toHaveLength(0);
    expect(component.deletingItem()).toBeNull();
  });

  it('shows delete error on failed delete', () => {
    component.allItems.set([BASE_ITEM]);
    component.onDeleteItem(BASE_ITEM);
    wardrobeService.delete.mockReturnValueOnce(throwError(() => ({ error: { detail: 'Nope' } })));
    component.confirmDelete();
    expect(component.uploadError()).toBe('Nope');
    expect(component.allItems()).toHaveLength(1);
  });
});
