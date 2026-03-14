import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild, computed, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { WardrobeService } from '../../core/services/wardrobe.service';
import { UserProfileService } from '../../core/services/user-profile.service';
import {
  ClothingItem,
  ItemCondition,
  WardrobeQuery,
  WearSuggestionItem,
} from '../../core/models/clothing-item.model';
import type { WardrobeSortField } from '../../core/models/clothing-item.model';
import { VaultSidebarComponent, VaultFilters, SmartGroup } from './vault-sidebar.component';
import { VaultCardComponent } from './vault-card.component';
import { ItemDetailDrawerComponent } from './item-detail-drawer.component';
import { StatCardComponent } from '../../shared/stat-card.component';
import { AppHeaderComponent } from '../../shared/app-header.component';
import { ProfilePanelComponent } from '../profile/profile-panel.component';
import { ReviewItemModalComponent } from '../closet/review-item-modal.component';
import { AddToCollectionModalComponent } from '../collections/add-to-collection-modal.component';
import { matchesItem } from '../../core/utils/search.utils';
import { VaultInsightsService } from '../../core/services/vault-insights.service';
import { VaultInsightsPanelComponent } from './vault-insights-panel.component';
import { CpwIntelItem, CpwIntelPanelItem, VaultInsightsPanelData, VaultInsightsResponse } from '../../core/models/vault-insights.model';
import { MobileNavState } from '../../shared/layout/mobile-nav.state';

@Component({
  selector: 'app-vault',
  standalone: true,
  imports: [
    CommonModule,
    VaultSidebarComponent,
    VaultCardComponent,
    ItemDetailDrawerComponent,
    VaultInsightsPanelComponent,
    StatCardComponent,
    AppHeaderComponent,
    ProfilePanelComponent,
    ReviewItemModalComponent,
    AddToCollectionModalComponent,
  ],
  template: `
    <div class="relative flex h-[100dvh] flex-col overflow-hidden bg-black text-slate-100 pb-16 md:pb-0 font-display">

      <app-shared-header
        section="vault"
        [showSearch]="true"
        [searchValue]="searchQuery()"
        searchPlaceholder="Try 'White summer shirts' or 'Casual linen'…"
        (searchValueChange)="searchQuery.set($event)"
        [showBackShortcut]="true"
        backShortcutLabel="Back to Wardrobe"
        [showFilterShortcut]="true"
        (filtersRequested)="openMobileFilters()"
        (notificationsRequested)="noop()"
        (settingsRequested)="openSettings()"
      />

      <!-- ─── Body (3-col layout) ──────────────────────────────────── -->
      <div class="flex flex-1 min-h-0 overflow-hidden">
        <!-- Left Sidebar (smart groups + range matrix) -->
        <app-vault-sidebar
          class="hidden md:flex"
          [maxPrice]="maxItemPrice()"
          [currency]="currency()"
          [initialFilters]="activeFilters()"
          (filtersChange)="onFiltersChange($event)"
        />

        @if (showMobileFilters()) {
          <div class="mobile-overlay-shell md:hidden" (click)="closeFilters()"></div>
          <app-vault-sidebar
            class="fixed inset-0 z-50"
            [mobileMode]="true"
            [maxPrice]="maxItemPrice()"
            [currency]="currency()"
            [initialFilters]="activeFilters()"
            (filtersChange)="onMobileFiltersChange($event)"
            (closed)="closeFilters()"
          />
        }

        <!-- Main content -->
        <main
          #mainScrollArea
          class="min-h-0 flex-1 overflow-y-auto touch-pan-y bg-black p-4 md:p-6 outline-none"
          tabindex="-1"
          aria-label="Vault content"
        >

          <!-- Stats row -->
          <div class="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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

          @if (wearSuggestions().length > 0) {
            <div class="mb-6 space-y-2">
              @for (s of wearSuggestions(); track s.suggestionId) {
                <div class="rounded-lg border border-primary/30 bg-primary/10 p-3">
                  <div class="flex items-start gap-4">
                    @if (s.imageUrl; as itemImage) {
                      <img
                        [src]="itemImage"
                        alt="Suggested item"
                        class="mt-0.5 h-28 w-24 rounded bg-black/30 object-contain border border-primary/25 shrink-0"
                      />
                    } @else {
                      <div class="mt-0.5 h-28 w-24 rounded bg-black/40 border border-primary/25 flex items-center justify-center text-sm text-slate-500 shrink-0">
                        <span class="material-symbols-outlined text-2xl">image</span>
                      </div>
                    }
                    <div class="min-w-0 flex-1 space-y-3">
                      <p class="text-sm text-primary font-semibold leading-relaxed flex-1">{{ s.message }}</p>
                      <div class="flex flex-wrap items-center gap-2">
                        <button
                          class="rounded border border-primary/40 px-3 py-1.5 text-sm font-bold text-primary hover:bg-primary/20"
                          (click)="acceptSuggestion(s)"
                        >Mark Worn</button>
                        <button
                          class="rounded border border-border-chrome px-3 py-1.5 text-sm font-bold text-slate-300 hover:text-white"
                          (click)="dismissSuggestion(s)"
                        >Dismiss</button>
                      </div>
                    </div>
                  </div>
                </div>
              }
            </div>
          }

          <app-vault-insights-panel [insights]="enrichedInsights()" />

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
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            @for (item of filteredItems(); track item.id; let i = $index) {
              <app-vault-card
                [item]="item"
                [priority]="i < 8"
                [currency]="currency()"
                [isSelected]="selectedItem()?.id === item.id"
                [cpwBadge]="cpwBadgeFor(item.id)"
                [breakEvenReached]="breakEvenFor(item.id)"
                (selectToggled)="onCardSelect(item)"
                (wearIncrementRequested)="onCardWear($event)"
              />
            }
          </div>

          <!-- Load More -->
          @if (hasMore()) {
          <div class="mt-8 flex justify-center">
              <button
              class="touch-target px-6 py-2.5 rounded-lg border border-[#333] text-sm font-medium text-slate-300 hover:text-white hover:border-slate-500 transition-colors font-mono disabled:opacity-50"
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
        @if (selectedItem() && mobileMode()) {
          <div class="mobile-overlay-shell md:hidden" (click)="selectedItem.set(null)"></div>
        }
        <app-item-detail-drawer
          [mobileMode]="mobileMode()"
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

      @if (settingsOpen()) {
        <app-profile-panel (closed)="closeSettingsPanel()" />
      }

    </div>
  `,
})
export class VaultComponent implements OnInit, OnDestroy {
  @ViewChild('mainScrollArea')
  private readonly mainScrollArea?: ElementRef<HTMLElement>;

