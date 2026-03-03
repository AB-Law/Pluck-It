import { Component, OnInit, computed, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';
import { Collection } from '../../core/models/collection.model';
import { CollectionService } from '../../core/services/collection.service';
import { WardrobeService } from '../../core/services/wardrobe.service';
import { AuthService } from '../../core/services/auth.service';
import { ClothingItem } from '../../core/models/clothing-item.model';
import { CreateCollectionModalComponent } from './create-collection-modal.component';

@Component({
  selector: 'app-collections',
  standalone: true,
  imports: [CommonModule, RouterLink, CreateCollectionModalComponent],
  template: `
    <div class="flex h-screen flex-col bg-black text-slate-100 font-display overflow-hidden">

      <!-- Header -->
      <header class="sticky top-0 z-50 flex h-16 w-full items-center justify-between border-b border-border-chrome bg-black px-6 shrink-0">
        <div class="flex items-center gap-4">
          <a routerLink="/" class="text-slate-400 hover:text-white transition-colors">
            <span class="material-symbols-outlined">arrow_back</span>
          </a>
          <h2 class="text-xl font-bold tracking-tighter text-slate-100">Collections</h2>
        </div>
        <button
          class="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-blue-500 transition-colors"
          (click)="showCreateModal.set(true)"
        >
          <span class="material-symbols-outlined text-sm">add</span>
          New Collection
        </button>
      </header>

      <!-- Body: 2-col split -->
      <div class="flex flex-1 overflow-hidden">

        <!-- Left: collection list -->
        <aside class="w-80 flex-shrink-0 border-r border-border-chrome overflow-y-auto p-4 space-y-2">

          @if (loading()) {
            <div class="flex items-center justify-center py-12 text-slate-500 text-sm">
              <span class="material-symbols-outlined animate-spin mr-2" style="font-size:20px">progress_activity</span>
              Loading…
            </div>
          } @else if (collections().length === 0) {
            <div class="flex flex-col items-center justify-center py-12 text-slate-600 text-sm">
              <span class="material-symbols-outlined mb-3" style="font-size:40px">folder_off</span>
              <p>No collections yet.</p>
              <button
                class="mt-4 text-primary text-xs underline"
                (click)="showCreateModal.set(true)"
              >Create one →</button>
            </div>
          } @else {
            @for (col of collections(); track col.id) {
              <button
                class="w-full text-left rounded-xl border p-4 transition-all"
                [class]="activeCollection()?.id === col.id ? 'border-primary bg-primary/10' : 'border-border-chrome bg-card-dark hover:border-slate-600'"
                (click)="selectCollection(col)"
              >
                <div class="flex items-start justify-between gap-2 mb-2">
                  <h4 class="text-sm font-bold text-slate-100 truncate">{{ col.name }}</h4>
                  <span class="text-[10px] font-mono shrink-0"
                    [class]="col.isPublic ? 'text-green-500' : 'text-slate-500'">
                    {{ col.isPublic ? 'PUBLIC' : 'PRIVATE' }}
                  </span>
                </div>
                @if (col.description) {
                  <p class="text-xs text-slate-500 line-clamp-2 mb-2">{{ col.description }}</p>
                }
                <div class="flex items-center justify-between text-[10px] text-slate-500 font-mono">
                  <span>{{ col.clothingItemIds.length }} items</span>
                  <span>{{ col.memberUserIds.length + 1 }} members</span>
                </div>
              </button>
            }
          }
        </aside>

        <!-- Right: collection detail -->
        <main class="flex-1 overflow-y-auto p-6">
          @if (activeCollection(); as col) {
            <!-- Collection header -->
            <div class="mb-6 flex items-start justify-between">
              <div>
                <h3 class="text-2xl font-bold text-slate-100 mb-1">{{ col.name }}</h3>
                @if (col.description) {
                  <p class="text-sm text-slate-400">{{ col.description }}</p>
                }
              </div>
              <div class="flex items-center gap-2">
                @if (isOwner(col)) {
                  <button
                    class="flex items-center gap-1.5 rounded-lg border border-border-chrome px-3 py-2 text-xs font-bold text-slate-300 hover:bg-card-dark transition-colors"
                    (click)="copyShareLink(col)"
                  >
                    <span class="material-symbols-outlined text-sm">share</span>
                    {{ shareLabel() }}
                  </button>
                  <button
                    class="flex items-center gap-1 rounded-lg border border-red-900/60 px-3 py-2 text-xs font-bold text-red-400 hover:bg-red-950/30 transition-colors"
                    (click)="deleteCollection(col)"
                  >
                    <span class="material-symbols-outlined text-sm">delete</span>
                    Delete
                  </button>
                } @else {
                  <button
                    class="rounded-lg border border-border-chrome px-3 py-2 text-xs font-bold text-slate-300 hover:bg-card-dark transition-colors"
                    (click)="leaveCollection(col)"
                  >
                    Leave
                  </button>
                }
              </div>
            </div>

            <!-- Members -->
            @if (col.memberUserIds.length > 0) {
              <div class="mb-6">
                <h5 class="mb-3 text-xs font-bold uppercase tracking-widest text-slate-500">Members</h5>
                <div class="flex -space-x-2">
                  <!-- Owner avatar -->
                  <div class="h-8 w-8 rounded-full bg-primary/30 border-2 border-black flex items-center justify-center text-xs font-bold text-primary z-10"
                       [title]="'Owner'">
                    O
                  </div>
                  @for (uid of col.memberUserIds.slice(0, 7); track uid) {
                    <div class="h-8 w-8 rounded-full bg-card-dark border-2 border-black flex items-center justify-center text-xs font-bold text-slate-300"
                         [title]="uid">
                      {{ uid.charAt(0).toUpperCase() }}
                    </div>
                  }
                  @if (col.memberUserIds.length > 7) {
                    <div class="h-8 w-8 rounded-full bg-border-chrome border-2 border-black flex items-center justify-center text-[10px] font-bold text-slate-400">
                      +{{ col.memberUserIds.length - 7 }}
                    </div>
                  }
                </div>
              </div>
            }

            <!-- Items grid -->
            @if (collectionItems().length === 0) {
              <div class="flex flex-col items-center justify-center py-16 text-slate-600">
                <span class="material-symbols-outlined mb-3" style="font-size:40px">inventory_2</span>
                <p class="text-sm">No items in this collection yet.</p>
                <a routerLink="/vault" class="mt-3 text-primary text-xs underline">Go to vault to add items</a>
              </div>
            } @else {
              <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                @for (item of collectionItems(); track item.id) {
                  <div class="group relative flex flex-col rounded-xl border border-border-chrome bg-card-dark p-3 hover:border-primary/50 transition-all">
                    <div class="relative mb-3 flex aspect-[4/5] items-center justify-center overflow-hidden rounded-lg bg-black">
                      <img
                        [src]="item.imageUrl"
                        [alt]="item.brand || 'Item'"
                        class="h-full w-full object-contain p-3"
                        style="mix-blend-mode: lighten"
                        loading="lazy"
                      />
                      @if (isOwner(col)) {
                        <button
                          class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 rounded bg-black/70 p-1 text-slate-400 hover:text-red-400 transition-all"
                          (click)="removeItemFromCollection(col, item.id)"
                          title="Remove from collection"
                        >
                          <span class="material-symbols-outlined" style="font-size:14px">close</span>
                        </button>
                      }
                    </div>
                    <p class="text-xs font-bold text-slate-100 truncate">{{ item.brand || item.category || '—' }}</p>
                    <p class="text-[10px] text-slate-500 font-mono">{{ item.wearCount }} wears</p>
                  </div>
                }
              </div>
            }

          } @else {
            <div class="flex flex-col items-center justify-center h-full text-slate-600">
              <span class="material-symbols-outlined mb-4" style="font-size:48px">folder_open</span>
              <p class="text-sm">Select a collection to view its items.</p>
            </div>
          }
        </main>

      </div>
    </div>

    <!-- Create collection modal -->
    @if (showCreateModal()) {
      <app-create-collection-modal
        (created)="onCollectionCreated($event)"
        (cancelled)="showCreateModal.set(false)"
      />
    }
  `,
})
export class CollectionsComponent implements OnInit {

  protected loading         = signal(true);
  protected activeCollection = signal<Collection | null>(null);
  protected showCreateModal  = signal(false);
  protected shareLabel       = signal('Copy Link');
  protected collectionItemsMap = signal<Record<string, ClothingItem[]>>({});

  private collectionService = inject(CollectionService);
  private wardrobeService   = inject(WardrobeService);
  private authService       = inject(AuthService);
  private route             = inject(ActivatedRoute);
  private router            = inject(Router);

  readonly collections = computed(() => this.collectionService.collections());

  readonly collectionItems = computed(() => {
    const col = this.activeCollection();
    if (!col) return [];
    return this.collectionItemsMap()[col.id] ?? [];
  });

  ngOnInit(): void {
    this.collectionService.loadAll().subscribe(() => {
      this.loading.set(false);
      // Handle ?join=collectionId share-link flow
      const joinId = this.route.snapshot.queryParamMap.get('join');
      if (joinId) {
        this.collectionService.join(joinId).subscribe({
          next: () => {
            this.collectionService.loadAll().subscribe(() => {
              const col = this.collections().find(c => c.id === joinId);
              if (col) this.selectCollection(col);
            });
            this.router.navigate([], { queryParams: {} });
          },
        });
      }
    });
  }

  selectCollection(col: Collection): void {
    this.activeCollection.set(col);
    if (!this.collectionItemsMap()[col.id] && col.clothingItemIds.length > 0) {
      this.loadItemsForCollection(col);
    }
  }

  isOwner(col: Collection): boolean {
    return col.ownerId === this.authService.user()?.userId;
  }

  copyShareLink(col: Collection): void {
    const url = `${window.location.origin}/collections?join=${col.id}`;
    navigator.clipboard.writeText(url).then(() => {
      this.shareLabel.set('Copied!');
      setTimeout(() => this.shareLabel.set('Copy Link'), 2000);
    });
  }

  deleteCollection(col: Collection): void {
    if (!confirm(`Delete "${col.name}"? This cannot be undone.`)) return;
    this.collectionService.delete(col.id).subscribe(() => {
      if (this.activeCollection()?.id === col.id) this.activeCollection.set(null);
    });
  }

  leaveCollection(col: Collection): void {
    if (!confirm(`Leave "${col.name}"?`)) return;
    this.collectionService.leave(col.id).subscribe(() => {
      if (this.activeCollection()?.id === col.id) this.activeCollection.set(null);
    });
  }

  removeItemFromCollection(col: Collection, itemId: string): void {
    this.collectionService.removeItem(col.id, itemId).subscribe(() => {
      this.collectionItemsMap.update(m => ({
        ...m,
        [col.id]: (m[col.id] ?? []).filter(i => i.id !== itemId),
      }));
    });
  }

  onCollectionCreated(col: Collection): void {
    this.showCreateModal.set(false);
    this.selectCollection(col);
  }

  private loadItemsForCollection(col: Collection): void {
    // Load all wardrobe items and filter by IDs in the collection.
    // Cosmos doesn't support multi-ID lookups without separate calls, so we fetch all
    // for the current user and filter client-side. Acceptable given small wardrobe sizes.
    this.wardrobeService.getAll({ pageSize: 200 }).subscribe(response => {
      const filtered = response.items.filter(i => col.clothingItemIds.includes(i.id));
      this.collectionItemsMap.update(m => ({ ...m, [col.id]: filtered }));
    });
  }
}
