import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { DiscoverService } from './discover.service';

describe('DiscoverService', () => {
  let service: DiscoverService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [DiscoverService],
    });
    service = TestBed.inject(DiscoverService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('sends getFeed query params for list filters and paging', () => {
    service.getFeed({
      sortBy: 'recent',
      pageSize: 50,
      continuationToken: 'cursor-1',
      tags: ['denim', 'street'],
      sourceIds: ['src-1', 'src-2'],
      timeRange: '7d',
    }).subscribe();

    const req = http.expectOne((request) =>
      request.method === 'GET' &&
      request.url.includes('/api/scraper/items')
    );
    expect(req.request.params.get('sortBy')).toBe('recent');
    expect(req.request.params.get('pageSize')).toBe('50');
    expect(req.request.params.get('continuationToken')).toBe('cursor-1');
    expect(req.request.params.get('tags')).toBe('denim,street');
    expect(req.request.params.get('sourceIds')).toBe('src-1,src-2');
    expect(req.request.params.get('timeRange')).toBe('7d');
    req.flush({ items: [], nextContinuationToken: null });
  });

  it('loads sources from /scraper/sources and maps payload', () => {
    const sourcePayload = { sources: [{ id: 'src-1', name: 'Reddit', sourceType: 'reddit', isGlobal: true, isActive: true, config: {}, createdAt: 'now' }] };
    let sourceCount = 0;

    service.getSources().subscribe(({ length }) => {
      sourceCount = length;
    });

    const req = http.expectOne((request) => request.method === 'GET' && request.url.includes('/api/scraper/sources'));
    req.flush(sourcePayload);

    expect(sourceCount).toBe(1);
  });

  it('suggests a brand source with post body', () => {
    service.suggestSource('Acme', 'https://acme.example', 'brand').subscribe();

    const req = http.expectOne((request) => request.method === 'POST' && request.url.includes('/api/scraper/sources'));
    expect(req.request.body).toEqual({ name: 'Acme', url: 'https://acme.example', sourceType: 'brand' });
    req.flush({});
  });

  it('joins and leaves subscription endpoints', () => {
    service.subscribe('src-1').subscribe();
    const joinReq = http.expectOne((request) =>
      request.method === 'POST' && request.url.includes('/api/scraper/subscribe/src-1'),
    );
    joinReq.flush({});

    service.unsubscribe('src-1').subscribe();
    const leaveReq = http.expectOne((request) =>
      request.method === 'DELETE' && request.url.includes('/api/scraper/subscribe/src-1'),
    );
    leaveReq.flush({});
  });

  it('posts feedback payload with and without gallery index', () => {
    service.sendFeedback('item-1', 'up').subscribe();
    const noIndexReq = http.expectOne((request) => request.url.includes('/api/scraper/items/item-1/feedback') && request.method === 'POST');
    expect(noIndexReq.request.body).toEqual({ signal: 'up' });
    noIndexReq.flush({ scoreSignal: 4 });

    service.sendFeedback('item-2', 'down', 0).subscribe();
    const indexReq = http.expectOne((request) => request.url.includes('/api/scraper/items/item-2/feedback') && request.method === 'POST');
    expect(indexReq.request.body).toEqual({ signal: 'down', galleryImageIndex: 0 });
    indexReq.flush({ scoreSignal: -1 });
  });

  it('acquires lease and ingests Reddit posts', () => {
    service.acquireLease('src-1').subscribe();
    const leaseReq = http.expectOne((request) => request.method === 'POST' && request.url.includes('/api/scraper/lease/src-1'));
    leaseReq.flush({ status: 'ok', expiresAt: '2026-03-11T00:00:00Z' });

    service.ingestReddit('src-1', [{ title: 'x' }]).subscribe();
    const ingestReq = http.expectOne((request) => request.method === 'POST' && request.url.includes('/api/scraper/ingest/reddit'));
    expect(ingestReq.request.body).toEqual({ source_id: 'src-1', posts: [{ title: 'x' }] });
    ingestReq.flush({ count: 1, status: 'queued' });
  });
});
