import { Component, input, output, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { RangeSliderComponent } from '../../shared/range-slider.component';

export type SmartGroup = 'all' | 'favorites' | 'recent' | 'collections';

export interface VaultFilters {
  group: SmartGroup;
  priceRange: [number, number];
  minWears: number;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', INR: '₹', JPY: '¥', CAD: 'C$', AUD: 'A$',
};

@Component({
  selector: 'app-vault-sidebar',
  standalone: true,
  imports: [CommonModule, RouterLink, RangeSliderComponent],
  template: `
    <aside class="w-64 flex-shrink-0 flex-col border-r border-border-chrome bg-black p-6 hidden md:flex overflow-y-auto">

      <!-- Smart Groups -->
      <div class="mb-8">
        <h3 class="mb-4 text-xs font-bold uppercase tracking-widest text-slate-500">Smart Groups</h3>
        <nav class="space-y-1">
          @for (g of groups; track g.id) {
            <button
              class="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
              [class]="g.id === activeGroup() ? 'bg-primary/10 text-primary' : 'text-slate-400 hover:bg-card-dark hover:text-slate-100'"
              (click)="selectGroup(g.id)"
            >
              <span class="material-symbols-outlined text-lg">{{ g.icon }}</span>
              {{ g.label }}
            </button>
          }
          <a
            routerLink="/collections"
            class="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-400 hover:bg-card-dark hover:text-slate-100 transition-colors"
          >
            <span class="material-symbols-outlined text-lg">folder_special</span>
            Collections
          </a>
        </nav>
      </div>

      <!-- Range Matrix -->
      <div class="mb-8">
        <h3 class="mb-4 text-xs font-bold uppercase tracking-widest text-slate-500">The Range Matrix</h3>
        <div class="space-y-6 px-1">

          <!-- Price Range -->
          <div>
            <div class="mb-3 flex justify-between text-xs font-medium font-mono">
              <span class="text-slate-400">Price Range</span>
              <span class="text-primary">{{ priceLabel() }}</span>
            </div>
            <app-range-slider
              [min]="0"
              [max]="maxPrice()"
              [step]="10"
              [(value)]="priceRange"
              (valueChange)="onPriceChange($event)"
            />
          </div>

          <!-- Min Wears -->
          <div>
            <div class="mb-3 flex justify-between text-xs font-medium font-mono">
              <span class="text-slate-400">Min. Wears</span>
              <span class="text-primary">{{ minWears() }}+ Wear</span>
            </div>
            <div class="relative h-1 w-full rounded-full bg-border-chrome">
              <div
                class="absolute h-full rounded-full bg-primary"
                [style.width.%]="wearPct()"
              ></div>
              <div
                class="absolute top-1/2 h-3 w-3 rounded-full border-2 border-primary bg-black cursor-pointer"
                [style.left.%]="wearPct()"
                style="transform: translate(-50%, -50%)"
                (mousedown)="startWearDrag($event)"
                (document:mousemove)="onWearDrag($event)"
                (document:mouseup)="stopWearDrag()"
              ></div>
            </div>
          </div>

        </div>
      </div>

    </aside>
  `,
})
export class VaultSidebarComponent {
  maxPrice  = input<number>(5000);
  currency  = input<string>('USD');
  filtersChange = output<VaultFilters>();

  activeGroup = signal<SmartGroup>('all');
  priceRange  = signal<[number, number]>([0, 5000]);
  minWears    = signal<number>(0);

  private wearDragging = false;
  private readonly maxWears = 200;

  readonly groups = [
    { id: 'all'      as SmartGroup, icon: 'grid_view', label: 'All Items'     },
    { id: 'favorites'as SmartGroup, icon: 'star',      label: 'Favorites'     },
    { id: 'recent'   as SmartGroup, icon: 'schedule',  label: 'Worn Recently' },
  ];

  readonly priceLabel = computed(() => {
    const [lo, hi] = this.priceRange();
    const sym = CURRENCY_SYMBOLS[this.currency()] ?? this.currency();
    return `${sym}${lo.toLocaleString()} – ${sym}${hi.toLocaleString()}`;
  });

  readonly wearPct = computed(() => (this.minWears() / this.maxWears) * 100);

  selectGroup(g: SmartGroup): void {
    this.activeGroup.set(g);
    this.emit();
  }

  onPriceChange(range: [number, number]): void {
    this.priceRange.set(range);
    this.emit();
  }

  startWearDrag(e: MouseEvent): void { e.preventDefault(); this.wearDragging = true; }
  stopWearDrag(): void { this.wearDragging = false; }

  onWearDrag(e: MouseEvent): void {
    if (!this.wearDragging) return;
    // Find the slider element — ancestor of the thumb
    const thumb = document.elementFromPoint(e.clientX, e.clientY);
    const track = (thumb?.closest('.relative') as HTMLElement | null);
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const val = Math.round(ratio * this.maxWears);
    this.minWears.set(val);
    this.emit();
  }

  private emit(): void {
    this.filtersChange.emit({
      group: this.activeGroup(),
      priceRange: this.priceRange(),
      minWears: this.minWears(),
    });
  }
}
