import { Component, input, output, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { RangeSliderComponent } from '../../shared/range-slider.component';
import { ItemCondition } from '../../core/models/clothing-item.model';
import type { WardrobeSortField } from '../../core/models/clothing-item.model';

export type SmartGroup = 'all' | 'favorites' | 'recent' | 'collections';

export interface VaultFilters {
  group:       SmartGroup;
  priceRange:  [number, number];
  minWears:    number;
  brand?:      string;
  condition?:  ItemCondition | '';
  sortField:   WardrobeSortField;
  sortDir:     'asc' | 'desc';
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', INR: '₹', JPY: '¥', CAD: 'C$', AUD: 'A$',
};

interface SortOption {
  label:     string;
  sortField: WardrobeSortField;
  sortDir:   'asc' | 'desc';
}

const SORT_OPTIONS: SortOption[] = [
  { label: 'Newest First',       sortField: 'dateAdded',    sortDir: 'desc' },
  { label: 'Oldest First',       sortField: 'dateAdded',    sortDir: 'asc'  },
  { label: 'Most Worn',          sortField: 'wearCount',    sortDir: 'desc' },
  { label: 'Least Worn',         sortField: 'wearCount',    sortDir: 'asc'  },
  { label: 'Price: High to Low', sortField: 'price.amount', sortDir: 'desc' },
  { label: 'Price: Low to High', sortField: 'price.amount', sortDir: 'asc'  },
];

const CONDITIONS: Array<{ label: string; value: ItemCondition }> = [
  { label: 'New',       value: 'New'       },
  { label: 'Excellent', value: 'Excellent' },
  { label: 'Good',      value: 'Good'      },
  { label: 'Fair',      value: 'Fair'      },
];

@Component({
  selector: 'app-vault-sidebar',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, RangeSliderComponent],
  template: `
    <aside
      class="w-64 flex-shrink-0 flex-col border-r border-border-chrome bg-black p-6 overflow-y-auto"
      [class.fixed]="mobileMode()"
      [class.inset-0]="mobileMode()"
      [class.z-50]="mobileMode()"
      [class.right-0]="mobileMode()"
      [class.bg-black]="mobileMode()"
      [class.w-full]="mobileMode()"
    >
      @if (mobileMode()) {
        <div class="mb-4 flex items-center justify-between">
          <h3 class="text-sm font-bold uppercase tracking-wider text-slate-500">Filters</h3>
          <button
            type="button"
            class="h-10 w-10 flex items-center justify-center rounded-lg bg-card-dark text-slate-text hover:text-white hover:bg-[#333] touch-target"
            title="Close filters"
            aria-label="Close filters"
            (click)="closed.emit()"
          >
            <span class="material-symbols-outlined" style="font-size:20px">close</span>
          </button>
        </div>
      }

      <!-- Smart Groups -->
      <div class="mb-8">
        <h3 class="mb-4 text-xs font-bold uppercase tracking-widest text-slate-500">Smart Groups</h3>
        <nav class="space-y-1">
          @for (g of groups; track g.id) {
            <button
              class="touch-target w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
              [class]="g.id === activeGroup() ? 'bg-primary/10 text-primary' : 'text-slate-400 hover:bg-card-dark hover:text-slate-100'"
              (click)="selectGroup(g.id)"
            >
              <span class="material-symbols-outlined text-lg">{{ g.icon }}</span>
              {{ g.label }}
            </button>
          }
            <a
              routerLink="/collections"
              class="touch-target w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-400 hover:bg-card-dark hover:text-slate-100 transition-colors"
          >
            <span class="material-symbols-outlined text-lg">folder_special</span>
            Collections
          </a>
        </nav>
      </div>

      <!-- Sort -->
      <div class="mb-8">
        <h3 class="mb-4 text-xs font-bold uppercase tracking-widest text-slate-500">Sort By</h3>
        <select
          class="w-full rounded-lg bg-card-dark border border-[#333] text-sm text-slate-200 px-3 py-2 outline-none focus:border-primary/60 transition-colors font-mono"
          [ngModel]="sortKey()"
          (ngModelChange)="onSortChange($event)"
        >
          @for (opt of sortOptions; track opt.label) {
            <option [value]="opt.sortField + ':' + opt.sortDir">{{ opt.label }}</option>
          }
        </select>
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
              class="touch-target cursor-pointer"
              (pointerdown)="startWearDrag($event)"
              (document:pointermove)="onWearDrag($event)"
              (document:pointerup)="stopWearDrag()"
              ></div>
            </div>
          </div>

        </div>
      </div>

      <!-- Brand Filter -->
      <div class="mb-8">
        <h3 class="mb-4 text-xs font-bold uppercase tracking-widest text-slate-500">Brand</h3>
        <div class="flex items-center rounded-lg bg-card-dark border border-[#333] focus-within:border-primary/60 transition-colors">
          <span class="pl-3 text-slate-500 material-symbols-outlined" style="font-size:16px">search</span>
          <input
            class="w-full bg-transparent text-sm text-white placeholder-slate-500 outline-none py-2 px-2 font-mono"
            placeholder="e.g. Nike, Zara..."
            [ngModel]="brandFilter()"
            (ngModelChange)="onBrandChange($event)"
          />
          @if (brandFilter()) {
            <button class="touch-target pr-3 text-slate-500 hover:text-white" (click)="onBrandChange('')">
              <span class="material-symbols-outlined" style="font-size:14px">close</span>
            </button>
          }
        </div>
      </div>

      <!-- Condition Filter -->
      <div class="mb-8">
        <h3 class="mb-4 text-xs font-bold uppercase tracking-widest text-slate-500">Condition</h3>
        <div class="flex flex-wrap gap-2">
          @for (c of conditions; track c.value) {
            <button
              class="touch-target px-3 py-1 rounded-full text-xs font-medium border transition-colors"
              [class]="activeCondition() === c.value
                ? 'bg-primary/15 border-primary/50 text-primary'
                : 'bg-card-dark border-[#333] text-slate-400 hover:border-slate-500 hover:text-white'"
              (click)="toggleCondition(c.value)"
            >
              {{ c.label }}
            </button>
          }
        </div>
      </div>

      <!-- Clear All -->
      @if (hasActiveFilters()) {
        <button
          class="touch-target w-full text-xs font-bold uppercase tracking-widest py-2 rounded-lg border border-[#333] text-slate-500 hover:text-white hover:border-slate-500 transition-colors"
          (click)="clearAll()"
        >
          Clear All Filters
        </button>
      }

    </aside>
  `,
})
export class VaultSidebarComponent implements OnInit {
  maxPrice       = input<number>(5000);
  currency       = input<string>('USD');
  /** Seed initial filter state (e.g. restored from URL on parent init). */
  initialFilters = input<Partial<VaultFilters>>({});
  mobileMode = input<boolean>(false);

