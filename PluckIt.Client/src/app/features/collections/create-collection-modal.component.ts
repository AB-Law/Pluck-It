import { Component, output, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Collection } from '../../core/models/collection.model';
import { CollectionService } from '../../core/services/collection.service';

@Component({
  selector: 'app-create-collection-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      (click)="onBackdropClick($event)"
    >
      <div class="relative w-full max-w-md rounded-xl border border-border-chrome bg-black p-6 shadow-2xl mx-4">

        <!-- Header -->
        <div class="mb-6 flex items-center justify-between">
          <h3 class="text-lg font-bold text-slate-100">New Collection</h3>
          <button class="text-slate-500 hover:text-white transition-colors" (click)="cancelled.emit()">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>

        <!-- Form -->
        <div class="space-y-4">

          <!-- Name -->
          <div>
            <label class="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">
              Name <span class="text-red-500">*</span>
            </label>
            <input
              type="text"
              [(ngModel)]="name"
              placeholder="e.g. Summer '25 Capsule"
              maxlength="80"
              class="w-full bg-card-dark border border-[#1F1F1F] focus:border-primary focus:outline-none text-white font-mono h-11 px-4 text-sm transition-colors placeholder-slate-600 rounded-lg"
            />
          </div>

          <!-- Description -->
          <div>
            <label class="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">
              Description
            </label>
            <textarea
              [(ngModel)]="description"
              rows="3"
              placeholder="Optional description…"
              class="w-full bg-card-dark border border-[#1F1F1F] focus:border-primary focus:outline-none text-white font-mono px-4 py-3 text-sm transition-colors placeholder-slate-600 rounded-lg resize-none"
            ></textarea>
          </div>

          <!-- Visibility -->
          <div class="flex items-center justify-between rounded-lg border border-border-chrome bg-card-dark px-4 py-3">
            <div>
              <p class="text-sm font-medium text-slate-100">Public collection</p>
              <p class="text-xs text-slate-500">Anyone with a share link can join</p>
            </div>
            <button
              type="button"
              class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
              [class]="isPublic ? 'bg-primary' : 'bg-border-chrome'"
              (click)="isPublic = !isPublic"
            >
              <span
                class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
                [class]="isPublic ? 'translate-x-6' : 'translate-x-1'"
              ></span>
            </button>
          </div>

        </div>

        <!-- Error -->
        @if (error()) {
          <p class="mt-3 text-xs text-red-400">{{ error() }}</p>
        }

        <!-- Actions -->
        <div class="mt-6 flex gap-3">
          <button
            class="flex-1 rounded-lg border border-border-chrome py-2.5 text-sm font-bold text-slate-300 hover:bg-card-dark transition-colors"
            (click)="cancelled.emit()"
          >
            Cancel
          </button>
          <button
            class="flex-1 rounded-lg bg-primary py-2.5 text-sm font-bold text-white hover:bg-blue-500 transition-colors disabled:opacity-50"
            [disabled]="saving() || !name.trim()"
            (click)="save()"
          >
            {{ saving() ? 'Creating…' : 'Create Collection' }}
          </button>
        </div>

      </div>
    </div>
  `,
})
export class CreateCollectionModalComponent {
  created   = output<Collection>();
  cancelled = output<void>();

  name        = '';
  description = '';
  isPublic    = false;

  protected saving = signal(false);
  protected error  = signal<string | null>(null);

  private readonly collectionService = inject(CollectionService);

  save(): void {
    if (this.saving() || !this.name.trim()) return;
    this.error.set(null);
    this.saving.set(true);
    this.collectionService.create({
      name: this.name.trim(),
      description: this.description || null,
      isPublic: this.isPublic,
      clothingItemIds: [],
    }).subscribe({
      next: col => { this.saving.set(false); this.created.emit(col); },
      error: () => { this.saving.set(false); this.error.set('Failed to create collection. Please try again.'); },
    });
  }

  onBackdropClick(e: MouseEvent): void {
    if (e.target === e.currentTarget) this.cancelled.emit();
  }
}
