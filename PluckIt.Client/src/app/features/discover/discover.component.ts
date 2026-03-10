import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { DiscoverService } from '../../core/services/discover.service';
import { ScrapedItem, ScraperSource } from '../../core/models/scraped-item.model';
import { DiscoverCardComponent } from './discover-card.component';
import { SourceSidebarComponent } from './source-sidebar.component';

@Component({
  selector: 'app-discover',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, DiscoverCardComponent, SourceSidebarComponent],
  template: `
    <div class="relative flex h-screen flex-col overflow-hidden bg-black text-slate-100">

      <!-- Top bar -->
      <header class="flex items-center gap-4 border-b border-border-chrome px-6 py-3 flex-shrink-0">
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-primary">explore</span>
          <h1 class="text-sm font-bold tracking-wide">Discover</h1>
        </div>

        <!-- Search -->
        <div class="flex-1 max-w-sm">
          <div class="relative">
            <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-base">search</span>
            <input
              [(ngModel)]="searchQuery"
              placeholder="Search styles, tags…"
              class="w-full rounded-lg bg-zinc-900 border border-border-chrome pl-9 pr-3 py-1.5 text-xs
                     text-slate-100 placeholder-slate-600 outline-none focus:border-primary/50"
            />
          </div>
        </div>

        <!-- Sort -->
        <div class="flex items-center gap-2 ml-auto">
          <span class="text-xs text-slate-500">Sort:</span>
          <button
            class="rounded-lg border px-3 py-1.5 text-xs transition-colors"
            [class]="sortBy() === 'score'
              ? 'border-primary/40 bg-primary/10 text-primary'
              : 'border-border-chrome text-slate-400 hover:text-slate-100'"
            (click)="setSortBy('score')"
          >
            Top
          </button>
          <button
            class="rounded-lg border px-3 py-1.5 text-xs transition-colors"
            [class]="sortBy() === 'recent'
              ? 'border-primary/40 bg-primary/10 text-primary'
              : 'border-border-chrome text-slate-400 hover:text-slate-100'"
            (click)="setSortBy('recent')"
          >
            Recent
          </button>
        </div>

        <!-- Time range -->
        <div class="flex items-center gap-1.5">
          <span class="text-xs text-slate-500">Range:</span>
          @for (opt of timeRangeOptions; track opt.value) {
            <button
              class="rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors"
              [class]="timeRange() === opt.value
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border-chrome text-slate-400 hover:text-slate-100'"
              (click)="setTimeRange(opt.value)"
            >
              {{ opt.label }}
            </button>
          }
        </div>

      </header>

      <!-- Body: sidebar + grid -->
      <div class="flex flex-1 overflow-hidden">

        <!-- Source sidebar -->
        <app-source-sidebar
          [sources]="sources()"
          [activeSourceId]="activeSourceId()"
          (sourceSelected)="onSourceSelected($event)"
          (unsubscribe)="onUnsubscribe($event)"
          (suggestBrand)="onSuggestBrand($event)"
        />

        <!-- Main feed -->
        <main class="flex-1 overflow-y-auto px-6 py-6">

          @if (loading()) {
            <!-- Skeleton loader -->
            <div class="columns-2 md:columns-3 lg:columns-4 xl:columns-5 gap-4 space-y-4">
              @for (n of skeletons; track n) {
                <div class="break-inside-avoid mb-4 rounded-xl bg-zinc-900 animate-pulse"
                  [style.height.px]="200 + (n % 3) * 60">
                </div>
              }
            </div>

          } @else if (filteredItems().length === 0) {
            <!-- Empty state -->
            <div class="flex flex-col items-center justify-center h-full gap-4 text-center">
              <span class="material-symbols-outlined text-5xl text-slate-700">image_not_supported</span>
              <p class="text-slate-500 text-sm">No items found. Try a different source or run the scraper.</p>
            </div>

          } @else {
            <!-- Masonry grid via CSS columns -->
            <div class="columns-2 md:columns-3 lg:columns-4 xl:columns-5 gap-4">
              @for (item of filteredItems(); track item.id) {
                <div class="break-inside-avoid mb-4">
                  <app-discover-card
                    [item]="item"
                    (cardClicked)="onCardClick($event)"
                    (feedbackSent)="onFeedback($event)"
                  />
                </div>
              }
            </div>

            <!-- Load more -->
            @if (nextToken()) {
              <div class="flex justify-center mt-8">
                <button
                  class="flex items-center gap-2 rounded-lg border border-border-chrome px-6 py-2.5 text-sm
                         text-slate-400 hover:border-primary/50 hover:text-primary transition-colors"
                  [disabled]="loadingMore()"
                  (click)="loadMore()"
                >
                  @if (loadingMore()) {
                    <span class="material-symbols-outlined animate-spin text-base">progress_activity</span>
                  }
                  Load more
                </button>
              </div>
            }
          }
        </main>
      </div>

      <!-- Item detail overlay -->
      @if (selectedItem()) {
        <div
          class="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
          style="background: rgba(0,0,0,0.75); backdrop-filter: blur(6px);"
          (click)="selectedItem.set(null); galleryIndex.set(0)"
        >
          <div
            class="relative w-full max-w-md rounded-2xl border border-border-chrome bg-zinc-950 shadow-2xl mx-4 overflow-hidden max-h-[90vh] flex flex-col"
            (click)="$event.stopPropagation()"
          >
            <button
              class="absolute top-3 right-3 z-10 text-slate-500 hover:text-slate-200 bg-zinc-950/80 rounded-full p-1"
              (click)="selectedItem.set(null); galleryIndex.set(0)"
            >
              <span class="material-symbols-outlined">close</span>
            </button>

            <!-- Gallery slideshow -->
            @if ((selectedItem()!.galleryImages?.length ?? 0) > 1) {
              <div class="relative w-full bg-zinc-900 flex-shrink-0">
                <img
                  [src]="selectedItem()!.galleryImages![galleryIndex()]"
                  [alt]="selectedItem()!.title"
                  class="w-full max-h-72 object-contain"
                />
                <!-- Prev/Next -->
                <button
                  class="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
                  (click)="onPrevImage()"
                >
                  <span class="material-symbols-outlined text-base">chevron_left</span>
                </button>
                <button
                  class="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
                  (click)="onNextImage()"
                >
                  <span class="material-symbols-outlined text-base">chevron_right</span>
                </button>
                <!-- Dot indicators -->
                <div class="absolute bottom-2 left-0 right-0 flex justify-center gap-1">
                  @for (img of selectedItem()!.galleryImages!; track $index) {
                    <button
                      class="h-1.5 rounded-full transition-all"
                      [class]="$index === galleryIndex() ? 'w-4 bg-white' : 'w-1.5 bg-white/40'"
                      (click)="onJumpToImage($index)"
                    ></button>
                  }
                </div>
                <!-- Counter -->
                <span class="absolute top-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-slate-300">
                  {{ galleryIndex() + 1 }} / {{ selectedItem()!.galleryImages!.length }}
                </span>

                <!-- Like/dislike on gallery image -->
                <div class="absolute bottom-2 right-2 flex items-center gap-1.5">
                  <button
                    class="flex items-center justify-center h-7 w-7 rounded-full transition-all active:scale-90"
                    [class]="modalVoted() === 'down' ? 'bg-rose-600 text-white' : 'bg-black/60 text-slate-300 hover:bg-rose-900/70 hover:text-rose-300'"
                    title="Not for me"
                    (click)="onModalFeedback('down')"
                  ><span class="material-symbols-outlined text-sm">thumb_down</span></button>
                  <button
                    class="flex items-center justify-center h-7 w-7 rounded-full transition-all active:scale-90"
                    [class]="modalVoted() === 'up' ? 'bg-emerald-600 text-white' : 'bg-black/60 text-slate-300 hover:bg-emerald-900/70 hover:text-emerald-300'"
                    title="Love it"
                    (click)="onModalFeedback('up')"
                  ><span class="material-symbols-outlined text-sm">thumb_up</span></button>
                </div>
              </div>
            } @else {
              <!-- Single image with like/dislike overlay -->
              <div class="relative w-full bg-zinc-900 flex-shrink-0">
                <img
                  [src]="selectedItem()!.imageUrl"
                  [alt]="selectedItem()!.title"
                  class="w-full max-h-72 object-contain"
                />
                <div class="absolute bottom-2 right-2 flex items-center gap-1.5">
                  <button
                    class="flex items-center justify-center h-7 w-7 rounded-full transition-all active:scale-90"
                    [class]="modalVoted() === 'down' ? 'bg-rose-600 text-white' : 'bg-black/60 text-slate-300 hover:bg-rose-900/70 hover:text-rose-300'"
                    title="Not for me"
                    (click)="onModalFeedback('down')"
                  ><span class="material-symbols-outlined text-sm">thumb_down</span></button>
                  <button
                    class="flex items-center justify-center h-7 w-7 rounded-full transition-all active:scale-90"
                    [class]="modalVoted() === 'up' ? 'bg-emerald-600 text-white' : 'bg-black/60 text-slate-300 hover:bg-emerald-900/70 hover:text-emerald-300'"
                    title="Love it"
                    (click)="onModalFeedback('up')"
                  ><span class="material-symbols-outlined text-sm">thumb_up</span></button>
                </div>
              </div>
            }

            <!-- Scrollable content -->
            <div class="flex flex-col gap-3 p-5 overflow-y-auto">
              <h3 class="text-sm font-semibold text-slate-100 pr-6">{{ selectedItem()!.title }}</h3>

              @if (selectedItem()!.description) {
                <p class="text-xs text-slate-400 line-clamp-3">{{ selectedItem()!.description }}</p>
              }

              <div class="flex flex-wrap gap-1">
                @for (tag of selectedItem()!.tags; track tag) {
                  <span class="rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-slate-400">{{ tag }}</span>
                }
              </div>

              @if (selectedItem()!.buyLinks.length > 0) {
                <div class="space-y-1.5">
                  <p class="text-[10px] font-bold uppercase tracking-widest text-slate-500">Buy Links</p>
                  @for (link of selectedItem()!.buyLinks; track link.url) {
                    <a
                      [href]="link.url"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="flex items-center justify-between rounded-lg border border-border-chrome bg-zinc-900
                             px-3 py-2 text-xs text-slate-300 hover:border-primary/50 hover:text-primary transition-colors"
                    >
                      <span class="flex items-center gap-2">
                        <span class="material-symbols-outlined text-base">shopping_bag</span>
                        {{ link.label || link.platform }}
                      </span>
                      @if (link.label) {
                        <span class="text-[9px] text-slate-500 ml-1">{{ link.platform }}</span>
                      }
                      <span class="material-symbols-outlined text-base">open_in_new</span>
                    </a>
                  }
                </div>
              }

              <!-- Comment excerpt (buy-link source context) -->
              @if (selectedItem()!.commentText) {
                <details class="text-[10px] text-slate-500 cursor-pointer">
                  <summary class="font-bold uppercase tracking-widest hover:text-slate-300 transition-colors">
                    Top Comments
                  </summary>
                  <p class="mt-2 whitespace-pre-wrap leading-relaxed">{{ selectedItem()!.commentText }}</p>
                </details>
              }

              @if (selectedItem()!.productUrl) {
                <a
                  [href]="selectedItem()!.productUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="flex w-full items-center justify-center gap-2 rounded-lg bg-primary/10 border border-primary/30
                         py-2.5 text-xs font-semibold text-primary hover:bg-primary/20 transition-colors"
                >
                  <span class="material-symbols-outlined text-base">link</span>
                  View Original Post
                </a>
              }
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class DiscoverComponent implements OnInit {
  protected allItems = signal<ScrapedItem[]>([]);
  protected sources = signal<ScraperSource[]>([]);
  protected loading = signal(true);
  protected loadingMore = signal(false);
  protected activeSourceId = signal<string | null>(null);
  protected sortBy = signal<'score' | 'recent'>('score');
  protected timeRange = signal<'1h' | '1d' | '7d' | '30d' | 'all'>('all');
  protected nextToken = signal<string | null>(null);
  protected selectedItem = signal<ScrapedItem | null>(null);
  protected galleryIndex = signal(0);
  protected modalVoted = signal<'up' | 'down' | null>(null);
  protected searchQuery = '';
  private preloadedImageUrls = new Set<string>();

  readonly skeletons = Array.from({ length: 15 }, (_, i) => i);
  readonly timeRangeOptions = [
    { value: '1h' as const, label: '1h' },
    { value: '1d' as const, label: '1d' },
    { value: '7d' as const, label: '7d' },
    { value: '30d' as const, label: '30d' },
    { value: 'all' as const, label: 'All' },
  ];

  readonly filteredItems = computed(() => {
    const q = this.searchQuery.toLowerCase().trim();
    if (!q) return this.allItems();
    return this.allItems().filter(item =>
      item.title.toLowerCase().includes(q) ||
      item.tags.some(t => t.toLowerCase().includes(q))
    );
  });

  constructor(private discoverService: DiscoverService) {}

  ngOnInit() {
    this.loadSources();
    this.loadFeed();
  }

  private loadSources() {
    this.discoverService.getSources().subscribe({
      next: sources => this.sources.set(sources),
    });
  }

  private loadFeed(append = false) {
    if (!append) this.loading.set(true);
    else this.loadingMore.set(true);

    this.discoverService.getFeed({
      sortBy: this.sortBy(),
      timeRange: this.timeRange(),
      sourceIds: this.activeSourceId() ? [this.activeSourceId()!] : undefined,
      continuationToken: append ? this.nextToken() : null,
      pageSize: 50,
    }).subscribe({
      next: res => {
        if (append) {
          this.allItems.update(items => [...items, ...res.items]);
        } else {
          this.allItems.set(res.items);
        }
        this.nextToken.set(res.nextContinuationToken ?? null);
        this.loading.set(false);
        this.loadingMore.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.loadingMore.set(false);
      },
    });
  }

  setSortBy(sort: 'score' | 'recent') {
    this.sortBy.set(sort);
    this.loadFeed();
  }

  setTimeRange(range: '1h' | '1d' | '7d' | '30d' | 'all') {
    this.timeRange.set(range);
    this.loadFeed();
  }

  onSourceSelected(sourceId: string | null) {
    this.activeSourceId.set(sourceId);
    this.loadFeed();
  }

  onUnsubscribe(sourceId: string) {
    this.discoverService.unsubscribe(sourceId).subscribe({
      next: () => this.loadSources(),
    });
  }

  onSuggestBrand(payload: { name: string; url: string }) {
    this.discoverService.suggestSource(payload.name, payload.url, 'brand').subscribe({
      next: () => this.loadSources(),
    });
  }

  onCardClick(item: ScrapedItem) {
    this.galleryIndex.set(0);
    this.modalVoted.set(null);
    this.selectedItem.set(item);
    this.preloadGalleryForCurrentSelection();
  }

  onFeedback(event: { itemId: string; signal: 'up' | 'down'; galleryImageIndex?: number }) {
    this.discoverService.sendFeedback(event.itemId, event.signal, event.galleryImageIndex).subscribe();
  }

  onModalFeedback(signal: 'up' | 'down') {
    const item = this.selectedItem();
    if (!item) return;
    const hasGallery = (item.galleryImages?.length ?? 0) > 1;
    const index = hasGallery ? this.galleryIndex() : undefined;
    this.discoverService.sendFeedback(item.id, signal, index).subscribe();
    this.modalVoted.set(signal);
  }

  onPrevImage() {
    const item = this.selectedItem();
    if (!item?.galleryImages?.length) return;
    const len = item.galleryImages.length;
    const next = (this.galleryIndex() - 1 + len) % len;
    this.galleryIndex.set(next);
    this.modalVoted.set(null);
    this.preloadNeighborImages(item.galleryImages, next);
  }

  onNextImage() {
    const item = this.selectedItem();
    if (!item?.galleryImages?.length) return;
    const len = item.galleryImages.length;
    const next = (this.galleryIndex() + 1) % len;
    this.galleryIndex.set(next);
    this.modalVoted.set(null);
    this.preloadNeighborImages(item.galleryImages, next);
  }

  onJumpToImage(index: number) {
    const item = this.selectedItem();
    if (!item?.galleryImages?.length) return;
    this.galleryIndex.set(index);
    this.modalVoted.set(null);
    this.preloadNeighborImages(item.galleryImages, index);
  }

  private preloadGalleryForCurrentSelection() {
    const item = this.selectedItem();
    if (!item) return;
    if (item.imageUrl) this.preloadImage(item.imageUrl);
    if (!item.galleryImages?.length) return;
    // Preload all gallery frames once modal opens to make next/prev instant.
    for (const url of item.galleryImages) this.preloadImage(url);
    this.preloadNeighborImages(item.galleryImages, this.galleryIndex());
  }

  private preloadNeighborImages(images: string[], activeIndex: number) {
    if (!images.length) return;
    const len = images.length;
    this.preloadImage(images[(activeIndex + 1) % len]);
    this.preloadImage(images[(activeIndex - 1 + len) % len]);
  }

  private preloadImage(url?: string | null) {
    if (!url || this.preloadedImageUrls.has(url)) return;
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    this.preloadedImageUrls.add(url);
  }


  loadMore() {
    this.loadFeed(true);
  }
}
