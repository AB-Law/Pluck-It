import { Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { WardrobeService } from '../../core/services/wardrobe.service';
import { UserProfileService } from '../../core/services/user-profile.service';
import { ClothingItem, ItemCondition, WardrobeQuery } from '../../core/models/clothing-item.model';
import type { WardrobeSortField } from '../../core/models/clothing-item.model';
import { VaultSidebarComponent, VaultFilters, SmartGroup } from './vault-sidebar.component';
import { VaultCardComponent } from './vault-card.component';
import { ItemDetailDrawerComponent } from './item-detail-drawer.component';
import { StatCardComponent } from '../../shared/stat-card.component';
import { ReviewItemModalComponent } from '../closet/review-item-modal.component';
import { AddToCollectionModalComponent } from '../collections/add-to-collection-modal.component';
import { matchesItem } from '../../core/utils/search.utils';

@Component({
  selector: 'app-vault',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    VaultSidebarComponent,
    VaultCardComponent,
    ItemDetailDrawerComponent,
    StatCardComponent,
    ReviewItemModalComponent,
    AddToCollectionModalComponent,
  ],
  template: `
    <div class="relative flex h-screen flex-col overflow-hidden bg-black text-slate-100 font-display">

      <!-- ─── Header (matches dashboard) ─────────────────────────── -->
      <header class="flex items-center justify-between border-b border-border-subtle bg-black px-6 py-4 shrink-0 z-50">
        <div class="flex items-center gap-8">
          <!-- Logo -->
          <a routerLink="/" class="flex items-center gap-3 text-white hover:opacity-80 transition-opacity">
            <span class="material-symbols-outlined text-primary" style="font-size:30px">checkroom</span>
            <h2 class="text-white text-xl font-bold tracking-tight">Pluck-It</h2>
          </a>

          <!-- Vault search -->
          <label class="hidden md:flex flex-col min-w-[280px]">
            <div class="flex w-full items-center rounded-lg bg-card-dark border border-[#333] focus-within:border-primary/60 transition-colors">
              <div class="flex items-center justify-center pl-3 text-slate-text">
                <span class="material-symbols-outlined" style="font-size:20px">search</span>
              </div>
              <input
                class="w-full bg-transparent border-none text-sm text-white placeholder-slate-text outline-none py-2.5 px-3 font-mono"
                placeholder="Try 'White summer shirts' or 'Casual linen'…"
                [ngModel]="searchQuery()" (ngModelChange)="searchQuery.set($event)"
              />
            </div>
          </label>
        </div>

        <div class="flex items-center gap-3">
          <!-- Back to wardrobe -->
          <a routerLink="/"
             class="p-2 rounded-lg bg-card-dark text-slate-text hover:text-white hover:bg-[#333] transition-colors"
             title="Back to Wardrobe">
            <span class="material-symbols-outlined" style="font-size:20px">home</span>
          </a>

          <!-- Vault active indicator -->
          <span
            class="p-2 rounded-lg bg-primary/10 text-primary border border-primary/30"
            title="Digital Vault">
            <span class="material-symbols-outlined" style="font-size:20px">inventory_2</span>
          </span>

          <!-- Collections icon -->
          <a routerLink="/collections"
             class="p-2 rounded-lg bg-card-dark text-slate-text hover:text-white hover:bg-[#333] transition-colors"
             title="My Collections">
            <span class="material-symbols-outlined" style="font-size:20px">folder_special</span>
          </a>

          <button class="p-2 rounded-lg bg-card-dark text-slate-text hover:text-white hover:bg-[#333] transition-colors">
            <span class="material-symbols-outlined" style="font-size:20px">notifications</span>
          </button>
        </div>
      </header>

      <!-- ─── Body (3-col layout) ──────────────────────────────────── -->
      <div class="flex flex-1 overflow-hidden">

        <!-- Left Sidebar (smart groups + range matrix) -->
        <app-vault-sidebar
          [maxPrice]="maxItemPrice()"
          [currency]="currency()"
          [initialFilters]="activeFilters()"
          (filtersChange)="onFiltersChange($event)"
        />

        <!-- Main content -->
        <main class="flex-1 overflow-y-auto bg-black p-6">

          <!-- Stats row -->
          <div class="mb-8 flex flex-wrap gap-4">
            <app-stat-card
              label="Total Archive Items"
              [value]="totalItems().toLocaleString()"
              [trend]="null"
            />
            <app-stat-card
              label="Estimated Portfolio Value"
              [value]="portfolioValueDisplay()"
              subtext="Based on purchase prices"
            />
            <app-stat-card
              label="Average CPW"
              [value]="avgCpwDisplay()"
              subtext="Optimizing utility"
              valueClass="text-primary font-mono"
            />
          </div>

          <!-- Loading state -->
          @if (loading()) {
            <div class="flex items-center justify-center py-20 text-slate-500">
              <span class="material-symbols-outlined animate-spin mr-2" style="font-size:28px">progress_activity</span>
              Loading vault…
            </div>
          }

          <!-- Empty state -->
          @if (!loading() && filteredItems().length === 0) {
            <div class="flex flex-col items-center justify-center py-20 text-slate-600">
              <span class="material-symbols-outlined mb-4" style="font-size:48px">inventory_2</span>
              <p class="text-sm">No items match your filters.</p>
            </div>
          }

          <!-- Grid -->
          <div class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            @for (item of filteredItems(); track item.id) {
              <app-vault-card
                [item]="item"
                [currency]="currency()"
                [isSelected]="selectedItem()?.id === item.id"
                (selectToggled)="onCardSelect(item)"
              />
            }
          </div>

          <!-- Load More -->
          @if (hasMore()) {
            <div class="mt-8 flex justify-center">
              <button
                class="px-6 py-2.5 rounded-lg border border-[#333] text-sm font-medium text-slate-300 hover:text-white hover:border-slate-500 transition-colors font-mono disabled:opacity-50"
                [disabled]="loadingMore()"
                (click)="loadMore()"
              >
                @if (loadingMore()) {
                  <span class="flex items-center gap-2">
                    <span class="material-symbols-outlined animate-spin" style="font-size:16px">progress_activity</span>
                    Loading...
                  </span>
                } @else {
                  Load More
                }
              </button>
            </div>
          }

        </main>

        <!-- Right drawer -->
        <app-item-detail-drawer
          [item]="selectedItem()"
          (closed)="selectedItem.set(null)"
          (editRequested)="openEditModal($event)"
          (shareToCollection)="openShareModal($event)"
          (wearLogged)="onWearLogged($event)"
        />

      </div>

      <!-- Edit metadata modal -->
      @if (editingItem()) {
        <app-review-item-modal
          [item]="editingItem()"
          [knownBrands]="knownBrands()"
          [isEditMode]="true"
          (updated)="onItemUpdated($event)"
          (cancelled)="editingItem.set(null)"
        />
      }

      <!-- Add to collection modal -->
      @if (sharingItem()) {
        <app-add-to-collection-modal
          [item]="sharingItem()!"
          (closed)="sharingItem.set(null)"
        />
      }

    </div>
  `,
})
export class VaultComponent implements OnInit {

