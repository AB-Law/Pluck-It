import { Component, input, output, signal, computed, OnInit } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { RangeSliderComponent } from '../../shared/range-slider.component';
import { ItemCondition } from '../../core/models/clothing-item.model';
import type { WardrobeSortField } from '../../core/models/clothing-item.model';

export type SmartGroup = 'all' | 'favorites' | 'recent' | 'collections' | 'wishlist';

export interface VaultFilters {
  group: SmartGroup;
  priceRange: [number, number];
  wearRange: [number, number];
  brand?: string;
  condition?: ItemCondition | '';
  sortField: WardrobeSortField;
  sortDir: 'asc' | 'desc';
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  INR: '₹',
  JPY: '¥',
  CAD: 'C$',
  AUD: 'A$',
};

interface SortOption {
  label: string;
  sortField: WardrobeSortField;
  sortDir: 'asc' | 'desc';
}

const SORT_OPTIONS: SortOption[] = [
  { label: 'Newest First', sortField: 'dateAdded', sortDir: 'desc' },
  { label: 'Oldest First', sortField: 'dateAdded', sortDir: 'asc' },
  { label: 'Most Worn', sortField: 'wearCount', sortDir: 'desc' },
  { label: 'Least Worn', sortField: 'wearCount', sortDir: 'asc' },
  { label: 'Price: High to Low', sortField: 'price.amount', sortDir: 'desc' },
  { label: 'Price: Low to High', sortField: 'price.amount', sortDir: 'asc' },
];

const CONDITIONS: Array<{ label: string; value: ItemCondition }> = [
  { label: 'New', value: 'New' },
  { label: 'Excellent', value: 'Excellent' },
  { label: 'Good', value: 'Good' },
  { label: 'Fair', value: 'Fair' },
];

@Component({
  selector: 'app-vault-sidebar',
  standalone: true,
  imports: [FormsModule, RouterLink, RangeSliderComponent],
  template: `
    <aside
      class="w-64 flex-shrink-0 flex-col border-r border-border-chrome bg-card-dark/85 p-6 overflow-y-auto backdrop-blur-sm"
      [class.fixed]="mobileMode()"
      [class.inset-0]="mobileMode()"
      [class.z-50]="mobileMode()"
      [class.right-0]="mobileMode()"
      [class.bg-card-dark]="mobileMode()"
      [class.w-full]="mobileMode()"
    >
      @if (mobileMode()) {
        <div class="mb-4 flex items-center justify-between">
          <h3 class="text-sm font-bold uppercase tracking-wider text-app-soft">Filters</h3>
          <button
            type="button"
            class="h-10 w-10 flex items-center justify-center rounded-lg bg-background-dark text-slate-text hover:text-chrome hover:bg-bg-soft touch-target"
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
        <h3 class="mb-4 text-xs font-bold uppercase tracking-widest text-app-soft">
          Smart Groups
        </h3>
        <nav class="space-y-1">
          @for (g of groups; track g.id) {
            <button
              class="touch-target w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
              [class]="
                g.id === activeGroup()
                  ? 'bg-primary/10 text-primary'
                  : 'text-slate-400 hover:bg-background-dark hover:text-chrome'
              "
              (click)="selectGroup(g.id)"
            >
              <span class="material-symbols-outlined text-lg">{{ g.icon }}</span>
              {{ g.label }}
            </button>
          }
          <a
            routerLink="/collections"
            class="touch-target w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-400 hover:bg-background-dark hover:text-chrome transition-colors"
          >
            <span class="material-symbols-outlined text-lg">folder_special</span>
            Collections
          </a>
        </nav>
      </div>

      <!-- Sort -->
      <div class="mb-8">
        <h3 class="mb-4 text-xs font-bold uppercase tracking-widest text-app-soft">Sort By</h3>
        <select
          class="w-full rounded-lg bg-background-dark border border-border-chrome text-sm text-slate-200 px-3 py-2 outline-none focus:border-primary/60 transition-colors font-mono"
          [ngModel]="sortKey()"
          (ngModelChange)="onSortChange($event)"
        >
          @for (opt of sortOptions; track opt.label) {
            <option [value]="opt.sortField + ':' + opt.sortDir">{{ opt.label }}</option>
          }
        </select>
      </div>

      <!-- Range Matrix -->
      <div class="mb-6">
        <h3 class="mb-3 text-[10px] font-bold uppercase tracking-[0.16em] text-app-soft">
          The Range Matrix
        </h3>
        <div class="space-y-4 px-0.5">
          <!-- Price Range -->
          <div>
            <div class="mb-2 flex justify-between text-[10px] font-medium font-mono">
              <span class="text-slate-400 uppercase tracking-wide">Price Range</span>
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

          <!-- Wear Range -->
          <div>
            <div class="mb-2 flex justify-between text-[10px] font-medium font-mono">
              <span class="text-slate-400 uppercase tracking-wide">Wear Range</span>
              <span class="text-primary">{{ wearRange()[0] }} - {{ wearRange()[1] }} wears</span>
            </div>
            <app-range-slider
              [min]="0"
              [max]="maxWears"
              [step]="1"
              [(value)]="wearRange"
              (valueChange)="onWearsChange($event)"
            />
          </div>
        </div>
      </div>

      <!-- Brand Filter -->
      <div class="mb-8">
        <h3 class="mb-4 text-xs font-bold uppercase tracking-widest text-app-soft">Brand</h3>
        <div
          class="flex items-center rounded-lg bg-background-dark border border-border-chrome focus-within:border-primary/60 transition-colors"
        >
          <span class="pl-3 text-slate-500 material-symbols-outlined" style="font-size:16px"
            >search</span
          >
          <input
            class="w-full bg-transparent text-sm text-chrome placeholder-slate-500 outline-none py-2 px-2 font-mono"
            placeholder="e.g. Nike, Zara..."
            [ngModel]="brandFilter()"
            (ngModelChange)="onBrandChange($event)"
          />
          @if (brandFilter()) {
            <button
              class="touch-target pr-3 text-slate-500 hover:text-chrome"
              (click)="onBrandChange('')"
            >
              <span class="material-symbols-outlined" style="font-size:14px">close</span>
            </button>
          }
        </div>
      </div>

      <!-- Condition Filter -->
      <div class="mb-8">
        <h3 class="mb-4 text-xs font-bold uppercase tracking-widest text-app-soft">Condition</h3>
        <div class="flex flex-wrap gap-2">
          @for (c of conditions; track c.value) {
            <button
              class="touch-target px-3 py-1 rounded-full text-xs font-medium border transition-colors"
              [class]="
                activeCondition() === c.value
                  ? 'bg-primary/15 border-primary/50 text-primary'
                  : 'bg-background-dark border-border-chrome text-slate-400 hover:border-primary/40 hover:text-chrome'
              "
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
          class="touch-target w-full text-xs font-bold uppercase tracking-widest py-2 rounded-lg border border-border-chrome text-slate-500 hover:text-chrome hover:border-primary/40 transition-colors"
          (click)="clearAll()"
        >
          Clear All Filters
        </button>
      }
    </aside>
  `,
})
export class VaultSidebarComponent implements OnInit {
  maxPrice = input<number>(5000);
  currency = input<string>('USD');
  /** Seed initial filter state (e.g. restored from URL on parent init). */
  initialFilters = input<Partial<VaultFilters>>({});
  mobileMode = input<boolean>(false);

