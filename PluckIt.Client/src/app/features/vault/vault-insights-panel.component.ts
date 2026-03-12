import { CommonModule } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { VaultInsightsResponse } from '../../core/models/vault-insights.model';

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
          <h5 class="mb-2 text-xs font-bold uppercase tracking-widest text-slate-500">CPW Forecast</h5>
          <div class="space-y-2">
            @for (row of topCpwRows(); track row.itemId) {
              <div class="rounded border border-border-chrome bg-black/40 p-2 text-[11px] font-mono text-slate-300">
                {{ row.itemId }} · badge: {{ row.badge }} ·
                @if (row.forecast?.projectedMonth) {
                  At current usage, this item can reach
                  {{ (row.forecast?.targetCpw ?? 0) | number : '1.0-0' }} CPW by {{ row.forecast?.projectedMonth ?? '—' }}.
                } @else {
                  Forecast unavailable.
                }
              </div>
            }
          </div>
        </div>
      }
    </section>
  `,
})
export class VaultInsightsPanelComponent {
  insights = input<VaultInsightsResponse | null>(null);

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
}
