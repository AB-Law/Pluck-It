import { TestBed } from '@angular/core/testing';
import {
  provideHttpClient,
  withInterceptorsFromDi,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { WardrobeService } from './wardrobe.service';
import { ClothingItem } from '../models/clothing-item.model';

const MOCK_ITEM: ClothingItem = {
  id: 'item-001',
  userId: 'user-001',
  imageUrl: 'https://example.com/img.png',
  category: 'Tops',
  tags: ['casual'],
  colours: [{ name: 'White', hex: '#FFFFFF' }],
  brand: null,
  price: null,
  notes: null,
  dateAdded: new Date().toISOString(),
  wearCount: 0,
  estimatedMarketValue: null,
  purchaseDate: null,
  condition: null,
};

describe('WardrobeService', () => {
  let service: WardrobeService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        WardrobeService,
      ],
    });
    service = TestBed.inject(WardrobeService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('getAll() hits /api/wardrobe with default pageSize', () => {
    service.getAll().subscribe();
    const req = http.expectOne(r => r.url.includes('/api/wardrobe') && !r.url.includes('/api/wardrobe/'));
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('page')).toBeNull();
    expect(req.request.params.get('pageSize')).toBe('24');
    req.flush({ items: [MOCK_ITEM], nextContinuationToken: null });
  });

  it('getAll() passes category + continuationToken when provided', () => {
    service.getAll({ category: 'Tops', continuationToken: 'tok-1' }).subscribe();
    const req = http.expectOne(r => r.url.includes('/api/wardrobe'));
    expect(req.request.params.get('category')).toBe('Tops');
    expect(req.request.params.get('continuationToken')).toBe('tok-1');
    expect(req.request.params.get('page')).toBeNull();
    req.flush({ items: [], nextContinuationToken: null });
  });

  it('getAll() maps all query filters into request parameters', () => {
    service.getAll({
      category: 'Tops',
      brand: 'Acme',
      condition: 'Good',
      tags: ['casual', 'work'],
      aestheticTags: ['clean'],
      priceMin: 10,
      priceMax: 200,
      minWears: 1,
      maxWears: 10,
      sortField: 'wearCount',
      sortDir: 'desc',
      continuationToken: 'cursor-9',
    }).subscribe();

    const req = http.expectOne(r => r.url.includes('/api/wardrobe') && !r.url.includes('/api/wardrobe/drafts'));
    expect(req.request.params.get('category')).toBe('Tops');
    expect(req.request.params.get('brand')).toBe('Acme');
    expect(req.request.params.get('condition')).toBe('Good');
    expect(req.request.params.get('tags')).toBe('casual,work');
    expect(req.request.params.get('aestheticTags')).toBe('clean');
    expect(req.request.params.get('priceMin')).toBe('10');
    expect(req.request.params.get('priceMax')).toBe('200');
    expect(req.request.params.get('minWears')).toBe('1');
    expect(req.request.params.get('maxWears')).toBe('10');
    expect(req.request.params.get('sortField')).toBe('wearCount');
    expect(req.request.params.get('sortDir')).toBe('desc');
    expect(req.request.params.get('continuationToken')).toBe('cursor-9');
    req.flush({ items: [], nextContinuationToken: null });
  });

  it('uploadForDraft() posts image data using FormData', () => {
    const blob = new Blob(['image'], { type: 'image/jpeg' });
    const file = new File([blob], 'shirt.jpg', { type: 'image/jpeg' });
    service.uploadForDraft(file).subscribe();

    const req = http.expectOne(r => r.url.includes('/api/wardrobe/upload') && r.method === 'POST');
    expect(req.request.body).toBeInstanceOf(FormData);
    expect((req.request.body as FormData).get('image')).toBeTruthy();
    req.flush({ ...MOCK_ITEM, id: 'upload-1' });
  });

  it('getDrafts() loads server draft list', () => {
    service.getDrafts().subscribe();
    const req = http.expectOne(r => r.url.includes('/api/wardrobe/drafts') && r.method === 'GET');
    req.flush({ inProgress: [], ready: [], failed: [] });
  });

  it('acceptDraft(), retryDraft(), and dismissDraft() target draft endpoints', () => {
    service.acceptDraft('draft-1').subscribe();
    const acceptReq = http.expectOne(r => r.url.includes('/api/wardrobe/drafts/draft-1/accept') && r.method === 'PATCH');
    acceptReq.flush({ ...MOCK_ITEM, id: 'item-from-draft' });

    service.retryDraft('draft-1').subscribe();
    const retryReq = http.expectOne(r => r.url.includes('/api/wardrobe/drafts/draft-1/retry') && r.method === 'POST');
    retryReq.flush({ ...MOCK_ITEM, id: 'item-from-draft-retry' });

    service.dismissDraft('draft-1').subscribe();
    const dismissReq = http.expectOne(r => r.url.includes('/api/wardrobe/draft-1') && r.method === 'DELETE');
    dismissReq.flush(null);
  });

  it('getById() hits /api/wardrobe/:id', () => {
    let result: ClothingItem | undefined;
    service.getById('item-001').subscribe(i => (result = i));
    const req = http.expectOne(r => r.url.includes('/api/wardrobe/item-001'));
    expect(req.request.method).toBe('GET');
    req.flush(MOCK_ITEM);
    expect(result?.id).toBe('item-001');
  });

  it('save() sends POST with the item body', () => {
    service.save(MOCK_ITEM).subscribe();
    const req = http.expectOne(r => r.url.includes('/api/wardrobe') && r.method === 'POST');
    expect(req.request.body).toEqual(MOCK_ITEM);
    req.flush(MOCK_ITEM);
  });

  it('save() invalidates the wardrobe cache', () => {
    service.getAll().subscribe();
    const firstListReq = http.expectOne(r => r.url.includes('/api/wardrobe') && !r.url.includes('/api/wardrobe/'));
    firstListReq.flush({ items: [MOCK_ITEM], nextContinuationToken: null });

    service.save(MOCK_ITEM).subscribe();
    const saveReq = http.expectOne(r => r.url.includes('/api/wardrobe') && r.method === 'POST');
    saveReq.flush(MOCK_ITEM);

    service.getAll().subscribe();
    const secondListReq = http.expectOne(r => r.url.includes('/api/wardrobe') && !r.url.includes('/api/wardrobe/'));
    secondListReq.flush({ items: [MOCK_ITEM], nextContinuationToken: null });
  });

  it('update() sends PUT to /api/wardrobe/:id', () => {
    service.update(MOCK_ITEM).subscribe();
    const req = http.expectOne(r => r.url.includes('/api/wardrobe/item-001') && r.method === 'PUT');
    expect(req.request.body).toEqual(MOCK_ITEM);
    req.flush(null);
  });

  it('update() invalidates the wardrobe cache', () => {
    service.getAll().subscribe();
    const firstListReq = http.expectOne(r => r.url.includes('/api/wardrobe') && !r.url.includes('/api/wardrobe/'));
    firstListReq.flush({ items: [MOCK_ITEM], nextContinuationToken: null });

    service.update(MOCK_ITEM).subscribe();
    const updateReq = http.expectOne(r => r.url.includes('/api/wardrobe/item-001') && r.method === 'PUT');
    updateReq.flush(null);

    service.getAll().subscribe();
    const secondListReq = http.expectOne(r => r.url.includes('/api/wardrobe') && !r.url.includes('/api/wardrobe/'));
    secondListReq.flush({ items: [MOCK_ITEM], nextContinuationToken: null });
  });

  it('delete() sends DELETE to /api/wardrobe/:id', () => {
    let called = false;
    service.delete('item-001').subscribe(() => (called = true));
    const req = http.expectOne(r => r.url.includes('/api/wardrobe/item-001') && r.method === 'DELETE');
    req.flush(null);
    expect(called).toBe(true);
  });

  it('delete() invalidates the wardrobe cache', () => {
    service.getAll().subscribe();
    const firstListReq = http.expectOne(r => r.url.includes('/api/wardrobe') && !r.url.includes('/api/wardrobe/'));
    firstListReq.flush({ items: [MOCK_ITEM], nextContinuationToken: null });

    service.delete('item-001').subscribe();
    const deleteReq = http.expectOne(r => r.url.includes('/api/wardrobe/item-001') && r.method === 'DELETE');
    deleteReq.flush(null);

    service.getAll().subscribe();
    const secondListReq = http.expectOne(r => r.url.includes('/api/wardrobe') && !r.url.includes('/api/wardrobe/'));
    secondListReq.flush({ items: [], nextContinuationToken: null });
  });

  it('logWear() sends PATCH to /api/wardrobe/:id/wear', () => {
    service.logWear('item-001').subscribe();
    const req = http.expectOne(r => r.url.includes('/api/wardrobe/item-001/wear') && r.method === 'PATCH');
    req.flush({ ...MOCK_ITEM, wearCount: 1 });
  });

  it('logWear() sends payload when provided', () => {
    service.logWear('item-001', { clientEventId: 'evt-1', source: 'vault_card' }).subscribe();
    const req = http.expectOne(r => r.url.includes('/api/wardrobe/item-001/wear') && r.method === 'PATCH');
    expect(req.request.body.clientEventId).toBe('evt-1');
    req.flush({ ...MOCK_ITEM, wearCount: 1 });
  });

  it('logWear() invalidates the wardrobe cache', () => {
    service.getAll().subscribe();
    const firstListReq = http.expectOne(r => r.url.includes('/api/wardrobe') && !r.url.includes('/api/wardrobe/'));
    firstListReq.flush({ items: [MOCK_ITEM], nextContinuationToken: null });

    service.logWear('item-001').subscribe();
    const wearReq = http.expectOne(r => r.url.includes('/api/wardrobe/item-001/wear') && r.method === 'PATCH');
    wearReq.flush({ ...MOCK_ITEM, wearCount: 1 });

    service.getAll().subscribe();
    const secondListReq = http.expectOne(r => r.url.includes('/api/wardrobe') && !r.url.includes('/api/wardrobe/'));
    secondListReq.flush({ items: [{ ...MOCK_ITEM, wearCount: 1 }], nextContinuationToken: null });
  });

  it('acceptDraft() invalidates the wardrobe cache', () => {
    service.getAll().subscribe();
    const firstListReq = http.expectOne(r => r.url.includes('/api/wardrobe') && !r.url.includes('/api/wardrobe/'));
    firstListReq.flush({ items: [MOCK_ITEM], nextContinuationToken: null });

    service.acceptDraft('draft-1').subscribe();
    const acceptReq = http.expectOne(
      r => r.url.includes('/api/wardrobe/drafts/draft-1/accept') && r.method === 'PATCH',
    );
    acceptReq.flush({ ...MOCK_ITEM, id: 'draft-item-001' });

    service.getAll().subscribe();
    const secondListReq = http.expectOne(r => r.url.includes('/api/wardrobe') && !r.url.includes('/api/wardrobe/'));
    secondListReq.flush({ items: [{ ...MOCK_ITEM, id: 'draft-item-001' }], nextContinuationToken: null });
  });

  it('getWearHistory() hits /wear-history with date params', () => {
    service.getWearHistory('item-001', '2026-01-01', '2026-01-31').subscribe();
    const req = http.expectOne(r => r.url.includes('/api/wardrobe/item-001/wear-history') && r.method === 'GET');
    expect(req.request.params.get('from')).toBe('2026-01-01');
    expect(req.request.params.get('to')).toBe('2026-01-31');
    req.flush({ itemId: 'item-001', events: [], summary: { totalInRange: 0, legacyUntrackedCount: 0 } });
  });

  it('recordStylingActivity() POSTs to styling-activity', () => {
    service.recordStylingActivity({ itemId: 'item-001', source: 'dashboard_drag_drop' }).subscribe();
    const req = http.expectOne(r => r.url.includes('/api/wardrobe/styling-activity') && r.method === 'POST');
    expect(req.request.body.itemId).toBe('item-001');
    req.flush({ status: 'recorded', activityId: 'sty-1' });
  });

  it('getWearSuggestions() GETs suggestions', () => {
    service.getWearSuggestions().subscribe();
    const req = http.expectOne(r => r.url.includes('/api/wardrobe/suggestions/wear') && r.method === 'GET');
    req.flush({ suggestions: [] });
  });

  it('updateWearSuggestionStatus() PATCHes suggestion status', () => {
    service.updateWearSuggestionStatus('sug-1', { status: 'Dismissed' }).subscribe();
    const req = http.expectOne(r => r.url.includes('/api/wardrobe/suggestions/wear/sug-1') && r.method === 'PATCH');
    expect(req.request.body.status).toBe('Dismissed');
    req.flush({ status: 'updated' });
  });
});
