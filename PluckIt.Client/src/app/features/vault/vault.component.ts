import { Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { WardrobeService } from '../../core/services/wardrobe.service';
import { UserProfileService } from '../../core/services/user-profile.service';
import { ClothingItem } from '../../core/models/clothing-item.model';
import { VaultSidebarComponent, VaultFilters } from './vault-sidebar.component';
import { VaultCardComponent } from './vault-card.component';
import { ItemDetailDrawerComponent } from './item-detail-drawer.component';
import { StatCardComponent } from '../../shared/stat-card.component';
import { ReviewItemModalComponent } from '../closet/review-item-modal.component';
import { AddToCollectionModalComponent } from '../collections/add-to-collection-modal.component';

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
  protected searchQuery  = signal('');

  protected readonly activeFilters = signal<VaultFilters>({
    group: 'all',
    priceRange: [0, 999_999],
    minWears: 0,
  });

  constructor(
    private wardrobeService: WardrobeService,
    private profileService: UserProfileService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.profileService.load().subscribe();
    this.wardrobeService.getAll({ pageSize: 100 }).subscribe({
      next: items => { this.allItems.set(items); this.loading.set(false); },
      error: ()    => this.loading.set(false),
    });
  }

  // ── Computed stats ──────────────────────────────────────────────────────

  readonly currency = computed(() => this.profileService.getOrDefault().currencyCode);

  readonly maxItemPrice = computed(() =>
    Math.max(5000, ...this.allItems().map(i => i.price?.amount ?? 0)));

  readonly filteredItems = computed(() => {
    const q = this.searchQuery().toLowerCase();
    const { group, priceRange, minWears } = this.activeFilters();
    return this.allItems().filter(item => {
      if (q && !this.matchesSearch(item, q)) return false;
      const price = item.price?.amount ?? 0;
      if (price < priceRange[0] || price > priceRange[1]) return false;
      if (item.wearCount < minWears) return false;
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

  setCurrency(cur: string): void {
    // Profile currency update — delegate to profile service
    const profile = this.profileService.getOrDefault();
    this.profileService.update({ ...profile, currencyCode: cur }).subscribe();
  }

  private matchesSearch(item: ClothingItem, q: string): boolean {
    return [item.brand, item.category, item.notes, ...(item.tags ?? []), ...(item.aestheticTags ?? [])]
      .some(v => v?.toLowerCase().includes(q));
  }

  private fmt(val: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: this.currency() ?? 'USD',
      maximumFractionDigits: 2,
    }).format(val);
  }
}