  /** Emitted only when the sidebar is rendered in mobile mode and user closes it. */
  closed = output<void>();

  filtersChange = output<VaultFilters>();

  activeGroup = signal<SmartGroup>('all');
  priceRange = signal<[number, number]>([0, 5000]);
  wearRange = signal<[number, number]>([0, 200]);
  brandFilter = signal<string>('');
  activeCondition = signal<ItemCondition | ''>('');
  sortField = signal<WardrobeSortField>('dateAdded');
  sortDir = signal<'asc' | 'desc'>('desc');

  readonly maxWears = 200;

  readonly sortOptions = SORT_OPTIONS;
  readonly conditions = CONDITIONS;

  readonly groups = [
    { id: 'all' as SmartGroup, icon: 'grid_view', label: 'All Items' },
    { id: 'favorites' as SmartGroup, icon: 'star', label: 'Favorites' },
    { id: 'recent' as SmartGroup, icon: 'schedule', label: 'Worn Recently' },
    { id: 'wishlist' as SmartGroup, icon: 'favorite', label: 'Wishlist' },
  ];

  readonly sortKey = computed(() => `${this.sortField()}:${this.sortDir()}`);

  readonly priceLabel = computed(() => {
    const [lo, hi] = this.priceRange();
    const sym = CURRENCY_SYMBOLS[this.currency()] ?? this.currency();
    return `${sym}${lo.toLocaleString()} - ${sym}${hi.toLocaleString()}`;
  });

  readonly hasActiveFilters = computed(
    () =>
      !!this.brandFilter() ||
      !!this.activeCondition() ||
      this.priceRange()[0] > 0 ||
      this.priceRange()[1] < this.maxPrice() ||
      this.wearRange()[0] > 0 ||
      this.wearRange()[1] < this.maxWears ||
      this.sortField() !== 'dateAdded' ||
      this.sortDir() !== 'desc',
  );

  ngOnInit(): void {
    const init = this.initialFilters();
    if (init.group) this.activeGroup.set(init.group);
    if (init.priceRange) this.priceRange.set(init.priceRange);
    if (init.wearRange) this.wearRange.set(init.wearRange);
    if (init.brand) this.brandFilter.set(init.brand);
    if (init.condition) this.activeCondition.set(init.condition);
    if (init.sortField) this.sortField.set(init.sortField);
    if (init.sortDir) this.sortDir.set(init.sortDir);
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
    this.wearRange.set([0, this.maxWears]);
    this.brandFilter.set('');
    this.activeCondition.set('');
    this.sortField.set('dateAdded');
    this.sortDir.set('desc');
    this.emit();
  }

  onWearsChange(range: [number, number]): void {
    this.wearRange.set(range);
    this.emit();
  }

  private emit(): void {
    this.filtersChange.emit({
      group: this.activeGroup(),
      priceRange: this.priceRange(),
      wearRange: this.wearRange(),
      brand: this.brandFilter(),
      condition: this.activeCondition(),
      sortField: this.sortField(),
      sortDir: this.sortDir(),
    });
  }
}
