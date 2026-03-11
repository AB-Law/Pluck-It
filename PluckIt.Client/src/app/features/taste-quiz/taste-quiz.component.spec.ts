import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { TasteQuizComponent } from './taste-quiz.component';
import { TasteQuizService } from '../../core/services/taste-quiz.service';
import { of, throwError } from 'rxjs';

describe('TasteQuizComponent', () => {
  let component: TasteQuizComponent;
  let fixture: ComponentFixture<TasteQuizComponent>;
  let tasteService: {
    getOrCreateSession: ReturnType<typeof vi.fn>;
    respond: ReturnType<typeof vi.fn>;
    complete: ReturnType<typeof vi.fn>;
  };

  const SESSION_PHASE_1 = {
    id: 'session-1',
    userId: 'u-1',
    phase: 1,
    items: [
      { id: 'bold', imageUrl: undefined, title: 'Bold', primaryMood: 'bold', tags: ['gritty', 'sneaker'] },
      { id: 'soft', imageUrl: undefined, title: 'Soft', primaryMood: 'soft', tags: ['airy', 'coat'] },
    ],
    cards: [
      { primaryMood: 'bold', name: 'Bold', subMoods: ['gritty'], keyPieces: ['sneaker'] },
      { primaryMood: 'soft', name: 'Soft', subMoods: ['airy'], keyPieces: ['coat'] },
    ],
    isComplete: false,
    createdAt: '2026-03-11T00:00:00Z',
  };

  const SESSION_PHASE_2 = {
    id: 'session-2',
    userId: 'u-1',
    phase: 2,
    items: [
      { id: 'item-1', imageUrl: '/img/1.jpg', title: 'Shawl', primaryMood: undefined, tags: ['wool'] },
      { id: 'item-2', imageUrl: '/img/2.jpg', title: 'Tee', primaryMood: undefined, tags: ['cotton'] },
    ],
    imageItems: [
      { scrapedItemId: 'item-1', imageUrl: '/img/1.jpg', title: 'Shawl', tags: ['wool'] },
      { scrapedItemId: 'item-2', imageUrl: '/img/2.jpg', title: 'Tee', tags: ['cotton'] },
    ],
    isComplete: false,
    createdAt: '2026-03-11T00:00:00Z',
  };

  beforeEach(async () => {
    tasteService = {
      getOrCreateSession: vi.fn(),
      respond: vi.fn().mockReturnValue(of(undefined)),
      complete: vi.fn().mockReturnValue(of({ styleKeywords: ['minimal'], brands: [], inferredFrom: 'images' as const })),
    };

    tasteService.getOrCreateSession.mockReturnValue(of(SESSION_PHASE_1));
    await TestBed.configureTestingModule({
      imports: [TasteQuizComponent],
      providers: [
        { provide: ActivatedRoute, useValue: {} },
        { provide: TasteQuizService, useValue: tasteService },
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(TasteQuizComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('loads a normalized phase-1 session and sets loading false', () => {
    expect((component as any).loading()).toBe(false);
    expect((component as any).session()).toEqual(expect.objectContaining({
      id: 'session-1',
      userId: 'u-1',
      phase: 1,
      items: [
        {
          id: 'bold',
          imageUrl: undefined,
          title: 'Bold',
          primaryMood: 'bold',
          tags: ['gritty', 'sneaker'],
        },
        {
          id: 'soft',
          imageUrl: undefined,
          title: 'Soft',
          primaryMood: 'soft',
          tags: ['airy', 'coat'],
        },
      ],
      isComplete: false,
      createdAt: '2026-03-11T00:00:00Z',
    }));
  });

  it('sends mood-card payload and advances cards on answer', () => {
    vi.useFakeTimers();
    component.onChoice('up');
    expect(tasteService.respond).toHaveBeenCalledWith('session-1', { cardPrimaryMood: 'bold', signal: 'up' });
    expect((component as any).responding()).toBe(true);

    vi.advanceTimersByTime(400);
    expect((component as any).currentIndex()).toBe(1);
    expect((component as any).responding()).toBe(false);
    vi.useRealTimers();
  });

  it('normalizes phase-2 session cards and posts scraped-item payload', () => {
    tasteService.getOrCreateSession.mockReturnValueOnce(of(SESSION_PHASE_2));
    component.onRetake();

    expect((component as any).session()!.phase).toBe(2);
    expect(component.currentCard()!.id).toBe('item-1');

    component.onChoice('down');
    expect(tasteService.respond).toHaveBeenCalledWith('session-2', { scrapedItemId: 'item-1', signal: 'down' });
  });

  it('completes quiz at end and stores taste profile', () => {
    const singleCardSession = {
      ...SESSION_PHASE_1,
      items: [{ id: 'bold', imageUrl: undefined, title: 'Bold', primaryMood: 'bold', tags: ['gritty'] }],
      cards: [{ primaryMood: 'bold', name: 'Bold', subMoods: ['gritty'] }],
    };
    tasteService.getOrCreateSession.mockReturnValueOnce(of(singleCardSession));
    component.onRetake();

    vi.useFakeTimers();
    component.onChoice('up');
    vi.advanceTimersByTime(400);
    expect((component as any).responding()).toBe(false);
    expect(tasteService.complete).toHaveBeenCalledWith('session-1');
    vi.useRealTimers();
  });

  it('recovers on service errors and keeps interaction enabled', () => {
    tasteService.respond.mockReturnValueOnce(throwError(() => new Error('net')));
    component.onChoice('down');
    expect(tasteService.respond).toHaveBeenCalledWith('session-1', { cardPrimaryMood: 'bold', signal: 'down' });
    expect((component as any).responding()).toBe(false);
  });

  it('handles swipe gestures with threshold branches', () => {
    component.onCardPointerDown({ clientY: 100 } as PointerEvent);
    expect((component as any).dragging()).toBe(true);

    component.onCardPointerMove({ clientY: 120 } as PointerEvent);
    expect((component as any).dragOffsetY()).toBe(20);

    component.onCardPointerUp();
    expect((component as any).dragOffsetY()).toBe(0);
    expect((component as any).responding()).toBe(false);

    component.onCardPointerDown({ clientY: 100 } as PointerEvent);
    component.onCardPointerMove({ clientY: 200 } as PointerEvent);
    component.onCardPointerUp();
    expect(tasteService.respond).toHaveBeenCalledWith('session-1', { cardPrimaryMood: 'bold', signal: 'down' });
  });

  it('resets quiz state on retake and reloads session', () => {
    vi.spyOn(tasteService, 'getOrCreateSession').mockReturnValueOnce(of(SESSION_PHASE_2));
    component.onRetake();
    expect((component as any).tasteProfile()).toBe(null);
    expect((component as any).currentIndex()).toBe(0);
    expect((component as any).session()!.phase).toBe(2);
  });
});
