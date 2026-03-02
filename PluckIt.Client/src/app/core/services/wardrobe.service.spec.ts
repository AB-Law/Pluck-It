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

  it('getAll() hits /api/wardrobe with default pagination params', () => {
    service.getAll().subscribe();
    const req = http.expectOne(r => r.url.includes('/api/wardrobe') && !r.url.includes('/api/wardrobe/'));
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('page')).toBe('0');
    expect(req.request.params.get('pageSize')).toBe('24');
    req.flush([MOCK_ITEM]);
  });

  it('getAll() passes category filter when provided', () => {
    service.getAll({ category: 'Tops', page: 1 }).subscribe();
    const req = http.expectOne(r => r.url.includes('/api/wardrobe'));
    expect(req.request.params.get('category')).toBe('Tops');
    expect(req.request.params.get('page')).toBe('1');
    req.flush([]);
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

  it('update() sends PUT to /api/wardrobe/:id', () => {
    service.update(MOCK_ITEM).subscribe();
    const req = http.expectOne(r => r.url.includes('/api/wardrobe/item-001') && r.method === 'PUT');
    expect(req.request.body).toEqual(MOCK_ITEM);
    req.flush(null);
  });

  it('delete() sends DELETE to /api/wardrobe/:id', () => {
    let called = false;
    service.delete('item-001').subscribe(() => (called = true));
    const req = http.expectOne(r => r.url.includes('/api/wardrobe/item-001') && r.method === 'DELETE');
    req.flush(null);
    expect(called).toBe(true);
  });

  it('logWear() sends PATCH to /api/wardrobe/:id/wear', () => {
    service.logWear('item-001').subscribe();
    const req = http.expectOne(r => r.url.includes('/api/wardrobe/item-001/wear') && r.method === 'PATCH');
    req.flush({ ...MOCK_ITEM, wearCount: 1 });
  });
});
