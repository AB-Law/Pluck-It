import { Component, input, output, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ClothingItem } from '../../core/models/clothing-item.model';
import { Collection } from '../../core/models/collection.model';
import { CollectionService } from '../../core/services/collection.service';
import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

@Component({
  selector: 'app-add-to-collection-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <!-- Backdrop -->
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      (click)="onBackdropClick($event)"
    >
      <div class="relative w-full max-w-md rounded-xl border border-border-chrome bg-black p-6 shadow-2xl mx-4">

        <!-- Header -->
        <div class="mb-6 flex items-center justify-between">
          <div>
            <h3 class="text-lg font-bold text-slate-100">Share to Collection</h3>
            <p class="text-xs text-slate-500 mt-0.5">
              Add <span class="text-primary font-mono">{{ item().brand || 'this item' }}</span> to a collection
            </p>
          </div>
          <button class="text-slate-500 hover:text-white transition-colors" (click)="closed.emit()">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>

        <!-- Collection list -->
        @if (loading()) {
          <div class="flex items-center justify-center py-8 text-slate-500 text-sm">
            <span class="material-symbols-outlined animate-spin mr-2" style="font-size:20px">progress_activity</span>
            Loading collections…
          </div>
        } @else if (collections().length === 0) {
          <div class="py-8 text-center text-slate-500 text-sm">
            <span class="material-symbols-outlined mb-2 block" style="font-size:36px">folder_off</span>
            You have no collections yet.
          </div>
        } @else {
          <div class="space-y-2 max-h-60 overflow-y-auto pr-1">
            @for (col of collections(); track col.id) {
              <label
                class="flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors"
                [class]="selectedIds().has(col.id) ? 'border-primary bg-primary/10' : 'border-border-chrome hover:border-slate-600'"
              >
                <input
                  type="checkbox"
                  class="accent-primary"
                  [checked]="selectedIds().has(col.id)"
                  (change)="toggleCollection(col.id)"
                />
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium text-slate-100 truncate">{{ col.name }}</p>
                  <p class="text-xs text-slate-500">{{ col.clothingItemIds.length }} items · {{ col.isPublic ? 'Public' : 'Private' }}</p>
                </div>
                @if (col.clothingItemIds.includes(item().id)) {
                  <span class="text-[10px] font-mono text-green-500">ADDED</span>
                }
              </label>
            }
          </div>
        }

        <!-- Actions -->
        @if (errorMessage()) {
          <p class="mt-4 rounded-md border border-red-800/60 bg-red-950/30 px-3 py-2 text-xs text-red-300">
            {{ errorMessage() }}
          </p>
        }
        <div class="mt-6 flex gap-3">
          <button
            class="flex-1 rounded-lg border border-border-chrome py-2.5 text-sm font-bold text-slate-300 hover:bg-card-dark transition-colors"
            (click)="closed.emit()"
          >
            Cancel
          </button>
          <button
            class="flex-1 rounded-lg bg-primary py-2.5 text-sm font-bold text-white hover:bg-blue-500 transition-colors disabled:opacity-50"
            [disabled]="saving() || selectedIds().size === 0"
            (click)="save()"
          >
            {{ saving() ? 'Saving…' : 'Confirm' }}
          </button>
        </div>

      </div>
    </div>
  `,
})
export class AddToCollectionModalComponent implements OnInit {
  item   = input.required<ClothingItem>();
  closed = output<void>();

  protected loading    = signal(true);
  protected saving     = signal(false);
  protected selectedIds = signal(new Set<string>());
  protected errorMessage = signal<string | null>(null);
  private collectionService = inject(CollectionService);

  readonly collections = computed(() => this.collectionService.collections());

  ngOnInit(): void {
    this.collectionService.loadAll().subscribe(() => this.loading.set(false));
  }

  toggleCollection(id: string): void {
    this.selectedIds.update(s => {
      const copy = new Set(s);
      copy.has(id) ? copy.delete(id) : copy.add(id);
      return copy;
    });
  }

  save(): void {
    if (this.saving()) return;
    this.saving.set(true);
    this.errorMessage.set(null);
    const ids = [...this.selectedIds()];
    if (ids.length === 0) {
      this.saving.set(false);
      this.closed.emit();
      return;
    }

    const calls = ids.map(id =>
      this.collectionService.addItem(id, this.item().id).pipe(
        map(() => ({ id, ok: true as const })),
        catchError(() => of({ id, ok: false as const }))
      )
    );

    forkJoin(calls).subscribe(results => {
      this.saving.set(false);
      const failed = results.filter(r => !r.ok);
      if (failed.length > 0) {
        this.errorMessage.set(`Failed to add item to ${failed.length} collection(s). Please retry.`);
        return;
      }
      this.closed.emit();
    });
  }

  onBackdropClick(e: MouseEvent): void {
    if (e.target === e.currentTarget) this.closed.emit();
  }
}
