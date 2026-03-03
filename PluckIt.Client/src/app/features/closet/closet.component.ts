import { Component, computed, EventEmitter, input, OnInit, Output, signal, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { WardrobeService } from '../../core/services/wardrobe.service';
import { ClothingItem } from '../../core/models/clothing-item.model';
import type { WardrobeSortField } from '../../core/models/clothing-item.model';
import { UploadItemComponent } from './upload-item.component';
import { ClothingCardComponent } from './clothing-card.component';
import { ReviewItemModalComponent } from './review-item-modal.component';
import { matchesItem } from '../../core/utils/search.utils';

@Component({
  selector: 'app-wardrobe',
  standalone: true,
  imports: [UploadItemComponent, ClothingCardComponent, ReviewItemModalComponent],
  template: `
    <!-- ─── Extraction Hub ──────────────────────────────────────────── -->
    <section class="p-6 md:p-8 border-b border-border-subtle bg-gradient-to-b from-[#0a0a0a] to-background-dark">
      <div class="flex items-center justify-between mb-4">
        <h1 class="text-2xl font-bold text-white tracking-tight">The Extraction Hub</h1>
        <span class="text-[10px] font-mono text-primary bg-primary/10 px-2 py-1 rounded border border-primary/20 tracking-wider">
          SYSTEM ACTIVE
        </span>
      </div>

      <app-upload-item
        #uploadRef
        [uploading]="uploading()"
        (fileSelected)="onFileSelected($event)"
      />

      @if (uploadError()) {
        <div class="mt-3 flex items-center gap-3 px-4 py-3 bg-red-950/40 border border-red-800/50 rounded-lg text-sm text-red-300">
          <span class="material-symbols-outlined text-red-400" style="font-size:18px">error</span>
          <span class="flex-1">{{ uploadError() }}</span>
          <button class="text-red-400 hover:text-red-200 transition-colors" (click)="uploadError.set(null)" aria-label="Dismiss">
            <span class="material-symbols-outlined" style="font-size:18px">close</span>
          </button>
        </div>
      }
    </section>

    <!-- ─── Digital Archive ────────────────────────────────────────── -->
    <section class="p-6 md:p-8 flex-1">

      <!-- Header + filters -->
      <div class="flex flex-col gap-4 mb-6">
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h2 class="text-xl font-bold text-white">Digital Archive</h2>
            <p class="text-sm text-slate-text font-mono mt-1">{{ allItems().length }} ITEMS INDEXED</p>
          </div>

          <!-- Sort dropdown -->
          <select
            class="rounded-lg bg-card-dark border border-[#333] text-sm text-slate-200 px-3 py-1.5 outline-none focus:border-primary/60 transition-colors font-mono"
            [value]="sortKey()"
            (change)="onSortChange($any($event.target).value)"
          >
            <option value="dateAdded:desc">Newest First</option>
            <option value="dateAdded:asc">Oldest First</option>
            <option value="wearCount:desc">Most Worn</option>
            <option value="wearCount:asc">Least Worn</option>
            <option value="price.amount:desc">Price: High to Low</option>
            <option value="price.amount:asc">Price: Low to High</option>
          </select>
        </div>

        <!-- Category pills -->
        <div class="flex flex-wrap gap-2">
          <button
            class="px-4 py-1.5 rounded-full text-sm font-medium transition-colors"
            [class]="selectedCategory() === 'all'
              ? 'bg-white text-black'
              : 'bg-card-dark border border-[#333] text-slate-text hover:text-white hover:border-slate-500'"
            (click)="selectCategory('all')"
          >All Items</button>

          @for (cat of allCategories(); track cat) {
            <button
              class="px-4 py-1.5 rounded-full text-sm font-medium transition-colors capitalize"
              [class]="selectedCategory() === cat
                ? 'bg-white text-black'
                : 'bg-card-dark border border-[#333] text-slate-text hover:text-white hover:border-slate-500'"
              (click)="selectCategory(cat)"
            >{{ cat }}</button>
          }
        </div>
      </div>

      <!-- Loading skeleton -->
      @if (loading()) {
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 pb-10">
          @for (n of [1,2,3,4,5,6,7,8]; track n) {
            <div class="bg-card-dark rounded-xl overflow-hidden animate-pulse">
              <div class="aspect-[4/5] bg-[#222]"></div>
              <div class="p-4 space-y-2">
                <div class="h-3 bg-[#2a2a2a] rounded w-3/4"></div>
                <div class="h-3 bg-[#2a2a2a] rounded w-1/2"></div>
              </div>
            </div>
          }
        </div>
      }

      <!-- Empty state -->
      @if (!loading() && filteredItems().length === 0) {
        <div class="flex flex-col items-center justify-center py-20 text-center gap-4">
          <span class="material-symbols-outlined text-[#333]" style="font-size:64px">checkroom</span>
          <p class="text-chrome font-medium">
            @if (allItems().length === 0) { Your wardrobe is empty. Upload your first item above. }
            @else { No items match the selected filter. }
          </p>
        </div>
      }

      <!-- Items grid -->
      @if (!loading() && filteredItems().length > 0) {
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 pb-10">
          @for (item of filteredItems(); track item.id) {
            <app-clothing-card
              [item]="item"
              [selected]="selectedIds().includes(item.id)"
              (selectToggled)="itemToggled.emit($event)"
              (editRequested)="onEditItem($event)"
              (deleteRequested)="onDeleteItem($event)"
            />
          }
        </div>

        <!-- Load More -->
        @if (hasMore()) {
          <div class="pb-10 flex justify-center">
            <button
              class="px-6 py-2.5 rounded-lg border border-[#333] text-sm font-medium text-slate-300 hover:text-white hover:border-slate-500 transition-colors font-mono disabled:opacity-50"
              [disabled]="loadingMore()"
              (click)="loadMore()"
            >
              @if (loadingMore()) { Loading... } @else { Load More }
            </button>
          </div>
        }
      }
    </section>

    <!-- Upload draft modal (create mode) -->
    @if (draftItem()) {
      <app-review-item-modal
        [item]="draftItem()"
        [knownBrands]="knownBrands()"
        [isEditMode]="false"
        (saved)="onItemSaved($event)"
        (cancelled)="draftItem.set(null)"
      />
    }

    <!-- Edit existing item modal -->
    @if (editingItem()) {
      <app-review-item-modal
        [item]="editingItem()"
        [knownBrands]="knownBrands()"
        [isEditMode]="true"
        (updated)="onItemUpdated($event)"
        (cancelled)="editingItem.set(null)"
      />
    }

    <!-- Delete confirmation -->
    @if (deletingItem()) {
      <div
        class="fixed inset-0 z-50 flex items-center justify-center p-4"
        style="background: rgba(0,0,0,0.75); backdrop-filter: blur(6px);"
      >
        <div class="bg-black border border-[#1F1F1F] p-8 max-w-sm w-full shadow-2xl">
          <h2 class="text-white font-bold text-lg uppercase tracking-tight mb-2">Delete Item?</h2>
          <p class="text-slate-400 text-sm mb-6">
            This will permanently remove
            <span class="text-white">{{ deletingItem()!.category ?? 'this item' }}</span>
            from your wardrobe. This cannot be undone.
          </p>
          <div class="flex gap-4 justify-end">
            <button
              class="px-6 h-10 text-xs font-bold uppercase tracking-widest text-slate-400 hover:text-white transition-colors"
              (click)="deletingItem.set(null)"
            >Cancel</button>
            <button
              class="bg-red-600 hover:bg-red-500 transition-colors px-6 h-10 text-xs font-bold uppercase tracking-widest text-white"
              (click)="confirmDelete()"
            >Delete</button>
          </div>
        </div>
      </div>
    }
  `,
})
export class WardrobeComponent implements OnInit {
  /** Forwarded from the dashboard search bar */
  readonly searchQuery  = input('');
  /** IDs currently selected for styling context */
  readonly selectedIds  = input<string[]>([]);

  @Output() itemToggled = new EventEmitter<string>();

  @ViewChild('uploadRef') private uploadRef!: UploadItemComponent;

  readonly allItems     = signal<ClothingItem[]>([]);
  readonly draftItem    = signal<ClothingItem | null>(null);
  readonly editingItem  = signal<ClothingItem | null>(null);
  readonly deletingItem = signal<ClothingItem | null>(null);
  readonly loading      = signal(false);
  readonly loadingMore  = signal(false);
  readonly hasMore      = signal(false);
  readonly nextToken    = signal<string | null>(null);
  readonly uploading    = signal(false);
  readonly uploadError  = signal<string | null>(null);
  readonly selectedCategory = signal<string>('all');
  readonly sortField    = signal<WardrobeSortField>('dateAdded');
  readonly sortDir      = signal<'asc' | 'desc'>('desc');

  readonly sortKey = computed(() => `${this.sortField()}:${this.sortDir()}`);

  readonly allCategories = computed<string[]>(() =>
    [...new Set(
      this.allItems()
        .map(i => i.category)
        .filter((c): c is string => !!c)
    )]
  );

  readonly knownBrands = computed<string[]>(() =>
    [...new Set(
      this.allItems()
        .map(i => i.brand)
        .filter((b): b is string => !!b)
    )]
  );

  readonly filteredItems = computed<ClothingItem[]>(() => {
    const q = this.searchQuery().toLowerCase().trim();
    // Category is handled server-side; only apply free-text search client-side
    if (!q) return this.allItems();
    return this.allItems().filter(item => matchesItem(item, q));
  });

  constructor(
    private wardrobe: WardrobeService,
    private router: Router,
    private route: ActivatedRoute,
  ) {}

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    const cat    = params.get('category') ?? 'all';
    const sf     = (params.get('sortField') as WardrobeSortField) ?? 'dateAdded';
    const sd     = (params.get('sortDir') as 'asc' | 'desc') ?? 'desc';
    this.selectedCategory.set(cat);
    this.sortField.set(sf);
    this.sortDir.set(sd);
    this.loadItems();
  }

  /** Called by DashboardComponent header Upload button */
  triggerUpload(): void {
    this.uploadRef.openFilePicker();
  }

  selectCategory(cat: string): void {
    this.selectedCategory.set(cat);
    this.syncUrl();
    this.loadItems();
  }

  onSortChange(key: string): void {
    const [field, dir] = key.split(':');
    this.sortField.set(field as WardrobeSortField);
    this.sortDir.set(dir as 'asc' | 'desc');
    this.syncUrl();
    this.loadItems();
  }

  loadMore(): void {
    const token = this.nextToken();
    if (!token || this.loadingMore()) return;
    this.loadingMore.set(true);
    this.wardrobe.getAll(this.buildQuery(token)).subscribe({
      next: res => {
        this.allItems.update(curr => [...curr, ...res.items]);
        this.nextToken.set(res.nextContinuationToken ?? null);
        this.hasMore.set(!!res.nextContinuationToken);
        this.loadingMore.set(false);
      },
      error: () => this.loadingMore.set(false),
    });
  }

  private loadItems(): void {
    this.loading.set(true);
    this.nextToken.set(null);
    this.hasMore.set(false);
    this.wardrobe.getAll(this.buildQuery()).subscribe({
      next: res => { this.allItems.set(res.items); this.nextToken.set(res.nextContinuationToken ?? null); this.hasMore.set(!!res.nextContinuationToken); this.loading.set(false); },
      error: ()  => { this.loading.set(false); }
    });
  }

  private buildQuery(continuationToken?: string | null) {
    const cat = this.selectedCategory();
    return {
      category:          cat !== 'all' ? cat : undefined,
      sortField:         this.sortField(),
      sortDir:           this.sortDir(),
      pageSize:          24,
      continuationToken: continuationToken ?? undefined,
    };
  }

  private syncUrl(): void {
    const cat = this.selectedCategory();
    const sf  = this.sortField();
    const sd  = this.sortDir();
    this.router.navigate([], {
      queryParams: {
        category:  cat !== 'all'       ? cat  : null,
        sortField: sf  !== 'dateAdded' ? sf   : null,
        sortDir:   sd  !== 'desc'      ? sd   : null,
      },
      replaceUrl: true,
    });
  }

  onFileSelected(file: File): void {
    this.uploading.set(true);
    this.uploadError.set(null);
    this.wardrobe.uploadForDraft(file).subscribe({
      next: draft => { this.uploading.set(false); this.draftItem.set(draft); },
      error: err  => {
        this.uploading.set(false);
        this.uploadError.set(err?.error?.detail ?? err?.message ?? 'Upload failed. Please try again.');
      }
    });
  }

  onItemSaved(item: ClothingItem): void {
    this.wardrobe.save(item).subscribe({
      next: saved => { this.draftItem.set(null); this.allItems.update(curr => [saved, ...curr]); },
      error: err  => {
        this.uploadError.set(err?.error?.detail ?? err?.message ?? 'Save failed. Please try again.');
        this.draftItem.set(null);
      }
    });
  }

  onEditItem(item: ClothingItem): void {
    this.editingItem.set(item);
  }

  onItemUpdated(item: ClothingItem): void {
    this.wardrobe.update(item).subscribe({
      next: () => {
        this.editingItem.set(null);
        this.allItems.update(curr => curr.map(i => i.id === item.id ? item : i));
      },
      error: err => {
        this.uploadError.set(err?.error?.detail ?? err?.message ?? 'Update failed. Please try again.');
        this.editingItem.set(null);
      }
    });
  }

  onDeleteItem(item: ClothingItem): void {
    this.deletingItem.set(item);
  }

  confirmDelete(): void {
    const item = this.deletingItem();
    if (!item) return;
    this.wardrobe.delete(item.id).subscribe({
      next: () => {
        this.deletingItem.set(null);
        this.allItems.update(curr => curr.filter(i => i.id !== item.id));
      },
      error: err => {
        this.uploadError.set(err?.error?.detail ?? err?.message ?? 'Delete failed. Please try again.');
        this.deletingItem.set(null);
      }
    });
  }
}

