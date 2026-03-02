import { Component, input, output, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ClothingItem } from '../../core/models/clothing-item.model';

@Component({
  selector: 'app-vault-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      class="group relative flex flex-col rounded-xl border bg-card-dark p-4 cursor-pointer transition-all"
      [class]="isSelected() ? 'border-primary shadow-[0_0_15px_rgba(37,141,244,0.15)]' : 'border-border-chrome hover:border-primary/50'"
      (click)="selectToggled.emit(item().id)"
      draggable="true"
      (dragstart)="onDragStart($event)"
    >
      <!-- Image area -->
      <div class="relative mb-4 flex aspect-[4/5] items-center justify-center overflow-hidden rounded-lg bg-black">
        <img
          [src]="item().imageUrl"
          [alt]="item().brand || item().category || 'Clothing item'"
          class="h-full w-full object-contain p-4"
          style="mix-blend-mode: lighten"
          loading="lazy"
        />

        <!-- CPW Badge or SELECTED badge -->
        @if (isSelected()) {
          <div class="absolute left-2 top-2 rounded bg-primary px-2 py-1 text-[10px] font-bold text-white">
            SELECTED
          </div>
        } @else {
          <div class="absolute left-2 top-2 rounded bg-primary/20 px-2 py-1 text-[10px] font-bold text-primary backdrop-blur-md font-mono">
            CPW: {{ cpwDisplay() }}
          </div>
        }
      </div>

      <!-- Metadata -->
      <div class="flex justify-between items-start mb-2">
        <h5 class="text-sm font-bold text-slate-100 truncate mr-2">
          {{ item().brand || 'Unknown Brand' }}
        </h5>
        @if (aestheticTag()) {
          <span class="text-[10px] font-mono font-bold text-slate-500 shrink-0">[{{ aestheticTag() }}]</span>
        }
      </div>
      <div class="flex items-center justify-between text-xs font-mono">
        <span class="text-slate-400">Val: {{ valueDisplay() }}</span>
        <span class="text-slate-500">{{ item().wearCount }} Wears</span>
      </div>
    </div>
  `,
})
export class VaultCardComponent {
  item       = input.required<ClothingItem>();
  currency   = input<string>('USD');
  isSelected = input<boolean>(false);

  selectToggled = output<string>();

  readonly cpwDisplay = computed(() => {
    const price = this.item().price?.amount;
    const wears = this.item().wearCount ?? 0;
    if (!price || wears === 0) return 'N/A';
    const cpw = price / wears;
    return this.formatCurrency(cpw);
  });

  readonly valueDisplay = computed(() => {
    const val = this.item().estimatedMarketValue ?? this.item().price?.amount;
    return val != null ? this.formatCurrency(val) : '—';
  });

  readonly aestheticTag = computed(() => {
    return this.item().aestheticTags?.[0] ?? this.item().category ?? null;
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
}