  protected allItems     = signal<ClothingItem[]>([]);
  protected selectedItem = signal<ClothingItem | null>(null);
  protected editingItem  = signal<ClothingItem | null>(null);
  protected sharingItem  = signal<ClothingItem | null>(null);
  protected loading      = signal(true);
  protected loadingMore  = signal(false);
  protected hasMore      = signal(false);
  protected nextToken    = signal<string | null>(null);
  protected searchQuery  = signal('');

  protected readonly activeFilters = signal<VaultFilters>({
    group:      'all',
    priceRange: [0, 999_999],
    minWears:   0,
    brand:      '',
    condition:  '',
    sortField:  'dateAdded',
    sortDir:    'desc',
  });

  constructor(
    private wardrobeService: WardrobeService,
    private profileService: UserProfileService,
    private router: Router,
    private route: ActivatedRoute,
  ) {}

  ngOnInit(): void {
    this.profileService.load().subscribe();

    // Restore filters from URL query params
    const params    = this.route.snapshot.queryParamMap;
    const priceMin  = Number(params.get('priceMin') ?? 0);
    const priceMax  = Number(params.get('priceMax') ?? 999_999);
    const restored: VaultFilters = {
      group:      (params.get('group')     as SmartGroup)        ?? 'all',
      priceRange: [priceMin, priceMax],
      minWears:   Number(params.get('minWears') ?? 0),
      brand:      params.get('brand')    ?? '',
      condition:  (params.get('condition') as ItemCondition | '') ?? '',
      sortField:  (params.get('sortField') as WardrobeSortField)  ?? 'dateAdded',
      sortDir:    (params.get('sortDir')   as 'asc' | 'desc')     ?? 'desc',
    };
    this.activeFilters.set(restored);
    this.loadItems(restored);
  }

  // ── Computed stats ──────────────────────────────────────────────────────

  readonly currency = computed(() => this.profileService.getOrDefault().currencyCode);

  readonly maxItemPrice = computed(() =>
    Math.max(5000, ...this.allItems().map(i => i.price?.amount ?? 0)));

