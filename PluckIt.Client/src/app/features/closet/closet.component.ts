import { Component, computed, input, OnInit, signal, ViewChild } from '@angular/core';
import { WardrobeService } from '../../core/services/wardrobe.service';
import { ClothingItem } from '../../core/models/clothing-item.model';
import { UploadItemComponent } from './upload-item.component';
import { ClothingCardComponent } from './clothing-card.component';
import { ReviewItemModalComponent } from './review-item-modal.component';

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
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h2 class="text-xl font-bold text-white">Digital Archive</h2>
          <p class="text-sm text-slate-text font-mono mt-1">{{ allItems().length }} ITEMS INDEXED</p>
        </div>

        <!-- Category pills -->
        <div class="flex flex-wrap gap-2">
          <button
            class="px-4 py-1.5 rounded-full text-sm font-medium transition-colors"
            [class]="selectedCategory() === 'all'
              ? 'bg-white text-black'
              : 'bg-card-dark border border-[#333] text-slate-text hover:text-white hover:border-slate-500'"
            (click)="selectedCategory.set('all')"
          >All Items</button>

          @for (cat of allCategories(); track cat) {
            <button
              class="px-4 py-1.5 rounded-full text-sm font-medium transition-colors capitalize"
              [class]="selectedCategory() === cat
                ? 'bg-white text-black'
                : 'bg-card-dark border border-[#333] text-slate-text hover:text-white hover:border-slate-500'"
              (click)="selectedCategory.set(cat)"
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
            <app-clothing-card [item]="item" />
          }
        </div>
      }
    </section>

    <!-- Review modal -->
    @if (draftItem()) {
      <app-review-item-modal
        [item]="draftItem()"
        [knownBrands]="knownBrands()"
        (saved)="onItemSaved($event)"
        (cancelled)="draftItem.set(null)"
      />
    }
  `,
})
export class WardrobeComponent implements OnInit {
  /** Forwarded from the dashboard search bar */
  readonly searchQuery = input('');

  @ViewChild('uploadRef') private uploadRef!: UploadItemComponent;

  readonly allItems    = signal<ClothingItem[]>([]);
  readonly draftItem   = signal<ClothingItem | null>(null);
  readonly loading     = signal(false);
  readonly uploading   = signal(false);
  readonly uploadError = signal<string | null>(null);
  readonly selectedCategory = signal<string>('all');

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
    const cat = this.selectedCategory();
    const q   = this.searchQuery().toLowerCase().trim();
    return this.allItems().filter(item => {
      const matchesCat    = cat === 'all' || item.category?.toLowerCase() === cat.toLowerCase();
      const matchesSearch = !q
        || item.category?.toLowerCase().includes(q)
        || item.brand?.toLowerCase().includes(q)
        || item.tags.some(t => t.toLowerCase().includes(q));
      return matchesCat && matchesSearch;
    });
  });

  constructor(private wardrobe: WardrobeService) {}

  ngOnInit(): void {
    this.loadItems();
  }

  /** Called by DashboardComponent header Upload button */
  triggerUpload(): void {
    this.uploadRef.openFilePicker();
  }

  private loadItems(): void {
    this.loading.set(true);
    this.wardrobe.getAll({ pageSize: 100 }).subscribe({
      next: items => { this.allItems.set(items); this.loading.set(false); },
      error: ()    => { this.loading.set(false); }
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
}

