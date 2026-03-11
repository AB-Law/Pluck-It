import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WearHistoryCalendarComponent } from './wear-history-calendar.component';
import { WearHistoryRecord } from '../../core/models/clothing-item.model';

describe('WearHistoryCalendarComponent', () => {
  let component: WearHistoryCalendarComponent;
  let fixture: ComponentFixture<WearHistoryCalendarComponent>;
  const baseDate = new Date(Date.UTC(2026, 2, 15));
  const events: WearHistoryRecord[] = [
  {
    id: 'event-1',
    userId: 'user-1',
    itemId: 'i-1',
    occurredAt: '2026-03-04T12:00:00.000Z',
    createdAt: '2026-03-04T12:00:00.000Z',
  },
  {
    id: 'event-2',
    userId: 'user-1',
    itemId: 'i-1',
    occurredAt: '2026-03-04T18:00:00.000Z',
    createdAt: '2026-03-04T18:00:00.000Z',
  },
  {
    id: 'event-3',
    userId: 'user-1',
    itemId: 'i-2',
    occurredAt: '2026-03-14T12:00:00.000Z',
    createdAt: '2026-03-14T12:00:00.000Z',
  },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WearHistoryCalendarComponent]
    }).compileComponents();
    fixture = TestBed.createComponent(WearHistoryCalendarComponent);
    component = fixture.componentInstance;
    vi.useFakeTimers();
    vi.setSystemTime(baseDate);
    fixture.componentRef.setInput('events', events);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('renders calendar month and pads leading empty cells', () => {
    expect(component.monthLabel()).toBe('March 2026');
    const days = component.calendarDays();
    const firstInMonthIndex = days.findIndex(d => d.inMonth);
    expect(firstInMonthIndex).toBeGreaterThan(-1);
    expect(days[firstInMonthIndex].key).toBe('2026-03-01');
    expect(days[days.length - 1].inMonth).toBe(false);
    expect(days.find(d => d.key === '2026-03-04')?.wearCount).toBe(2);
    expect(days.find(d => d.key === '2026-03-14')?.wearCount).toBe(1);
  });

  it('shifts month boundaries and rebuilds grid', () => {
    const originalLabel = component.monthLabel();
    component.shiftMonth(-1);
    const febLabel = component.monthLabel();
    expect(febLabel).not.toBe(originalLabel);

    component.shiftMonth(1);
    expect(component.monthLabel()).toBe(originalLabel);
  });

  it('projects legacy untracked count when present', () => {
    fixture.componentRef.setInput('summary', { legacyUntrackedCount: 2, totalCount: 3 });
    fixture.detectChanges();
    expect(component.summary()?.legacyUntrackedCount).toBe(2);
  });
});
