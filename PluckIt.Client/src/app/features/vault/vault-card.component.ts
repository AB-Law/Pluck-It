import { Component, input, output, computed } from '@angular/core';

import { ClothingItem } from '../../core/models/clothing-item.model';
import { CpwBadgeLevel } from '../../core/models/vault-insights.model';

@Component({
  selector: 'app-vault-card',
  standalone: true,
  imports: [],
  template: `
    <div
      class="group relative flex flex-col rounded-xl border bg-card-dark p-4 cursor-pointer transition-all"
      [class]="
        isSelected()
          ? 'border-primary shadow-[0_0_18px_rgba(196,131,106,0.25)]'
          : 'border-border-chrome hover:border-primary/50'
      "
      (click)="selectToggled.emit(item().id)"
      draggable="true"
      (dragstart)="onDragStart($event)"
    >
      <!-- Image area -->
      <div
        class="relative mb-4 flex aspect-[4/5] items-center justify-center overflow-hidden rounded-lg bg-app-elevated"
      >
        <img
          [src]="item().imageUrl"
          [alt]="item().brand || item().category || 'Clothing item'"
          class="item-image-blend h-full w-full object-contain p-4"
          [attr.loading]="priority() ? 'eager' : 'lazy'"
          [attr.fetchpriority]="priority() ? 'high' : 'auto'"
        />

        <!-- CPW Badge or SELECTED badge -->
        @if (isSelected()) {
          <div
            class="absolute left-2 top-2 rounded bg-primary px-2 py-1 text-[10px] font-bold text-chrome"
          >
            SELECTED
          </div>
        } @else {
          <div
            class="absolute left-2 top-2 rounded px-2 py-1 text-[10px] font-bold backdrop-blur-md font-mono border"
            [class]="cpwBadgeClass()"
          >
            CPW: {{ cpwDisplay() }}
          </div>
        }

        <button
          class="absolute right-2 top-2 rounded border border-primary/40 bg-background-dark/70 px-2 py-1 text-[10px] font-bold text-primary hover:bg-primary-soft"
          (click)="onQuickWear($event)"
          aria-label="Log wear"
          title="Log wear (+1)"
        >
          +1 Wear
        </button>
      </div>

      <!-- Metadata -->
      <div class="flex justify-between items-start mb-2">
        <h5 class="text-sm font-bold text-chrome truncate mr-2">
          {{ item().brand || 'Unknown Brand' }}
        </h5>
        @if (aestheticTag()) {
          <span class="text-[10px] font-mono font-bold text-slate-500 shrink-0"
            >[{{ aestheticTag() }}]</span
          >
        }
      </div>
      <div class="flex items-center justify-between text-xs font-mono">
        <span class="text-slate-400">Val: {{ valueDisplay() }}</span>
        <span class="text-slate-500">{{ item().wearCount }} Wears</span>
      </div>
      @if (breakEvenReached()) {
        <div
          class="mt-2 rounded bg-success-soft px-2 py-1 text-[10px] font-mono text-success border border-success/50"
        >
          You’ve broken even on this item
        </div>
      }
    </div>
  `,
})
export class VaultCardComponent {
  item = input.required<ClothingItem>();
  currency = input<string>('USD');
  isSelected = input<boolean>(false);
  cpwBadge = input<CpwBadgeLevel>('unknown');
  breakEvenReached = input<boolean>(false);
  priority = input<boolean>(false);

  selectToggled = output<string>();
  wearIncrementRequested = output<ClothingItem>();

  readonly cpwDisplay = computed(() => {
    const price = this.item().price?.amount;
    const wears = this.item().wearCount ?? 0;
    if (price && wears > 0) {
      const cpw = price / wears;
      return this.formatCurrency(cpw);
    }
    return 'N/A';
  });

  readonly valueDisplay = computed(() => {
    const val = this.item().estimatedMarketValue ?? this.item().price?.amount;
    if (val === null || val === undefined) {
      return '—';
    }
    return this.formatCurrency(val);
  });

  readonly aestheticTag = computed(() => {
    return this.item().aestheticTags?.[0] ?? this.item().category ?? null;
  });

  readonly cpwBadgeClass = computed(() => {
    switch (this.cpwBadge()) {
      case 'low':
        return 'bg-success-soft text-success border-success/60';
      case 'medium':
        return 'bg-info-soft text-info border-info/60';
      case 'high':
        return 'bg-danger-soft text-danger border-danger/60';
      case 'unworn':
        return 'bg-background-dark/80 text-slate-300 border-border-chrome';
      default:
        return 'bg-primary/20 text-primary border-primary/40';
    }
  });

  private formatCurrency(val: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: this.item().price?.originalCurrency ?? this.currency() ?? 'USD',
      maximumFractionDigits: 2,
    }).format(val);
  }

  onDragStart(e: DragEvent): void {
    e.dataTransfer?.setData('text/plain', this.item().id);
    e.dataTransfer?.setData('application/pluckit-item', this.item().id);
  }

  onQuickWear(event: MouseEvent): void {
    event.stopPropagation();
    this.wearIncrementRequested.emit(this.item());
  }
}