  protected allItems = signal<ClothingItem[]>([]);
  protected readonly settingsOpen = signal(false);
  protected selectedItem = signal<ClothingItem | null>(null);
  protected editingItem = signal<ClothingItem | null>(null);
  protected sharingItem = signal<ClothingItem | null>(null);
  protected readonly mobileFiltersOpen = signal(false);
  protected readonly mobileMode = signal(false);
  protected loading = signal(true);
  protected loadingMore = signal(false);
  protected hasMore = signal(false);
  protected nextToken = signal<string | null>(null);
  protected searchQuery = signal('');
  protected wearSuggestions = signal<WearSuggestionItem[]>([]);
  protected insights = signal<VaultInsightsResponse | null>(null);
  protected loadingInsights = signal(false);

  protected readonly activeFilters = signal<VaultFilters>({
    group: 'all',
    priceRange: [0, 999_999],
    minWears: 0,
    brand: '',
    condition: '',
    sortField: 'dateAdded',
    sortDir: 'desc',
  });

  constructor(
    private readonly wardrobeService: WardrobeService,
    private readonly vaultInsightsService: VaultInsightsService,
    private readonly profileService: UserProfileService,
    private readonly router: Router,
    private readonly route: ActivatedRoute,
    protected readonly mobileNavState: MobileNavState,
  ) {
    effect(() => {
      if (this.mobileNavState.activePanel() === 'none') {
        this.restoreMainFocusTarget();
      }
    });
  }

