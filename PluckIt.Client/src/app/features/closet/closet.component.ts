import { Component, computed, DestroyRef, EventEmitter, inject, input, OnInit, Output, signal, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { WardrobeService } from '../../core/services/wardrobe.service';
import { ClothingItem } from '../../core/models/clothing-item.model';
import type { WardrobeSortField } from '../../core/models/clothing-item.model';
import { UploadItemComponent } from './upload-item.component';
import { ClothingCardComponent } from './clothing-card.component';
import { ReviewItemModalComponent } from './review-item-modal.component';
import { switchMap, interval } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { matchesItem } from '../../core/utils/search.utils';
import { resizeImageFile } from '../../core/utils/image-utils';

/** A single entry in the client-side upload pipeline. */
interface UploadQueueItem {
  /** Transient client ID — not the Cosmos document ID. */
  localId: string;
  file: File;
  status: 'queued' | 'uploading' | 'ready' | 'failed';
  /** Set once the server persists a Cosmos draft document. */
  draftId?: string;
  /** AI-extracted category, populated after processing completes. */
  category?: string;
  /** Human-readable error for failed items. */
  error?: string;
}

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

    <!-- ─── Upload Pipeline Strip ──────────────────────────────────────── -->
    @if (uploadQueue().length > 0 || serverOnlyDrafts().length > 0) {
      <section class="px-6 md:px-8 py-4 border-b border-border-subtle bg-black/30">
        <h3 class="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-3">Upload Pipeline</h3>
        <div class="flex flex-wrap gap-2">

          <!-- Current-session queue items -->
          @for (qi of uploadQueue(); track qi.localId) {
            <div class="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[11px] font-mono transition-all"
              [class]="qi.status === 'queued'    ? 'bg-[#111] border-[#333] text-slate-400' :
                       qi.status === 'uploading' ? 'bg-blue-950/50 border-blue-800/60 text-blue-300' :
                       qi.status === 'ready'     ? 'bg-green-950/40 border-green-800/50 text-green-300' :
                                                   'bg-red-950/40 border-red-800/50 text-red-300'">
              @if (qi.status === 'queued') {
                <span class="material-symbols-outlined" style="font-size:11px">schedule</span>
              } @else if (qi.status === 'uploading') {
                <span class="material-symbols-outlined animate-spin" style="font-size:11px">sync</span>
              } @else if (qi.status === 'ready') {
                <span class="material-symbols-outlined" style="font-size:11px">check_circle</span>
              } @else {
                <span class="material-symbols-outlined" style="font-size:11px">error</span>
              }
              <span class="max-w-[100px] truncate">{{ qi.category ?? qi.file.name }}</span>
              @if (qi.status === 'ready' && qi.draftId) {
                <button class="ml-1 underline text-green-400 hover:text-green-200"
                  (click)="onQueueItemReview(qi)">Review</button>
              }
              @if (qi.status === 'failed' && qi.draftId) {
                <button class="ml-1 underline text-yellow-400 hover:text-yellow-200"
                  (click)="onQueueItemRetry(qi)">Retry</button>
              }
              @if (qi.status === 'failed' || qi.status === 'ready') {
                <button class="ml-1 text-slate-400 hover:text-red-300"
                  (click)="onQueueItemDismiss(qi)" aria-label="Dismiss">✕</button>
              }
            </div>
          }

          <!-- Server-persisted drafts from previous sessions -->
          @for (draft of serverOnlyDrafts(); track draft.id) {
            <div class="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[11px] font-mono transition-all"
              [class]="draft.draftStatus === 'Ready'
                ? 'bg-green-950/40 border-green-800/50 text-green-300'
                : draft.draftStatus === 'Processing' || retryingDraftIds().has(draft.id)
                ? 'bg-blue-950/50 border-blue-800/60 text-blue-300'
                : 'bg-red-950/40 border-red-800/50 text-red-300'">
              @if (draft.draftStatus === 'Ready') {
                <span class="material-symbols-outlined" style="font-size:11px">check_circle</span>
              } @else if (draft.draftStatus === 'Processing' || retryingDraftIds().has(draft.id)) {
                <span class="material-symbols-outlined animate-spin" style="font-size:11px">sync</span>
              } @else {
                <span class="material-symbols-outlined" style="font-size:11px">error</span>
              }
              <span class="max-w-[100px] truncate">{{ draft.category ?? 'Item' }}</span>
              @if (draft.draftStatus === 'Ready') {
                <button class="ml-1 underline text-green-400 hover:text-green-200"
                  (click)="reviewingDraft.set(draft)">Review</button>
              }
              @if (draft.draftStatus === 'Failed' && !retryingDraftIds().has(draft.id)) {
                <button class="ml-1 underline text-yellow-400 hover:text-yellow-200"
                  (click)="onServerDraftRetry(draft)">Retry</button>
              }
              <button class="ml-1 text-slate-400 hover:text-red-300"
                (click)="onServerDraftDismiss(draft)" aria-label="Dismiss">✕</button>
            </div>
          }
        </div>
      </section>
    }

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

    <!-- Draft review modal (create mode) -->
    @if (reviewingDraft()) {
      <app-review-item-modal
        [item]="reviewingDraft()"
        [knownBrands]="knownBrands()"
        [isEditMode]="false"
        (saved)="onDraftReviewSaved($event)"
        (cancelled)="reviewingDraft.set(null)"
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

  // ── Wardrobe archive ─────────────────────────────────────────────────────
  readonly allItems     = signal<ClothingItem[]>([]);
  readonly editingItem  = signal<ClothingItem | null>(null);
  readonly deletingItem = signal<ClothingItem | null>(null);
  readonly loading      = signal(false);
  readonly loadingMore  = signal(false);
  readonly hasMore      = signal(false);
  readonly nextToken    = signal<string | null>(null);
  readonly uploadError  = signal<string | null>(null);
  readonly selectedCategory = signal<string>('all');
  readonly sortField    = signal<WardrobeSortField>('dateAdded');
  readonly sortDir      = signal<'asc' | 'desc'>('desc');

  // ── Upload pipeline (multi-file queue + persistent server drafts) ────────
  readonly uploadQueue    = signal<UploadQueueItem[]>([]);
  readonly drafts         = signal<ClothingItem[]>([]);
  readonly reviewingDraft = signal<ClothingItem | null>(null);
  /** IDs of server-only drafts currently being retried (in-flight). */
  readonly retryingDraftIds = signal<Set<string>>(new Set());

  /** True while at least one item is being uploaded/processed. */
  readonly uploading = computed(() =>
    this.uploadQueue().some(q => q.status === 'uploading'),
  );

  /** IDs of drafts currently tracked in the clientside upload queue. */
  private readonly _queueDraftIds = computed(() =>
    new Set(this.uploadQueue().map(q => q.draftId).filter(Boolean) as string[]),
  );

  /**
   * Server-persisted drafts from the previous session or a different tab.
   * Excludes any drafts that are already represented in the current upload queue.
   */
  readonly serverOnlyDrafts = computed<ClothingItem[]>(() => {
    const queueIds = this._queueDraftIds();
    return this.drafts().filter(d => !queueIds.has(d.id));
  });

  /** True while the serial queue processor is running. */
  private _queueRunning = false;

  private readonly destroyRef = inject(DestroyRef);

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
    this.refreshDrafts();

    // Auto-poll every 5 s while any server-persisted draft is still Processing.
    interval(5000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.serverOnlyDrafts().some(d => d.draftStatus === 'Processing')) {
          this.refreshDrafts();
        }
      });

    // Refresh drafts when the user returns to this tab
    const visibilityHandler = () => {
      if (document.visibilityState === 'visible') this.refreshDrafts();
    };
    document.addEventListener('visibilitychange', visibilityHandler);
    this.destroyRef.onDestroy(() =>
      document.removeEventListener('visibilitychange', visibilityHandler),
    );
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

  /** Handles multi-file selection from the upload component. */
  onFileSelected(files: File[]): void {
    this.uploadError.set(null);
    const newItems: UploadQueueItem[] = files.map(file => ({
      localId: crypto.randomUUID(),
      file,
      status: 'queued' as const,
    }));
    this.uploadQueue.update(curr => [...curr, ...newItems]);
    this.processQueue();
  }

  // ── Draft pipeline ─────────────────────────────────────────────────────

  private refreshDrafts(): void {
    this.wardrobe.getDrafts().subscribe({
      next: res => this.drafts.set(res.items),
      error: () => { /* silently ignore — queue state is the primary source of truth */ },
    });
  }

  /**
   * Serially processes all queued items. Guarded by `_queueRunning` to prevent
   * double-invocation when `onFileSelected` is called while a run is in progress.
   */
  private async processQueue(): Promise<void> {
    if (this._queueRunning) return;
    this._queueRunning = true;

    try {
      while (true) {
        const queue = this.uploadQueue();
        const next = queue.find(q => q.status === 'queued');
        if (!next) break;

        // Mark as uploading
        this.uploadQueue.update(curr =>
          curr.map(q => q.localId === next.localId ? { ...q, status: 'uploading' as const } : q),
        );

        // Optionally resize before sending (skips HEIC)
        let fileToSend: File;
        try {
          fileToSend = await resizeImageFile(next.file, 1536);
        } catch {
          fileToSend = next.file;
        }

        await new Promise<void>(resolve => {
          this.wardrobe.uploadForDraft(fileToSend).subscribe({
            next: (result) => {
              // 200/201 — draft is Ready
              this.uploadQueue.update(curr =>
                curr.map(q => q.localId === next.localId
                  ? { ...q, status: 'ready' as const, draftId: result.id, category: result.category ?? undefined }
                  : q),
              );
              // Merge into local drafts list
              this.drafts.update(curr => {
                const without = curr.filter(d => d.id !== result.id);
                return [result, ...without];
              });
              resolve();
            },
            error: (err) => {
              // 422 means the pipeline ran but failed; the body carries the Failed draft
              if (err?.status === 422 && err?.error?.id) {
                const failedDraft = err.error as ClothingItem;
                this.uploadQueue.update(curr =>
                  curr.map(q => q.localId === next.localId
                    ? { ...q, status: 'failed' as const, draftId: failedDraft.id,
                        error: failedDraft.draftError ?? 'Processing failed' }
                    : q),
                );
                this.drafts.update(curr => {
                  const without = curr.filter(d => d.id !== failedDraft.id);
                  return [failedDraft, ...without];
                });
              } else {
                // Network / server error — no Cosmos draft was created
                this.uploadQueue.update(curr =>
                  curr.map(q => q.localId === next.localId
                    ? { ...q, status: 'failed' as const,
                        error: err?.error?.detail ?? err?.message ?? 'Upload failed' }
                    : q),
                );
              }
              resolve();
            },
          });
        });
      }
    } finally {
      this._queueRunning = false;
    }
  }

  // ── Queue item actions ────────────────────────────────────────────────

  onQueueItemReview(qi: UploadQueueItem): void {
    if (!qi.draftId) return;
    const draft = this.drafts().find(d => d.id === qi.draftId);
    if (draft) this.reviewingDraft.set(draft);
  }

  onQueueItemRetry(qi: UploadQueueItem): void {
    if (!qi.draftId) return;
    this.wardrobe.retryDraft(qi.draftId).subscribe({
      next: result => {
        this.uploadQueue.update(curr =>
          curr.map(q => q.localId === qi.localId
            ? { ...q, status: 'ready' as const, error: undefined }
            : q),
        );
        this.drafts.update(curr =>
          curr.map(d => d.id === result.id ? result : d),
        );
      },
      error: () => {
        this.uploadError.set('Retry failed. Please try again.');
      },
    });
  }

  onQueueItemDismiss(qi: UploadQueueItem): void {
    if (qi.draftId) {
      this.wardrobe.dismissDraft(qi.draftId).subscribe({
        error: () => { /* best-effort */ },
      });
      this.drafts.update(curr => curr.filter(d => d.id !== qi.draftId));
    }
    this.uploadQueue.update(curr => curr.filter(q => q.localId !== qi.localId));
  }

  dismissQueueItem(localId: string): void {
    this.uploadQueue.update(curr => curr.filter(q => q.localId !== localId));
  }

  // ── Server-only draft actions ─────────────────────────────────────────

  onServerDraftRetry(draft: ClothingItem): void {
    this.retryingDraftIds.update(s => new Set([...s, draft.id]));
    this.wardrobe.retryDraft(draft.id).subscribe({
      next: result => {
        this.retryingDraftIds.update(s => { s = new Set(s); s.delete(draft.id); return s; });
        this.drafts.update(curr =>
          curr.map(d => d.id === result.id ? result : d),
        );
      },
      error: () => {
        this.retryingDraftIds.update(s => { s = new Set(s); s.delete(draft.id); return s; });
        this.uploadError.set('Retry failed. Please try again.');
      },
    });
  }

  onServerDraftDismiss(draft: ClothingItem): void {
    this.wardrobe.dismissDraft(draft.id).subscribe({
      error: () => { /* best-effort */ },
    });
    this.drafts.update(curr => curr.filter(d => d.id !== draft.id));
  }

  // ── Draft review modal callback ───────────────────────────────────────

  /**
   * Called when the user clicks Save in the review modal.
   * Accepts the Ready draft by calling PATCH /api/wardrobe/drafts/{id}/accept,
   * which moves the item to the main wardrobe by removing draftStatus.
   */
  onDraftReviewSaved(item: ClothingItem): void {
    // First persist the user's reviewed edits, then promote from draft to wardrobe.
    this.wardrobe.update(item).pipe(
      switchMap(() => this.wardrobe.acceptDraft(item.id)),
    ).subscribe({
      next: accepted => {
        this.reviewingDraft.set(null);
        // Remove from draft lists
        this.drafts.update(curr => curr.filter(d => d.id !== accepted.id));
        this.uploadQueue.update(curr => curr.filter(q => q.draftId !== accepted.id));
        // Add to main wardrobe grid
        this.allItems.update(curr => [accepted, ...curr]);
      },
      error: err => {
        this.uploadError.set(
          err?.error?.detail ?? err?.message ?? 'Could not accept draft. Please try again.',
        );
        this.reviewingDraft.set(null);
      },
    });
  }

  // ── Wardrobe archive actions ──────────────────────────────────────────

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

  // ── Private helpers ───────────────────────────────────────────────────

  private loadItems(): void {
    this.loading.set(true);
    this.nextToken.set(null);
    this.hasMore.set(false);
    this.wardrobe.getAll(this.buildQuery()).subscribe({
      next: res => {
        this.allItems.set(res.items);
        this.nextToken.set(res.nextContinuationToken ?? null);
        this.hasMore.set(!!res.nextContinuationToken);
        this.loading.set(false);
      },
      error: () => { this.loading.set(false); }
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
}


