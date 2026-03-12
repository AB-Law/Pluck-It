import { ComponentFixture, TestBed } from '@angular/core/testing';
import { VaultInsightsResponse } from '../../core/models/vault-insights.model';
import { VaultInsightsPanelComponent } from './vault-insights-panel.component';

describe('VaultInsightsPanelComponent', () => {
  let component: VaultInsightsPanelComponent;
  let fixture: ComponentFixture<VaultInsightsPanelComponent>;
  const baseInsights: VaultInsightsResponse = {
    generatedAt: '2026-03-12T00:00:00Z',
    currency: 'USD',
    insufficientData: false,
    behavioralInsights: {
      topColorWearShare: { color: 'black', pct: 42 },
      unworn90dPct: 12,
      mostExpensiveUnworn: { itemId: 'item-1', amount: 3200, currency: 'USD' },
      sparseHistory: false,
    },
    cpwIntel: [
      {
        itemId: 'upload-f1a8f93a',
        badge: 'unworn',
        breakEvenReached: false,
        breakEvenTargetCpw: 100,
        itemLabel: 'White Oversized Tee',
        recentWearRate: 0.75,
        historicalWearRate: 0.35,
        wearRateTrend: 'up',
        imageUrl: 'https://example.com/tee.png',
        forecast: null,
      },
    ],
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [VaultInsightsPanelComponent]
    }).compileComponents();
    fixture = TestBed.createComponent(VaultInsightsPanelComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('insights', baseInsights);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows a top color sentence when top color insight exists', () => {
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('You wear black 42% of the time.');
  });

  it('displays the enriched item label and trend line', () => {
    const root = fixture.nativeElement as HTMLElement;
    const text = (root.textContent ?? '').replaceAll(/\s+/g, ' ');
    expect(text).toContain('White Oversized Tee');
    expect(text).toContain('Usage trend: accelerating usage (0.75 vs 0.35 wears/month).');
  });

  it('shows a clear fallback when top color insight is missing', () => {
    fixture.componentRef.setInput('insights', {
      ...baseInsights,
      behavioralInsights: { ...baseInsights.behavioralInsights, topColorWearShare: null },
    });
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Top color trend is not available yet. Keep logging wears.');
  });

  it('renders CPW forecast unavailable and available states', () => {
    fixture.componentRef.setInput('insights', {
      ...baseInsights,
      cpwIntel: [
        {
          itemId: 'upload-f1a8f93a',
          badge: 'unworn',
          breakEvenReached: false,
          breakEvenTargetCpw: 100,
          recentWearRate: null,
          historicalWearRate: null,
          forecast: null,
        },
        {
          itemId: 'upload-c31ae102',
          badge: 'medium',
          breakEvenReached: false,
          breakEvenTargetCpw: 100,
          itemLabel: 'Midnight Bomber',
          recentWearRate: 0.1,
          historicalWearRate: 0.7,
          wearRateTrend: 'down',
          wearRateDelta: -0.6,
          forecast: {
            targetCpw: 100,
            projectedMonth: '2035-12',
            projectedWearsNeeded: 120,
          },
        },
      ],
    });
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const text = (root.textContent ?? '').replaceAll(/\s+/g, ' ');
    expect(text).toContain('upload-f1a8f93a');
    expect(text).toContain('Forecast unavailable.');
    expect(text).toContain('Usage trend: Trend unavailable.');
    expect(text).toContain('Midnight Bomber · badge: medium');
    expect(text).toContain('Usage trend: cooling usage (0.10 vs 0.70 wears/month).');
    expect(text).toContain('At current usage, this item can reach 100 CPW by 2035-12 with 120 more wears.');
  });

  it('renders cpw forecast item image when image url is available', () => {
    fixture.detectChanges();
    const img = fixture.nativeElement.querySelector('img');
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe('https://example.com/tee.png');
  });

  it('renders insufficient data message when insights are missing', () => {
    fixture.componentRef.setInput('insights', null);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Not enough data yet. Keep logging wears.');
  });
});