  /**
   * Client-side filter: applies only Smart Group and free-text search.
   * Price range, min wears, brand, condition, and sort are handled server-side.
   */
  readonly filteredItems = computed(() => {
    const q = this.searchQuery().toLowerCase();
    const { group } = this.activeFilters();
    return this.allItems().filter(item => {
      if (q && !this.matchesSearch(item, q)) return false;
      if (group === 'favorites')
        return item.tags.includes('favorite') || item.aestheticTags?.includes('Favorite');
      if (group === 'recent') return (item.wearCount ?? 0) > 0;
      return true;
    });
  });

  readonly totalItems = computed(() => this.filteredItems().length);

  readonly portfolioValueDisplay = computed(() => {
    const total = this.filteredItems().reduce(
      (sum, i) => sum + (i.estimatedMarketValue ?? i.price?.amount ?? 0), 0);
    return this.fmt(total);
  });

  readonly avgCpwDisplay = computed(() => {
    const items = this.filteredItems().filter(i => i.price?.amount && (i.wearCount ?? 0) > 0);
    if (!items.length) return 'N/A';
    const avg = items.reduce((s, i) => s + (i.price!.amount / (i.wearCount ?? 1)), 0) / items.length;
    return this.fmt(avg);
  });

  readonly knownBrands = computed(() =>
    [...new Set(this.allItems().map(i => i.brand).filter(Boolean) as string[])]);

  // ── Actions ───────────────────────────────────────────────────────────────

  onFiltersChange(f: VaultFilters): void {
    this.activeFilters.set(f);
    this.syncUrl(f);
    this.loadItems(f);
  }

  loadMore(): void {
    const token = this.nextToken();
    if (!token || this.loadingMore()) return;
    this.loadingMore.set(true);
    this.wardrobeService.getAll(this.buildQuery(this.activeFilters(), token)).subscribe({
      next: res => {
        this.allItems.update(curr => [...curr, ...res.items]);
        this.nextToken.set(res.nextContinuationToken ?? null);
        this.hasMore.set(!!res.nextContinuationToken);
        this.loadingMore.set(false);
      },
      error: () => this.loadingMore.set(false),
    });
  }

  onCardSelect(item: ClothingItem): void {
    this.selectedItem.set(this.selectedItem()?.id === item.id ? null : item);
  }

  openEditModal(item: ClothingItem): void { this.editingItem.set(item); }
  openShareModal(item: ClothingItem): void { this.sharingItem.set(item); }

  onItemUpdated(updated: ClothingItem): void {
    this.wardrobeService.update(updated).subscribe(() => {
      this.allItems.update(list => list.map(i => i.id === updated.id ? updated : i));
      this.selectedItem.set(updated);
      this.editingItem.set(null);
    });
  }

  onWearLogged(updated: ClothingItem): void {
    this.allItems.update(list => list.map(i => i.id === updated.id ? updated : i));
    this.selectedItem.set(updated);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private loadItems(filters: VaultFilters): void {
    this.loading.set(true);
    this.nextToken.set(null);
    this.hasMore.set(false);
    this.wardrobeService.getAll(this.buildQuery(filters)).subscribe({
      next: res => {
        this.allItems.set(res.items);
        this.nextToken.set(res.nextContinuationToken ?? null);
        this.hasMore.set(!!res.nextContinuationToken);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  private buildQuery(filters: VaultFilters, continuationToken?: string | null): WardrobeQuery {
    const [priceMin, priceMax] = filters.priceRange;
    return {
      brand:             filters.brand        || undefined,
      condition:         filters.condition ? (filters.condition as ItemCondition) : undefined,
      priceMin:          priceMin  > 0        ? priceMin  : undefined,
      priceMax:          priceMax  < 999_999  ? priceMax  : undefined,
      minWears:          filters.minWears > 0 ? filters.minWears : undefined,
      sortField:         filters.sortField,
      sortDir:           filters.sortDir,
      pageSize:          24,
      continuationToken: continuationToken ?? undefined,
    };
  }

  private syncUrl(f: VaultFilters): void {
    const [priceMin, priceMax] = f.priceRange;
    this.router.navigate([], {
      queryParams: {
        group:      f.group     !== 'all'       ? f.group      : null,
        priceMin:   priceMin    > 0             ? priceMin     : null,
        priceMax:   priceMax    < 999_999       ? priceMax     : null,
        minWears:   f.minWears  > 0             ? f.minWears   : null,
        brand:      f.brand                     ? f.brand      : null,
        condition:  f.condition                 ? f.condition  : null,
        sortField:  f.sortField !== 'dateAdded' ? f.sortField  : null,
        sortDir:    f.sortDir   !== 'desc'      ? f.sortDir    : null,
      },
      replaceUrl: true,
    });
  }

  private matchesSearch(item: ClothingItem, q: string): boolean {
    return matchesItem(item, q);
  }

  private fmt(val: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: this.currency() ?? 'USD',
      maximumFractionDigits: 2,
    }).format(val);
  }
}
