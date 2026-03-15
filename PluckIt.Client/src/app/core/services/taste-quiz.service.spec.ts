import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TasteQuizService } from './taste-quiz.service';
import { TasteProfile } from '../models/scraped-item.model';

describe('TasteQuizService', () => {
  let service: TasteQuizService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [TasteQuizService],
    });
    service = TestBed.inject(TasteQuizService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('normalizes phase 1 sessions and strips user prefix from session ID', () => {
    const raw = {
      userId: 'user-123',
      id: 'user-123-session-abc',
      phase: 1,
      cards: [
        { id: 'mood-1', name: 'Warm', primaryMood: 'cozy', subMoods: ['casual'], keyPieces: ['soft'] },
      ],
      isComplete: false,
      createdAt: '2026-03-11T00:00:00Z',
    };

    service.getOrCreateSession().subscribe(session => {
      expect(session.id).toBe('session-abc');
      expect(session.phase).toBe(1);
      expect(session.items[0].id).toBe('cozy');
      expect(session.items[0].title).toBe('Warm');
      expect(session.items[0].tags).toEqual(['casual', 'soft']);
    });

    const req = http.expectOne((request) => request.method === 'GET' && request.url.includes('/api/taste/quiz'));
    req.flush(raw);
  });

  it('normalizes phase 2 sessions from image items', () => {
    const raw = {
      sessionId: 'session-xyz',
      userId: 'u1',
      id: 'u1-abc',
      phase: 2,
      imageItems: [
        { scrapedItemId: 'item-1', imageUrl: 'https://img/1', title: 'Top', tags: ['layered'] },
      ],
      isComplete: false,
      createdAt: '2026-03-11T00:00:00Z',
    };

    service.getOrCreateSession().subscribe(session => {
      expect(session.id).toBe('session-xyz');
      expect(session.phase).toBe(2);
      expect(session.items[0]).toEqual({
        id: 'item-1',
        imageUrl: 'https://img/1',
        title: 'Top',
        primaryMood: undefined,
        tags: ['layered'],
      });
    });

    const req = http.expectOne((request) => request.method === 'GET' && request.url.includes('/api/taste/quiz'));
    req.flush(raw);
  });

  it('posts response payload and forwards complete result for phase-2', () => {
    service.respond('session-1', { scrapedItemId: 'item-1', signal: 'up' }).subscribe();
    const req = http.expectOne((request) => request.method === 'POST' && request.url.includes('/api/taste/quiz/session-1/respond'));
    expect(req.request.body).toEqual({ scrapedItemId: 'item-1', signal: 'up' });
    req.flush({});
  });

  it('falls back to raw payload when inferredTastes is missing in complete response', () => {
    const rawProfile = {
      styleKeywords: ['minimal'],
      brands: ['Acme'],
      inferredFrom: 'mood_cards',
    };
    let emitted: TasteProfile | null = null;

    service.complete('session-1').subscribe(profile => {
      emitted = profile;
    });

    const req = http.expectOne((request) => request.method === 'POST' && request.url.includes('/api/taste/quiz/session-1/complete'));
    req.flush(rawProfile);

    expect(emitted).toEqual(rawProfile);
  });
});
