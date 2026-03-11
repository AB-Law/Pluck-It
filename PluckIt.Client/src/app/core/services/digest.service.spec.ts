import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { DigestService } from './digest.service';
import { WardrobeDigest } from '../models/digest.model';

describe('DigestService', () => {
  let service: DigestService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [DigestService],
    });
    service = TestBed.inject(DigestService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads latest digest', () => {
    const mock = {
      digest: {
        id: 'd1',
        userId: 'user-1',
        generatedAt: '2026-03-11T00:00:00Z',
        wardrobeHash: 'hash',
        suggestions: [],
        stylesConsidered: ['minimal'],
        totalItems: 0,
      },
    };
    let observed: { digest: WardrobeDigest | null } | null = null;

    service.getLatest().subscribe((payload) => {
      observed = payload;
    });

    const req = http.expectOne((request) =>
      request.method === 'GET' && request.url.includes('/api/digest/latest'),
    );
    req.flush(mock);

    expect(observed).toEqual(mock);
  });

  it('loads digest feedback list', () => {
    const payload = { feedback: [{ suggestionIndex: 2, signal: 'up' as string }] };
    let observed: { feedback: { suggestionIndex: number; signal: string }[] } | null = null;

    service.getFeedback('digest-1').subscribe((response) => {
      observed = response;
    });

    const req = http.expectOne((request) =>
      request.method === 'GET' && request.url.includes('/api/digest/feedback'),
    );
    expect(req.request.params.get('digestId')).toBe('digest-1');
    req.flush(payload);

    expect(observed).toEqual(payload);
  });

  it('posts feedback request', () => {
    const payload = {
      digestId: 'digest-1',
      suggestionIndex: 0,
      suggestionDescription: 'Blue jacket',
      signal: 'down' as const,
    };

    service.sendFeedback(payload).subscribe();

    const req = http.expectOne((request) =>
      request.method === 'POST' && request.url.includes('/api/digest/feedback'),
    );
    expect(req.request.body).toEqual(payload);
    req.flush({ status: 'ok' });
  });
});
