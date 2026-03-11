import { TestBed } from '@angular/core/testing';
import {
  provideHttpClient,
  withInterceptorsFromDi,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { CollectionService } from './collection.service';
import { Collection, CreateCollectionRequest } from '../models/collection.model';

const MOCK_COLLECTION: Collection = {
  id: 'col-001',
  ownerId: 'user-001',
  name: 'Summer Looks',
  description: null,
  isPublic: true,
  clothingItemIds: ['item-001'],
  memberUserIds: [],
  createdAt: new Date().toISOString(),
};

describe('CollectionService', () => {
  let service: CollectionService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        CollectionService,
      ],
    });
    service = TestBed.inject(CollectionService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('collections signal is empty by default', () => {
    expect(service.collections()).toEqual([]);
  });

  it('loadAll() populates the collections signal', () => {
    const mockList = [MOCK_COLLECTION];
    service.loadAll().subscribe();
    const req = http.expectOne(r => r.url.includes('/api/collections') && r.method === 'GET');
    req.flush(mockList);
    expect(service.collections()).toEqual(mockList);
  });

  it('create() pushes new collection to signal', () => {
    const body: CreateCollectionRequest = {
      name: 'Summer Looks',
      isPublic: true,
      clothingItemIds: [],
    };
    service.create(body).subscribe();
    const req = http.expectOne(r => r.url.includes('/api/collections') && r.method === 'POST');
    expect(req.request.body).toEqual(body);
    req.flush(MOCK_COLLECTION);
    expect(service.collections().length).toBe(1);
    expect(service.collections()[0].id).toBe('col-001');
  });

  it('delete() removes the collection from signal', () => {
    // Pre-populate signal
    service['collections'].set([MOCK_COLLECTION]);
    service.delete('col-001').subscribe();
    const req = http.expectOne(r => r.url.includes('/api/collections/col-001') && r.method === 'DELETE');
    req.flush(null);
    expect(service.collections().length).toBe(0);
  });

  it('update() patches name in signal', () => {
    service['collections'].set([MOCK_COLLECTION]);
    service.update('col-001', { name: 'Winter Looks' }).subscribe();
    const req = http.expectOne(r => r.url.includes('/api/collections/col-001') && r.method === 'PUT');
    req.flush(null);
    expect(service.collections()[0].name).toBe('Winter Looks');
  });

  it('getById() fetches the collection by ID', () => {
    service.getById('col-001').subscribe(result => {
      expect(result).toEqual(MOCK_COLLECTION);
    });
    const req = http.expectOne(r => r.url.includes('/api/collections/col-001') && r.method === 'GET');
    req.flush(MOCK_COLLECTION);
  });

  it('join() hits the join endpoint', () => {
    service.join('col-001').subscribe();
    const req = http.expectOne(r => r.url.includes('/api/collections/col-001/join') && r.method === 'POST');
    req.flush(null);
  });

  it('leave() hits endpoint and updates the collections signal', () => {
    service['collections'].set([MOCK_COLLECTION]);
    service.leave('col-001').subscribe();
    const req = http.expectOne(r => r.url.includes('/api/collections/col-001/leave') && r.method === 'DELETE');
    req.flush(null);
    expect(service.collections().length).toBe(0);
  });

  it('addItem() appends itemId in the collection signal', () => {
    service['collections'].set([MOCK_COLLECTION]);
    service.addItem('col-001', 'item-002').subscribe();
    const req = http.expectOne(r => r.url.includes('/api/collections/col-001/items') && r.method === 'POST');
    expect(req.request.body).toEqual({ itemId: 'item-002' });
    req.flush(null);
    expect(service.collections()[0].clothingItemIds).toEqual(['item-001', 'item-002']);
  });

  it('removeItem() removes itemId from the collection signal', () => {
    service['collections'].set([MOCK_COLLECTION]);
    service.removeItem('col-001', 'item-001').subscribe();
    const req = http.expectOne(r => r.url.includes('/api/collections/col-001/items/item-001') && r.method === 'DELETE');
    req.flush(null);
    expect(service.collections()[0].clothingItemIds).toEqual([]);
  });
});
