import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, ParamMap, Router, convertToParamMap } from '@angular/router';
import { By } from '@angular/platform-browser';
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

  it('shows upload error banner and allows dismiss', () => {
    component.uploadQueue.set([]);
    component.drafts.set([]);
    component.uploadError.set('Upload failed');
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Upload failed');
    const dismissBtn = root.querySelector('button[aria-label="Dismiss"]') as HTMLButtonElement | null;
    expect(dismissBtn).toBeTruthy();
    dismissBtn?.click();
    fixture.detectChanges();

    expect(component.uploadError()).toBeNull();
  });

  it('renders upload queue action states across status branches', () => {
    const uploadImage = (name: string) => new File(['a'], name, { type: 'image/jpeg' });
    component.uploadQueue.set([
      { localId: 'queued', file: uploadImage('queued.jpg'), status: 'queued' },
      { localId: 'uploading', file: uploadImage('uploading.jpg'), status: 'uploading' },
      { localId: 'processing', file: uploadImage('processing.jpg'), status: 'processing' },
      { localId: 'ready', file: uploadImage('ready.jpg'), status: 'ready', draftId: 'draft-1' },
      { localId: 'failedWithDraft', file: uploadImage('failed-with-draft.jpg'), status: 'failed', draftId: 'draft-2' },
      { localId: 'failedNoDraft', file: uploadImage('failed-no-draft.jpg'), status: 'failed' },
    ]);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('schedule');
    expect(root.textContent).toContain('sync');
    expect(root.textContent).toContain('autorenew');
    expect(root.textContent).toContain('check_circle');
    expect(root.textContent).toContain('error');

    const buttons = Array.from(root.querySelectorAll('button')) as HTMLButtonElement[];
    expect(buttons.some(b => b.textContent?.trim() === 'Review')).toBe(true);
    expect(buttons.some(b => b.textContent?.trim() === 'Retry')).toBe(true);
    expect(buttons.filter(b => b.textContent?.trim() === '✕').length).toBeGreaterThan(0);
  });

  it('renders server draft status variants in the upload pipeline', () => {
    component.uploadQueue.set([]);
    component.drafts.set([
      READY_DRAFT,
      { ...BASE_ITEM, id: 'server-processing', draftStatus: 'Processing', category: 'Outerwear' },
      { ...BASE_ITEM, id: 'server-failed', draftStatus: 'Failed', category: 'Pants' },
    ]);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('check_circle');
    expect(root.textContent).toContain('sync');
    expect(root.textContent).toContain('error');
    expect(root.textContent).toContain('Review');
    expect(root.textContent).toContain('Retry');
  });

  it('displays loading skeleton and empty states', () => {
    component.uploadQueue.set([]);
    component.drafts.set([]);
    component.loading.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);

    component.loading.set(false);
    component.allItems.set([]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Your wardrobe is empty. Upload your first item above.');

    component.allItems.set([BASE_ITEM]);
    fixture.componentRef.setInput('searchQuery', 'nomatch');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No items match the selected filter.');
  });

  it('shows both load more label states', () => {
    component.allItems.set([BASE_ITEM]);
    component.loading.set(false);
    component['hasMore'].set(true);
    component['loadingMore'].set(false);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Load More');

    component['loadingMore'].set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Loading...');
  });

  it('handles upload-item fileSelected and sort select events from the template', () => {
    wardrobeService.getAll.mockReturnValue(of({ items: [BASE_ITEM], pageInfo: {}, nextContinuationToken: 'next-1' }));
    const uploader = fixture.debugElement.query(By.css('app-upload-item'));
    uploader.triggerEventHandler('fileSelected', [new File(['a'], 'pipeline.jpg')]);
    expect(component.uploadQueue()).toHaveLength(1);

    const select = fixture.debugElement.query(By.css('section select'));
    component['nextToken'].set('token-2');
    component['loadingMore'].set(false);
    wardrobeService.getAll.mockReturnValueOnce(of({ items: [BASE_ITEM], nextContinuationToken: undefined }));
    select.triggerEventHandler('change', { target: { value: 'price.amount:asc' } });
    expect(wardrobeService.getAll).toHaveBeenCalled();
  });

  it('runs queue action buttons through template interactions', () => {
    component.uploadQueue.set([
      { localId: 'q-ready', file: new File(['a'], 'a.jpg'), status: 'ready', draftId: 'draft-1' },
      { localId: 'q-failed', file: new File(['a'], 'b.jpg'), status: 'failed', draftId: 'draft-2' },
      { localId: 'q-failed-no-draft', file: new File(['a'], 'c.jpg'), status: 'failed' },
    ]);
    component['drafts'].set([
      { ...BASE_ITEM, id: 'draft-1', draftStatus: 'Ready', category: 'Tops' },
      { ...BASE_ITEM, id: 'draft-2', draftStatus: 'Failed', category: 'Outerwear' },
    ]);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const reviewBtn = (Array.from(root.querySelectorAll('button')) as HTMLButtonElement[]).find(
      btn => btn.textContent?.trim() === 'Review',
    );
    reviewBtn?.click();
    expect(component.reviewingDraft()).toBeTruthy();

    const retryBtn = (Array.from(root.querySelectorAll('button')) as HTMLButtonElement[]).find(
      btn => btn.textContent?.trim() === 'Retry',
    );
    retryBtn?.click();
    expect(wardrobeService.retryDraft).toHaveBeenCalledWith('draft-2');

    const dismissButtons = (Array.from(root.querySelectorAll('button[aria-label="Dismiss"]')) as HTMLButtonElement[]);
    expect(dismissButtons.length).toBeGreaterThan(0);
    dismissButtons.forEach(button => button.click());
    expect(wardrobeService.dismissDraft).toHaveBeenCalled();
  });

  it('hooks review/edit modal outputs through template event bindings', () => {
    component.allItems.set([BASE_ITEM]);
    component.editingItem.set(BASE_ITEM);
    wardrobeService.update.mockReturnValue(of({ ...BASE_ITEM, notes: 'updated via template' }));
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const saveBtn = (Array.from(root.querySelectorAll('button')) as HTMLButtonElement[]).find(
      btn => btn.textContent?.trim() === 'Save Changes',
    );
    expect(saveBtn).toBeTruthy();
    saveBtn?.click();
    expect(wardrobeService.update).toHaveBeenCalledTimes(1);
    expect(component.editingItem()).toBeNull();

    const reviewing = { ...BASE_ITEM, draftStatus: 'Ready' as const };
    component.reviewingDraft.set(reviewing);
    wardrobeService.acceptDraft.mockReturnValue(of(reviewing));
    wardrobeService.update.mockReturnValue(of(reviewing));
    fixture.detectChanges();

    const addBtn = (Array.from(root.querySelectorAll('button')) as HTMLButtonElement[]).find(
      btn => btn.textContent?.trim() === 'Add to Wardrobe',
    );
    addBtn?.click();
    expect(component.reviewingDraft()).toBeNull();
    expect(component.allItems()[0]).toEqual(reviewing);
  });

  it('renders and dismisses review/edit/delete overlays', () => {
    component.reviewingDraft.set(BASE_ITEM);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-review-item-modal')).toBeTruthy();

    component.reviewingDraft.set(null);
    component.editingItem.set(BASE_ITEM);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-review-item-modal')).toBeTruthy();

    component.editingItem.set(null);
    component.onDeleteItem(BASE_ITEM);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Delete Item?');
    const cancelBtn = (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[]).find(
      btn => btn.textContent?.trim() === 'Cancel',
    );
    expect(cancelBtn).toBeTruthy();
    cancelBtn?.click();
    fixture.detectChanges();
    expect(component.deletingItem()).toBeNull();
  });

  it('forwards queue review action checks to missing draft edge cases', () => {
    component['drafts'].set([READY_DRAFT]);

    const queuedWithoutDraft = {
      localId: 'q-no-draft',
      file: new File(['a'], 'queued.jpg'),
      status: 'ready' as const,
    };
    component.onQueueItemReview(queuedWithoutDraft);
    expect(component.reviewingDraft()).toBeNull();

    component.onQueueItemReview({
      localId: 'q-missing',
      file: new File(['a'], 'queued.jpg'),
      status: 'ready',
      draftId: 'missing',
    });
    expect(component.reviewingDraft()).toBeNull();
  });

  it('ignores retry and dismiss operations when queue entries have no draft id', () => {
    component.uploadQueue.set([{ localId: 'local-1', file: new File(['a'], 'item.jpg'), status: 'failed' }]);
    wardrobeService.retryDraft.mockClear();
    wardrobeService.dismissDraft.mockClear();

    const failedWithoutDraft = { localId: 'local-1', file: new File(['a'], 'item.jpg'), status: 'failed' as const };
    component.onQueueItemRetry(failedWithoutDraft);
    expect(wardrobeService.retryDraft).not.toHaveBeenCalled();

    component.onQueueItemDismiss(failedWithoutDraft);
    expect(component.uploadQueue()).toHaveLength(0);
    expect(wardrobeService.dismissDraft).not.toHaveBeenCalled();
  });

  it('no-ops confirmDelete when no delete target is selected', () => {
    component.deletingItem.set(null);
    component.confirmDelete();
    expect(wardrobeService.delete).not.toHaveBeenCalled();
  });

  it('leaves queue unchanged when setUploadQueueState cannot find local id', () => {
    const entry = { localId: 'q', file: new File(['a'], 'item.jpg'), status: 'queued' as const };
    component.uploadQueue.set([entry]);
    (component as any)._setUploadQueueState('missing-id', { status: 'failed' });
    expect(component.uploadQueue()).toEqual([entry]);
  });

  it('loads items with error path and still clears loading state', () => {
    wardrobeService.getAll.mockReturnValueOnce(throwError(() => new Error('network')));
    (component as any).loadItems();
    expect(component.loading()).toBe(false);
  });

  it('derives upload error messages from nested error payloads', () => {
    const getUploadErrorMessage = (component as any)._getUploadErrorMessage;
    expect(getUploadErrorMessage({ error: { detail: 'detail-msg' } })).toBe('detail-msg');
    expect(getUploadErrorMessage({ error: { error: 'error-msg' } })).toBe('error-msg');
    expect(getUploadErrorMessage({ message: 'boom' })).toBe('boom');
    expect(getUploadErrorMessage({})).toBe('Upload failed');
  });

  it('syncs url with default filter and sort state', () => {
    router.navigate.mockClear();
    component['selectedCategory'].set('all');
    component['sortField'].set('dateAdded');
    component['sortDir'].set('desc');
    (component as any).syncUrl();

    expect(router.navigate).toHaveBeenCalledWith([], {
      queryParams: {
        category: null,
        sortField: null,
        sortDir: null,
      },
      replaceUrl: true,
    });
  });

  it('triggers the upload component picker', () => {
    const uploadRef = { openFilePicker: vi.fn() };
    (component as any).uploadRef = uploadRef;
    component.triggerUpload();
    expect(uploadRef.openFilePicker).toHaveBeenCalled();
  });

  it('forwards clothing card output events from template listeners', () => {
    component.allItems.set([{ ...BASE_ITEM, id: 'item-a', category: 'Tops' }, { ...BASE_ITEM, id: 'item-b', category: 'Outerwear' }]);
    fixture.detectChanges();

    const itemToggledSpy = vi.fn();
    component.itemToggled.subscribe(itemToggledSpy);

    const card = fixture.debugElement.query(By.css('app-clothing-card'));
    card.triggerEventHandler('selectToggled', 'item-a');
    expect(itemToggledSpy).toHaveBeenCalledWith('item-a');

    card.triggerEventHandler('editRequested', { ...BASE_ITEM, id: 'item-b', category: 'Outerwear' });
    expect(component.editingItem()).toMatchObject({ id: 'item-b' });

    card.triggerEventHandler('deleteRequested', { ...BASE_ITEM, id: 'item-b', category: 'Outerwear' });
    expect(component.deletingItem()).toMatchObject({ id: 'item-b' });
  });

  it('handles review/edit modal cancelled outputs from template bindings', () => {
    component.reviewingDraft.set({ ...BASE_ITEM, id: 'review-id' });
    fixture.detectChanges();
    let reviewModal = fixture.debugElement.query(By.css('app-review-item-modal'));
    reviewModal.triggerEventHandler('cancelled');
    expect(component.reviewingDraft()).toBeNull();

    component.editingItem.set({ ...BASE_ITEM, id: 'edit-id' });
    fixture.detectChanges();
    const editModal = fixture.debugElement.query(By.css('app-review-item-modal'));
    editModal.triggerEventHandler('cancelled');
    expect(component.editingItem()).toBeNull();
  });

  it('executes server draft retry and dismiss through template buttons', () => {
    component.drafts.set([
      { ...BASE_ITEM, id: 'server-ready', draftStatus: 'Ready' as const, category: 'Tops' },
      { ...BASE_ITEM, id: 'server-failed', draftStatus: 'Failed' as const, category: 'Outerwear' },
    ]);
    component.uploadQueue.set([]);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const reviewButtons = Array.from(root.querySelectorAll('button')).filter(
      button => button.textContent?.trim() === 'Review',
    );
    reviewButtons[0]?.click();
    expect(component.reviewingDraft()?.id).toBe('server-ready');

    component.reviewingDraft.set(null);
    const retryButtons = Array.from(root.querySelectorAll('button')).filter(button => button.textContent?.trim() === 'Retry');
    retryButtons[0]?.click();
    expect(wardrobeService.retryDraft).toHaveBeenCalledWith('server-failed');

    const dismissButtons = Array.from(root.querySelectorAll('button[aria-label=\"Dismiss\"]')) as HTMLButtonElement[];
    expect(dismissButtons.length).toBeGreaterThan(0);
    dismissButtons.forEach(button => button.click());
    expect(wardrobeService.dismissDraft).toHaveBeenCalledWith('server-failed');
  });

  it('confirms delete through template button handler and closes modal', () => {
    wardrobeService.delete.mockReturnValueOnce(of({}));
    component.onDeleteItem({ ...BASE_ITEM, id: 'delete-1' });
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const deleteBtn = Array.from(root.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Delete');
    deleteBtn?.click();
    expect(wardrobeService.delete).toHaveBeenCalledWith('delete-1');
    expect(component.deletingItem()).toBeNull();
  });

  it('switches category and sort via template controls', () => {
    component.allItems.set([{ ...BASE_ITEM, id: 'i-1', category: 'Outerwear' }, { ...BASE_ITEM, id: 'i-2', category: 'Tops' }]);
    const loadItemsSpy = vi.fn();
    (component as any).loadItems = loadItemsSpy;
    fixture.detectChanges();

    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    buttons.find(button => button.textContent?.trim() === 'Outerwear')?.click();
    buttons.find(button => button.textContent?.trim() === 'Tops')?.click();
    expect(loadItemsSpy).toHaveBeenCalled();

    const select = fixture.debugElement.query(By.css('section select'));
    select.triggerEventHandler('change', { target: { value: 'wearCount:asc' } });
    expect(loadItemsSpy).toHaveBeenCalled();
  });

  it('renders fallback labels for missing metadata in templates', () => {
    const itemWithMissingCategory = {
      ...BASE_ITEM,
      id: 'missing-cat',
      category: undefined as unknown as string,
    };

    component.uploadQueue.set([]);
    component['drafts'].set([{ ...itemWithMissingCategory, draftStatus: 'Failed' as const }]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Item');

    component.onDeleteItem(itemWithMissingCategory);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('this item');

    const cancelButton = (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[]).find(
      button => button.textContent?.trim() === 'Cancel',
    );
    cancelButton?.click();
    expect(component.deletingItem()).toBeNull();
  });

  it('covers category class toggles and both load more branch states', () => {
    component.allItems.set([{ ...BASE_ITEM, id: 'i-outer', category: 'Outerwear' }, { ...BASE_ITEM, id: 'i-top', category: 'Tops' }]);
    fixture.detectChanges();

    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    const allButton = buttons.find(
      (button: unknown) => (button as HTMLButtonElement).textContent?.trim() === 'All Items',
    ) as HTMLButtonElement;
    const outerButton = buttons.find(
      (button: unknown) => (button as HTMLButtonElement).textContent?.trim() === 'Outerwear',
    ) as HTMLButtonElement;
    expect(allButton.className).toContain('bg-white');
    expect(outerButton.className).toContain('bg-card-dark');

    component['selectedCategory'].set('Outerwear');
    fixture.detectChanges();
    expect(component['selectedCategory']()).toBe('Outerwear');
    const updatedOuterButton = Array.from(fixture.nativeElement.querySelectorAll('button')).find(
      (button: unknown) => (button as HTMLButtonElement).textContent?.trim() === 'Outerwear',
    ) as HTMLButtonElement;
    expect(updatedOuterButton.className).toContain('bg-white');

    component['selectedCategory'].set('all');
    fixture.detectChanges();
    const updatedAllButton = Array.from(fixture.nativeElement.querySelectorAll('button')).find(
      (button: unknown) => (button as HTMLButtonElement).textContent?.trim() === 'All Items',
    ) as HTMLButtonElement;
    expect(updatedAllButton.className).toContain('bg-white');

    component['hasMore'].set(false);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Load More');

    component['hasMore'].set(true);
    component['loadingMore'].set(false);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Load More');

    component['loadingMore'].set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Loading...');
  });

  it('covers derived signal branches for missing categories, brands, and queue filtering', () => {
    component.allItems.set([
      { ...BASE_ITEM, id: 'with-metadata', category: 'Tops', brand: 'Acme', price: { amount: 20, originalCurrency: 'USD' } },
      { ...BASE_ITEM, id: 'without-metadata', category: undefined as unknown as string, brand: undefined as unknown as string },
    ]);
    component.uploadQueue.set([{ localId: 'q-1', file: new File(['a'], 'queued.jpg'), status: 'processing', draftId: 'd1' }]);
    component.drafts.set([
      { ...BASE_ITEM, id: 'd1', draftStatus: 'Failed' as const },
      { ...BASE_ITEM, id: 'd2', category: 'Pants', brand: 'North', draftStatus: 'Failed' as const },
    ]);

    expect(component.allCategories()).toContain('Tops');
    expect(component.knownBrands()).toEqual(['Acme']);
    expect(component.serverOnlyDrafts().length).toBe(1);

    fixture.componentRef.setInput('searchQuery', 'zzzz-no-matches');
    expect(component.filteredItems().length).toBe(0);
    fixture.componentRef.setInput('searchQuery', '');
    expect(component.filteredItems().length).toBe(2);
  });

  it('reconciles queue entries for missing and nonterminal drafts', () => {
    component.uploadQueue.set([
      { localId: 'q-missing', file: new File(['a'], 'a.jpg'), status: 'processing', draftId: 'not-there' },
      { localId: 'q-still-processing', file: new File(['b'], 'b.jpg'), status: 'processing', draftId: 'd-processing' },
    ]);
    (component as any)._reconcileQueueWithDrafts([
      { ...BASE_ITEM, id: 'd-processing', draftStatus: 'Processing' as const },
    ]);

    expect(component.uploadQueue()[0].status).toBe('processing');
    expect(component.uploadQueue()[1].status).toBe('processing');
  });

  it('uses fallback error messages when draft accept, update, and delete errors are empty', () => {
    component.reviewingDraft.set(PROCESSING_DRAFT);
    wardrobeService.update.mockReturnValueOnce(throwError(() => ({})));
    component.onDraftReviewSaved(PROCESSING_DRAFT);
    expect(component.uploadError()).toBe('Could not accept draft. Please try again.');

    component.editingItem.set(PROCESSING_DRAFT);
    wardrobeService.update.mockReturnValueOnce(throwError(() => ({})));
    component.onItemUpdated(PROCESSING_DRAFT);
    expect(component.uploadError()).toBe('Update failed. Please try again.');

    component.allItems.set([BASE_ITEM]);
    component.onDeleteItem(BASE_ITEM);
    wardrobeService.delete.mockReturnValueOnce(throwError(() => ({})));
    component.confirmDelete();
    expect(component.uploadError()).toBe('Delete failed. Please try again.');
  });

  it('covers map update branches for non-matching IDs in draft updates', () => {
    wardrobeService.retryDraft.mockReturnValueOnce(of({ ...BASE_ITEM, id: 'draft-match', draftStatus: 'Ready' as const }));
    component.uploadQueue.set([
      { localId: 'q1', file: new File(['a'], 'a.jpg'), status: 'failed', draftId: 'draft-match' },
      { localId: 'q2', file: new File(['b'], 'b.jpg'), status: 'ready', draftId: 'draft-other' },
    ]);
    component['drafts'].set([
      { ...BASE_ITEM, id: 'draft-match', draftStatus: 'Failed' as const },
      { ...BASE_ITEM, id: 'draft-other', draftStatus: 'Failed' as const },
    ]);
    component.onQueueItemRetry({ localId: 'q1', file: new File(['a'], 'a.jpg'), status: 'failed', draftId: 'draft-match' });
    expect(component['drafts']().map(d => d.id)).toEqual(expect.arrayContaining(['draft-match', 'draft-other']));

    wardrobeService.retryDraft.mockReturnValueOnce(of({ ...BASE_ITEM, id: 'server-match', draftStatus: 'Ready' as const }));
    component.onServerDraftRetry({ ...BASE_ITEM, id: 'server-match', draftStatus: 'Failed' as const });
    expect(component['drafts']().map(d => d.id)).toEqual(expect.arrayContaining(['draft-match', 'draft-other']));
  });

  it('calls visibility refresh only when page is visible', () => {
    const addEventCalls: Array<(event: Event) => void> = [];
    const addEventSpy = vi.spyOn(document, 'addEventListener').mockImplementation((event, handler) => {
      if (event === 'visibilitychange') addEventCalls.push(handler as (event: Event) => void);
    });

    const localFixture = TestBed.createComponent(WardrobeComponent);
    const localComponent = localFixture.componentInstance;
    const refreshSpy = vi.spyOn(localComponent as any, 'refreshDrafts');

    localFixture.detectChanges();
    expect(addEventCalls.length).toBe(1);
    expect(refreshSpy).toHaveBeenCalled();

    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    addEventCalls[0](new Event('visibilitychange'));
    expect(refreshSpy).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    addEventCalls[0](new Event('visibilitychange'));
    expect(refreshSpy).toHaveBeenCalledTimes(2);

    addEventSpy.mockRestore();
  });

  it('polls drafts only while queue or server items are processing', () => {
    vi.useFakeTimers();
    try {
      const localFixture = TestBed.createComponent(WardrobeComponent);
      const localComponent = localFixture.componentInstance as any;
      const refreshSpy = vi.spyOn(localComponent, 'refreshDrafts');

      localFixture.detectChanges();
      refreshSpy.mockClear();

      localComponent.uploadQueue.set([]);
      localComponent.drafts.set([]);
      vi.advanceTimersByTime(5000);
      expect(refreshSpy).toHaveBeenCalledTimes(0);

      localComponent.uploadQueue.set([
        { localId: 'q-processing', file: new File(['a'], 'processing.jpg'), status: 'processing', draftId: 'draft-processing' },
      ]);
      vi.advanceTimersByTime(5000);
      expect(refreshSpy).toHaveBeenCalledTimes(1);

      localComponent.uploadQueue.set([]);
      localComponent.drafts.set([]);
      vi.advanceTimersByTime(5000);
      expect(refreshSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves queue items that are not processing or still non-terminal', () => {
    component.uploadQueue.set([
      { localId: 'q-ready', file: new File(['a'], 'ready.jpg'), status: 'ready', draftId: 'draft-ready' },
    ]);
    (component as any)._reconcileQueueWithDrafts([READY_DRAFT]);
    expect(component.uploadQueue()[0]).toEqual(expect.objectContaining({ localId: 'q-ready', status: 'ready' }));

    component.uploadQueue.set([
      { localId: 'q-processing', file: new File(['a'], 'processing.jpg'), status: 'processing', draftId: 'draft-missing' },
    ]);
    (component as any)._reconcileQueueWithDrafts([
      { ...PROCESSING_DRAFT, id: 'other', draftStatus: 'Processing' },
    ]);
    expect(component.uploadQueue()[0].status).toBe('processing');
  });

  it('only updates the matched upload queue item when dispatching uploads', () => {
    component.uploadQueue.set([
      { localId: 'q-upload', file: new File(['a'], 'queued.jpg'), status: 'queued' },
      { localId: 'q-held', file: new File(['b'], 'hold.jpg'), status: 'processing', draftId: 'draft-held' },
    ]);
    const uploadSpy = vi.spyOn(component as any, '_uploadSingle').mockResolvedValue(undefined);

    (component as any)._dispatchPendingUploads();

    expect(component.uploadQueue()[0].status).toBe('uploading');
    expect(component.uploadQueue()[1].status).toBe('processing');
    expect(uploadSpy).toHaveBeenCalledWith(expect.objectContaining({ localId: 'q-upload' }));
  });

  it('handles server draft retry results with no matching draft id', () => {
    component['drafts'].set([{ ...BASE_ITEM, id: 'server-match', draftStatus: 'Ready' }]);
    wardrobeService.retryDraft.mockReturnValueOnce(of({ ...BASE_ITEM, id: 'server-different', draftStatus: 'Ready' }));

    component.onServerDraftRetry({ ...BASE_ITEM, id: 'server-missing', draftStatus: 'Failed' });

    expect(component['drafts']().map(d => d.id)).toEqual(['server-match']);
    expect(component['retryingDraftIds']().size).toBe(0);
  });

  it('keeps wardrobe items unchanged when updated item id does not match', () => {
    component.allItems.set([{ ...BASE_ITEM, id: 'wardrobe-item' }]);
    wardrobeService.update.mockReturnValueOnce(of({ ...BASE_ITEM, id: 'other-item' }));

    component.onItemUpdated({ ...BASE_ITEM, id: 'other-item' });

    expect(component.allItems()).toEqual([{ ...BASE_ITEM, id: 'wardrobe-item' }]);
    expect(component.editingItem()).toBeNull();
  });

  it('does nothing for queue and modal save guards when nothing is selected', () => {
    const queueItem = { localId: 'q-no-draft', file: new File(['a'], 'missing.txt'), status: 'queued' as const };
    component.onQueueItemReview(queueItem);
    component.onQueueItemRetry(queueItem);
    component.onQueueItemDismiss(queueItem);
    expect((component as any).reviewingDraft()).toBeNull();
    expect(wardrobeService.retryDraft).not.toHaveBeenCalled();
    expect(wardrobeService.dismissDraft).not.toHaveBeenCalled();

    component['deletingItem'].set(null);
    component.confirmDelete();
    expect(wardrobeService.delete).not.toHaveBeenCalled();
  });
});