  ngOnDestroy(): void {
    this.mobileNavState.closePanel();
  }

  ngOnInit(): void {
    this.profileService.load().subscribe();

    // Restore filters from URL query params
    const params = this.route.snapshot.queryParamMap;
    const priceMin = Number(params.get('priceMin') ?? 0);
    const priceMax = Number(params.get('priceMax') ?? 999_999);
    const restored: VaultFilters = {
      group: (params.get('group') as SmartGroup) ?? 'all',
      priceRange: [priceMin, priceMax],
      minWears: Number(params.get('minWears') ?? 0),
      brand: params.get('brand') ?? '',
      condition: (params.get('condition') as ItemCondition | '') ?? '',
      sortField: (params.get('sortField') as WardrobeSortField) ?? 'dateAdded',
      sortDir: (params.get('sortDir') as 'asc' | 'desc') ?? 'desc',
    };
    this.activeFilters.set(restored);
    this.loadItems(restored);
    this.loadWearSuggestions();
    this.loadInsights();
    this.updateViewportMode();
  }

  @HostListener('window:resize')
  protected onWindowResize(): void {
    this.updateViewportMode();
  }

  private updateViewportMode(): void {
    if (globalThis.window === undefined) {
      return;
    }
    this.mobileMode.set(globalThis.window.innerWidth < 768);
  }

  protected noop(): void {}

  protected readonly showMobileFilters = this.mobileFiltersOpen.asReadonly();

  protected openMobileFilters(): void {
    this.mobileFiltersOpen.set(true);
  }

  protected closeFilters(): void {
    this.mobileFiltersOpen.set(false);
  }

  protected openSettings(): void {
    this.mobileNavState.closePanel();
    if (this.mobileMode()) {
      this.mobileNavState.openProfile();
      return;
    }

    this.settingsOpen.set(true);
  }

  protected closeSettingsPanel(): void {
    this.settingsOpen.set(false);
    this.mobileNavState.closePanel();
    this.restoreMainFocusTarget();
  }

