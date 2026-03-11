import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DigestPanelComponent } from './digest-panel.component';
import { DigestService } from '../../core/services/digest.service';
import { throwError, of } from 'rxjs';

describe('DigestPanelComponent', () => {
  let component: DigestPanelComponent;
  let fixture: ComponentFixture<DigestPanelComponent>;
  let digestService: {
    getLatest: ReturnType<typeof vi.fn>,
    getFeedback: ReturnType<typeof vi.fn>,
    sendFeedback: ReturnType<typeof vi.fn>,
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
    await TestBed.configureTestingModule({
      imports: [DigestPanelComponent],
      providers: [ { provide: DigestService, useValue: digestService } ],
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
    });
    expect(component.feedbackSent()[1]).toBe('down');

    digestService.sendFeedback.mockReturnValueOnce(throwError(() => new Error('failed')));
    component.sendFeedback(1, { item: 'Tailored jacket', rationale: 'Sharp silhouette' }, 'up');
    expect(component.feedbackSent()[1]).toBe(null);
  });
});
