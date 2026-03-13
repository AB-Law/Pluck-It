import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DigestPanelComponent } from './digest-panel.component';
import { DigestService } from '../../core/services/digest.service';
import { OfflineQueueService } from '../../core/services/offline-queue.service';
import { NetworkService } from '../../core/services/network.service';
import { throwError, of } from 'rxjs';

describe('DigestPanelComponent', () => {
  let component: DigestPanelComponent;
  let fixture: ComponentFixture<DigestPanelComponent>;
  let digestService: {
    getLatest: ReturnType<typeof vi.fn>,
    getFeedback: ReturnType<typeof vi.fn>,
    sendFeedback: ReturnType<typeof vi.fn>,
  };
  let networkService: {
    isCurrentlyOnline: ReturnType<typeof vi.fn>,
  };
  let offlineQueue: {
    enqueue: ReturnType<typeof vi.fn>,
    drain: ReturnType<typeof vi.fn>,
    persistOfflineUploads: ReturnType<typeof vi.fn>,
  };

  const DIGEST = {
    id: 'd-1',
    totalItems: 2,
    itemsWithWearHistory: 1,
    generatedAt: '2026-03-01T00:00:00Z',
    climateZone: 'cool',
    suggestions: [
      { item: 'Soft knit sweater', rationale: 'Comfort first' },
      { item: 'Tailored jacket', rationale: 'Sharp silhouette' },
    ],
  };

  beforeEach(async () => {
    digestService = {
      getLatest: vi.fn().mockReturnValue(of({ digest: DIGEST })),
      getFeedback: vi.fn().mockReturnValue(of({ feedback: [{ suggestionIndex: 0, signal: 'up' }] })),
      sendFeedback: vi.fn().mockReturnValue(of({ status: 'ok' })),
    };
    networkService = {
      isCurrentlyOnline: vi.fn().mockReturnValue(true),
    };
    offlineQueue = {
      enqueue: vi.fn(),
      drain: vi.fn().mockReturnValue([]),
      persistOfflineUploads: vi.fn(),
    };
    await TestBed.configureTestingModule({
      imports: [DigestPanelComponent],
      providers: [
        { provide: DigestService, useValue: digestService },
        { provide: NetworkService, useValue: networkService },
        { provide: OfflineQueueService, useValue: offlineQueue },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(DigestPanelComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('loads digest and restores prior feedback', () => {
    expect(component.loading()).toBe(false);
    expect(component.digest()).toEqual(DIGEST);
    expect(component.feedbackSent()).toEqual(['up', null]);
    expect(component.rationaleOpen()).toEqual([false, false]);
  });

  it('toggles rationale expansion for a suggestion', () => {
    expect(component.rationaleOpen()[0]).toBe(false);
    component.toggleRationale(0);
    expect(component.rationaleOpen()[0]).toBe(true);
    component.toggleRationale(0);
    expect(component.rationaleOpen()[0]).toBe(false);
  });

  it('sends feedback and updates local state on success, resets on error', () => {
    component.sendFeedback(1, { item: 'Tailored jacket', rationale: 'Sharp silhouette' }, 'down');
    expect(digestService.sendFeedback).toHaveBeenCalledWith({
      digestId: 'd-1',
      suggestionIndex: 1,
      suggestionDescription: 'Tailored jacket',
      signal: 'down',
      retryCount: 0,
    });
    expect(component.feedbackSent()[1]).toBe('down');

    digestService.sendFeedback.mockReturnValueOnce(throwError(() => new Error('failed')));
    component.sendFeedback(1, { item: 'Tailored jacket', rationale: 'Sharp silhouette' }, 'up');
    expect(component.feedbackSent()[1]).toBe(null);
  });

  it('queues feedback when offline and does not call API immediately', () => {
    networkService.isCurrentlyOnline.mockReturnValue(false);

    component.sendFeedback(1, { item: 'Tailored jacket', rationale: 'Sharp silhouette' }, 'up');

    expect(offlineQueue.enqueue).toHaveBeenCalledWith(
      'digest/feedback',
      {
        digestId: 'd-1',
        suggestionIndex: 1,
        suggestionDescription: 'Tailored jacket',
        signal: 'up',
        retryCount: 0,
      },
    );
    expect(digestService.sendFeedback).not.toHaveBeenCalled();
    expect(component.feedbackSent()[1]).toBe('up');
  });

  it('replays queued offline feedback when back online', async () => {
    networkService.isCurrentlyOnline.mockReturnValue(false);
    offlineQueue.drain.mockReturnValueOnce([
      {
        id: 'digest-q1',
        type: 'digest/feedback',
        timestamp: Date.now(),
        payload: {
          digestId: 'd-1',
          suggestionIndex: 0,
          suggestionDescription: 'Tailored jacket',
          signal: 'up',
        },
      },
    ]);
    networkService.isCurrentlyOnline.mockReturnValue(true);

    await (component as any)._drainOfflineDigestFeedback();

    expect(digestService.sendFeedback).toHaveBeenCalledWith({
      digestId: 'd-1',
      suggestionIndex: 0,
      suggestionDescription: 'Tailored jacket',
      signal: 'up',
    });
    expect(offlineQueue.persistOfflineUploads).toHaveBeenCalledWith([]);
  });

  it('drops malformed queued feedback payloads instead of requeuing', async () => {
    networkService.isCurrentlyOnline.mockReturnValue(true);
    offlineQueue.drain.mockReturnValueOnce([
      {
        id: 'digest-q-malformed',
        type: 'digest/feedback',
        timestamp: Date.now(),
        payload: { digestId: 123, signal: 'up' },
      },
    ]);

    await (component as any)._drainOfflineDigestFeedback();

    expect(digestService.sendFeedback).not.toHaveBeenCalled();
    expect(offlineQueue.persistOfflineUploads).toHaveBeenCalledWith([]);
  });
});