  private restoreMainFocusTarget(): void {
    queueMicrotask(() => {
      this.mainScrollArea?.nativeElement?.focus({ preventScroll: true });
    });
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
      if (group === 'wishlist') return !!item.isWishlisted;
      // Default: exclude wishlist items from the main vault views
      return !item.isWishlisted;
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

  readonly cpwIntelMap = computed(() =>
    new Map((this.insights()?.cpwIntel ?? []).map(row => [row.itemId, row])));

  readonly enrichedInsights = computed<VaultInsightsPanelData | null>(() => {
    const source = this.insights();
    if (!source) return null;
    const itemsById = new Map(this.allItems().map(item => [item.id, item]));
    const cpwIntel: CpwIntelPanelItem[] = (source.cpwIntel ?? []).map(row => {
      const item = itemsById.get(row.itemId);
      return {
        ...row,
        itemLabel: this.resolveItemLabel(item, row.itemId),
        imageUrl: item?.imageUrl ?? null,
      };
    });
    return { ...source, cpwIntel };
  });

  private clientEventCounter = 0;

  // ── Actions ───────────────────────────────────────────────────────────────

  onFiltersChange(f: VaultFilters): void {
    this.activeFilters.set(f);
    this.syncUrl(f);
    this.loadItems(f);
  }

  protected onMobileFiltersChange(f: VaultFilters): void {
    this.onFiltersChange(f);
    this.closeFilters();
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

  onCardWear(item: ClothingItem): void {
    const optimistic = { ...item, wearCount: (item.wearCount ?? 0) + 1 };
    this.allItems.update(list => list.map(i => i.id === item.id ? optimistic : i));
    if (this.selectedItem()?.id === item.id) this.selectedItem.set(optimistic);

    const rand = this.nextClientEventId('wear');
    this.wardrobeService.logWear(item.id, {
      source: 'vault_card',
      clientEventId: `wear-${rand}`,
    }).subscribe({
      next: updated => this.onWearLogged(updated),
      error: () => this.allItems.update(list => list.map(i => i.id === item.id ? item : i)),
    });
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
    const merged = this.mergeItemImageFromCache(updated);
    this.allItems.update(list => list.map(i => i.id === merged.id ? merged : i));
    this.selectedItem.set(merged);
    this.loadInsights();
    this.loadWearSuggestions();
  }

  private mergeItemImageFromCache(updated: ClothingItem): ClothingItem {
    const cached = this.allItems().find(i => i.id === updated.id);
    if (!cached) return updated;
    return {
      ...updated,
      imageUrl: updated.imageUrl || cached.imageUrl,
    };
  }

  acceptSuggestion(s: WearSuggestionItem): void {
    const rand = this.nextClientEventId('wear');
    this.wardrobeService.logWear(s.itemId, {
      source: 'suggestion_prompt',
      clientEventId: `wear-${rand}`,
      stylingActivityId: s.suggestionId,
    }).subscribe({
      next: updated => {
        this.onWearLogged(updated);
        this.wearSuggestions.update(list => list.filter(x => x.suggestionId !== s.suggestionId));
      },
      error: () => { },
    });
  }

  dismissSuggestion(s: WearSuggestionItem): void {
    this.wardrobeService.updateWearSuggestionStatus(s.suggestionId, { status: 'Dismissed' }).subscribe({
      next: () => this.wearSuggestions.update(list => list.filter(x => x.suggestionId !== s.suggestionId)),
      error: () => { },
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private nextClientEventId(prefix: string): string {
    this.clientEventCounter += 1;
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `${prefix}-${crypto.randomUUID()}-${this.clientEventCounter}`;
    }
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const random = Array.from(crypto.getRandomValues(new Uint32Array(1)))[0].toString(16);
      return `${prefix}-${Date.now()}-${this.clientEventCounter}-${random}`;
    }
    return `${prefix}-${Date.now()}-${this.clientEventCounter}`;
  }

  private resolveItemLabel(item: ClothingItem | undefined, itemId: string): string {
    const brand = item?.brand?.trim();
    const category = item?.category?.trim();
    const labelParts = [brand, category].filter(Boolean);
    if (labelParts.length > 0) return labelParts.join(' · ');
    return itemId;
  }

  cpwBadgeFor(itemId: string): CpwIntelItem['badge'] {
    return this.cpwIntelMap().get(itemId)?.badge ?? 'unknown';
  }

  breakEvenFor(itemId: string): boolean {
    return this.cpwIntelMap().get(itemId)?.breakEvenReached ?? false;
  }

  private loadWearSuggestions(): void {
    this.wardrobeService.getWearSuggestions().subscribe({
      next: res => this.wearSuggestions.set(res.suggestions ?? []),
      error: () => this.wearSuggestions.set([]),
    });
  }

  private loadInsights(): void {
    this.loadingInsights.set(true);
    this.vaultInsightsService.getInsights(90, 100).subscribe({
      next: res => {
        this.insights.set(res);
        this.loadingInsights.set(false);
      },
      error: () => {
        this.insights.set(null);
        this.loadingInsights.set(false);
      },
    });
  }

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
      brand: filters.brand || undefined,
      condition: filters.condition ? filters.condition : undefined,
      priceMin: priceMin > 0 ? priceMin : undefined,
      priceMax: priceMax < 999_999 ? priceMax : undefined,
      minWears: filters.minWears > 0 ? filters.minWears : undefined,
      sortField: filters.sortField,
      sortDir: filters.sortDir,
      pageSize: 24,
      continuationToken: continuationToken ?? undefined,
    };
  }

  private syncUrl(f: VaultFilters): void {
    const [priceMin, priceMax] = f.priceRange;
    this.router.navigate([], {
      queryParams: {
        group: f.group === 'all' ? null : f.group,
        priceMin: priceMin > 0 ? priceMin : null,
        priceMax: priceMax < 999_999 ? priceMax : null,
        minWears: f.minWears > 0 ? f.minWears : null,
        brand: f.brand ? f.brand : null,
        condition: f.condition ? f.condition : null,
        sortField: f.sortField === 'dateAdded' ? null : f.sortField,
        sortDir: f.sortDir === 'desc' ? null : f.sortDir,
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