  /** Emitted only when the sidebar is rendered in mobile mode and user closes it. */
  closed = output<void>();

  filtersChange  = output<VaultFilters>();

  activeGroup     = signal<SmartGroup>('all');
  priceRange      = signal<[number, number]>([0, 5000]);
  minWears        = signal<number>(0);
  brandFilter     = signal<string>('');
  activeCondition = signal<ItemCondition | ''>('');
  sortField       = signal<WardrobeSortField>('dateAdded');
  sortDir         = signal<'asc' | 'desc'>('desc');

  private wearDragging = false;
  private readonly maxWears = 200;

  readonly sortOptions = SORT_OPTIONS;
  readonly conditions  = CONDITIONS;

  readonly groups = [
    { id: 'all'       as SmartGroup, icon: 'grid_view', label: 'All Items'     },
    { id: 'favorites' as SmartGroup, icon: 'star',      label: 'Favorites'     },
    { id: 'recent'    as SmartGroup, icon: 'schedule',  label: 'Worn Recently' },
  ];

  readonly sortKey = computed(() => `${this.sortField()}:${this.sortDir()}`);

  readonly priceLabel = computed(() => {
    const [lo, hi] = this.priceRange();
    const sym = CURRENCY_SYMBOLS[this.currency()] ?? this.currency();
    return `${sym}${lo.toLocaleString()} - ${sym}${hi.toLocaleString()}`;
  });

  readonly wearPct = computed(() => (this.minWears() / this.maxWears) * 100);

  readonly hasActiveFilters = computed(() =>
    !!this.brandFilter() ||
    !!this.activeCondition() ||
    this.priceRange()[0] > 0 ||
    this.priceRange()[1] < this.maxPrice() ||
    this.minWears() > 0 ||
    this.sortField() !== 'dateAdded' ||
    this.sortDir() !== 'desc'
  );

  ngOnInit(): void {
    const init = this.initialFilters();
    if (init.group)      this.activeGroup.set(init.group);
    if (init.priceRange) this.priceRange.set(init.priceRange);
    if (init.minWears)   this.minWears.set(init.minWears);
    if (init.brand)      this.brandFilter.set(init.brand);
    if (init.condition) this.activeCondition.set(init.condition);
    if (init.sortField)  this.sortField.set(init.sortField);
    if (init.sortDir)    this.sortDir.set(init.sortDir);
  }

  selectGroup(g: SmartGroup): void {
    this.activeGroup.set(g);
    this.emit();
  }

  onPriceChange(range: [number, number]): void {
    this.priceRange.set(range);
    this.emit();
  }

  onBrandChange(brand: string): void {
    this.brandFilter.set(brand);
    this.emit();
  }

  onSortChange(key: string): void {
    const [field, dir] = key.split(':');
    this.sortField.set(field as WardrobeSortField);
    this.sortDir.set(dir as 'asc' | 'desc');
    this.emit();
  }

  toggleCondition(c: ItemCondition): void {
    this.activeCondition.set(this.activeCondition() === c ? '' : c);
    this.emit();
  }

  clearAll(): void {
    this.priceRange.set([0, this.maxPrice()]);
    this.minWears.set(0);
    this.brandFilter.set('');
    this.activeCondition.set('');
    this.sortField.set('dateAdded');
    this.sortDir.set('desc');
    this.emit();
  }

  startWearDrag(e: PointerEvent): void {
    e.preventDefault();
    this.wearDragging = true;
    (e.currentTarget as HTMLElement | null)?.setPointerCapture?.(e.pointerId);
  }
  stopWearDrag(): void { this.wearDragging = false; }

  onWearDrag(e: PointerEvent): void {
    if (!this.wearDragging) return;
    const thumb = document.elementFromPoint(e.clientX, e.clientY);
    const track = (thumb?.closest('.relative') as HTMLElement | null);
    if (!track) return;
    const rect  = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    this.minWears.set(Math.round(ratio * this.maxWears));
    this.emit();
  }

  private emit(): void {
    this.filtersChange.emit({
      group:      this.activeGroup(),
      priceRange: this.priceRange(),
      minWears:   this.minWears(),
      brand:      this.brandFilter(),
      condition:  this.activeCondition(),
      sortField:  this.sortField(),
      sortDir:    this.sortDir(),
    });
  }
}
