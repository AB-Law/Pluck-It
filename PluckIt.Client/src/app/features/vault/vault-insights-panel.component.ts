import { CommonModule } from '@angular/common';
import { Component, computed, input, signal } from '@angular/core';
import { CpwIntelPanelItem, VaultInsightsPanelData } from '../../core/models/vault-insights.model';

@Component({
  selector: 'app-vault-insights-panel',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="mb-8 rounded-xl border border-border-chrome bg-card-dark p-4">
      <div class="mb-3 flex items-center justify-between">
        <h4 class="text-sm font-bold text-slate-100">Smart Insights</h4>
        <span class="text-[10px] font-mono text-slate-500">Behavioral Intelligence</span>
      </div>

      @if (!insights() || insights()!.insufficientData) {
        <p class="text-xs text-slate-500 font-mono">Not enough data yet. Keep logging wears.</p>
      } @else {
        <div class="grid gap-2 md:grid-cols-3">
          <div class="rounded border border-border-chrome bg-black/40 p-3 text-xs text-slate-300">
            @if (topColorShare(); as topColor) {
              You wear {{ topColor.color }} {{ fmtPct(topColor.pct) }} of the time.
            } @else {
              Top color trend is not available yet. Keep logging wears.
            }
          </div>
          <div class="rounded border border-border-chrome bg-black/40 p-3 text-xs text-slate-300">
            You haven’t worn {{ fmtPct(insights()!.behavioralInsights.unworn90dPct) }} of wardrobe in 90 days.
          </div>
          <div class="rounded border border-border-chrome bg-black/40 p-3 text-xs text-slate-300">
            Your most expensive unworn item is
            {{ fmtMoney(insights()!.behavioralInsights.mostExpensiveUnworn?.amount, insights()!.behavioralInsights.mostExpensiveUnworn?.currency) }}.
          </div>
        </div>

        <div class="mt-4">
          <h5 class="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-500">
            CPW Forecast
            <span class="relative inline-block">
              <button
                type="button"
                class="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-700/80 bg-slate-900/80 text-slate-400 hover:text-white"
                aria-label="What is CPW Forecast?"
                (click)="toggleCpwHelp()"
                (mouseenter)="openCpwHelp()"
                (mouseleave)="closeCpwHelp()"
              >
                <span class="material-symbols-outlined text-[12px]">info</span>
              </button>
              @if (cpwHelpOpen()) {
              <div
                  class="absolute left-0 top-full z-50 mt-2 w-72 rounded border border-border-chrome bg-black/95 p-3 text-[11px] text-slate-200 shadow-xl"
                  (mouseenter)="openCpwHelp()"
                  (mouseleave)="closeCpwHelp()"
                >
                  <p class="font-semibold text-slate-100">CPW Forecast</p>
                  <p class="mt-1 text-slate-300 leading-relaxed">
                    CPW is Cost Per Wear. This view predicts how many more wears are needed for a clothing item
                    to hit your target spend-per-wear and projects when that target could be reached based on recent usage.
                  </p>
                </div>
              }
            </span>
          </h5>
          <div class="space-y-2">
            @for (row of topCpwRows(); track row.itemId) {
              <div class="rounded border border-border-chrome bg-black/40 p-3 text-sm text-slate-300">
                <div class="flex items-start gap-3">
                  <div class="min-w-0 flex-1 space-y-1.5">
                    <p class="text-slate-100">
                      {{ cpwItemLabel(row) }} · badge: {{ row.badge }}
                    </p>
                    <p class="text-slate-500">Usage trend: {{ wearTrendText(row) }}.</p>
                    @if (row.forecast?.projectedMonth) {
                      <p>
                        At current usage, this item can reach
                        {{ (row.forecast?.targetCpw ?? 0) | number : '1.0-0' }} CPW by {{ row.forecast?.projectedMonth ?? '—' }}
                        with {{ row.forecast?.projectedWearsNeeded ?? 0 }} more wears.
                      </p>
                    } @else {
                      <p>Forecast unavailable.</p>
                    }
                  </div>
                  @if (row.imageUrl; as rowImage) {
                    <img
                      [src]="rowImage"
                      [alt]="cpwItemLabel(row)"
                      class="h-28 w-20 rounded bg-black/30 object-contain border border-border-chrome/50 shrink-0"
                    />
                  } @else {
                    <div class="h-28 w-20 rounded bg-black/40 border border-border-chrome/50 flex items-center justify-center text-slate-500 shrink-0">
                      <span class="material-symbols-outlined">image</span>
                    </div>
                  }
                </div>
              </div>
            }
          </div>
        </div>
      }
    </section>
  `,
})
export class VaultInsightsPanelComponent {
  insights = input<VaultInsightsPanelData | null>(null);
  protected cpwHelpOpen = signal(false);

  readonly topCpwRows = computed(() => (this.insights()?.cpwIntel ?? []).slice(0, 4));
  readonly topColorShare = computed(() => {
    const topColor = this.insights()?.behavioralInsights.topColorWearShare;
    return topColor?.color && topColor.pct != null ? topColor : null;
  });

  fmtPct(val?: number | null): string {
    if (val == null) return 'N/A';
    return `${val.toFixed(0)}%`;
  }

  fmtMoney(val?: number | null, currency?: string | null): string {
    if (val == null) return 'N/A';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency ?? 'USD',
      maximumFractionDigits: 0,
    }).format(val);
  }

  cpwItemLabel(row: CpwIntelPanelItem): string {
    return row.itemLabel?.trim() || row.itemId;
  }

  wearTrendText(row: CpwIntelPanelItem): string {
    if (
      row.wearRateTrend == null ||
      row.recentWearRate == null ||
      row.historicalWearRate == null
    ) {
      return 'Trend unavailable';
    }

    let trend = 'steady';
    if (row.wearRateTrend === 'up') {
      trend = 'accelerating';
    } else if (row.wearRateTrend === 'down') {
      trend = 'cooling';
    }
    return `${trend} usage (${row.recentWearRate.toFixed(2)} vs ${row.historicalWearRate.toFixed(2)} wears/month)`;
  }

  protected openCpwHelp(): void {
    this.cpwHelpOpen.set(true);
  }

  protected closeCpwHelp(): void {
    this.cpwHelpOpen.set(false);
  }

  protected toggleCpwHelp(): void {
    this.cpwHelpOpen.update(v => !v);
  }
}
