import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnInit,
  Output,
  SimpleChanges,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ClothingColour, ClothingItem } from '../../core/models/clothing-item.model';

@Component({
  selector: 'app-review-item-modal',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      (click)="onOverlayClick($event)"
    >
      <div
        class="bg-card-dark border border-border-subtle rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto custom-scrollbar shadow-2xl"
        role="dialog" aria-modal="true" aria-labelledby="modal-title"
        (click)="$event.stopPropagation()"
      >
        <!-- Header -->
        <div class="flex items-center justify-between px-6 py-4 border-b border-border-subtle sticky top-0 bg-card-dark z-10">
          <h2 id="modal-title" class="text-white font-semibold text-lg">Review Item</h2>
          <button
            class="p-2 text-slate-text hover:text-white hover:bg-[#333] rounded-lg transition-colors"
            (click)="cancelled.emit()" aria-label="Close"
          >
            <span class="material-symbols-outlined" style="font-size:20px">close</span>
          </button>
        </div>

        @if (draft) {
          <div class="flex flex-col md:flex-row gap-6 p-6">
            <!-- Image -->
            <div class="md:w-44 shrink-0">
              <div class="aspect-[3/4] bg-[#111] rounded-xl overflow-hidden flex items-center justify-center">
                <img [src]="draft.imageUrl" alt="Clothing item" class="object-contain h-full w-full" />
              </div>
            </div>

            <!-- Fields -->
            <div class="flex-1 flex flex-col gap-4">
              <div class="grid grid-cols-2 gap-3">
                <div class="flex flex-col gap-1.5">
                  <label class="text-[10px] font-medium text-slate-text uppercase tracking-wider">Brand</label>
                  <input type="text" [(ngModel)]="draft.brand" placeholder="e.g. Nike, Zara"
                    class="bg-[#111] border border-[#333] text-white rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-primary focus:border-primary placeholder-slate-500 outline-none" />
                </div>
                <div class="flex flex-col gap-1.5">
                  <label class="text-[10px] font-medium text-slate-text uppercase tracking-wider">Category</label>
                  <input type="text" [(ngModel)]="draft.category" placeholder="e.g. T-Shirt, Jeans"
                    class="bg-[#111] border border-[#333] text-white rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-primary focus:border-primary placeholder-slate-500 outline-none" />
                </div>
              </div>

              <div class="flex flex-col gap-1.5">
                <label class="text-[10px] font-medium text-slate-text uppercase tracking-wider">Tags</label>
                <div class="bg-[#111] border border-[#333] rounded-lg p-2 flex flex-wrap gap-1.5 min-h-[40px]">
                  @for (tag of draft.tags; track tag; let i = $index) {
                    <span class="flex items-center gap-1 px-2 py-0.5 bg-primary/10 text-primary border border-primary/20 rounded text-xs font-mono">
                      {{ tag }}
                      <button type="button" class="text-primary/60 hover:text-primary" (click)="removeTag(i)">&times;</button>
                    </span>
                  }
                  <input type="text" [(ngModel)]="newTag" placeholder="Add tag…"
                    class="bg-transparent text-white text-sm placeholder-slate-500 outline-none min-w-[80px] py-0.5 px-1"
                    (keydown.enter)="$event.preventDefault(); addTag()"
                    (keydown.comma)="addTagFromComma($event)" />
                </div>
              </div>

              <div class="flex flex-col gap-1.5">
                <div class="flex items-center justify-between">
                  <label class="text-[10px] font-medium text-slate-text uppercase tracking-wider">Colours</label>
                  <button type="button" class="text-xs text-primary hover:text-blue-400 font-medium" (click)="addColour()">+ Add</button>
                </div>
                <div class="flex flex-col gap-2">
                  @for (colour of draft.colours; track $index; let i = $index) {
                    <div class="flex items-center gap-2">
                      <span class="w-5 h-5 rounded-full border border-[#444] shrink-0" [style.background]="colour.hex"></span>
                      <input type="text" [(ngModel)]="colour.name" placeholder="Name"
                        class="flex-1 bg-[#111] border border-[#333] text-white rounded-lg px-3 py-1.5 text-sm outline-none placeholder-slate-500 focus:ring-1 focus:ring-primary" />
                      <input type="color" [(ngModel)]="colour.hex" class="w-8 h-8 rounded cursor-pointer bg-transparent border-0" [title]="colour.hex" />
                      <button type="button" class="text-slate-text hover:text-red-400" (click)="removeColour(i)">
                        <span class="material-symbols-outlined" style="font-size:18px">delete</span>
                      </button>
                    </div>
                  }
                </div>
              </div>

              <div class="flex flex-col gap-1.5">
                <label class="text-[10px] font-medium text-slate-text uppercase tracking-wider">Notes (optional)</label>
                <textarea [(ngModel)]="draft.notes" placeholder="Any additional notes…" rows="2"
                  class="bg-[#111] border border-[#333] text-white rounded-lg px-3 py-2 text-sm outline-none resize-none placeholder-slate-500 focus:ring-1 focus:ring-primary"></textarea>
              </div>
            </div>
          </div>

          <div class="flex justify-end gap-3 px-6 py-4 border-t border-border-subtle">
            <button type="button" class="px-5 py-2 rounded-lg border border-[#333] text-slate-text hover:text-white text-sm font-medium transition-colors" (click)="cancelled.emit()">Cancel</button>
            <button type="button" class="px-5 py-2 rounded-lg bg-primary hover:bg-blue-500 text-white text-sm font-semibold transition-colors" (click)="onSave()">Save to Wardrobe</button>
          </div>
        }
      </div>
    </div>
  `,
})
export class ReviewItemModalComponent implements OnChanges, OnInit {
  @Input() item: ClothingItem | null = null;
  @Output() saved = new EventEmitter<ClothingItem>();
  @Output() cancelled = new EventEmitter<void>();

  draft: ClothingItem | null = null;
  newTag = '';

  ngOnInit(): void {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['item'] && this.item) {
      this.draft = {
        ...this.item,
        tags: [...(this.item.tags ?? [])],
        colours: (this.item.colours ?? []).map(c => ({ ...c })),
      };
    }
  }

  addTag(): void {
    const tag = this.newTag.trim();
    if (tag && this.draft && !this.draft.tags.includes(tag)) {
      this.draft.tags = [...this.draft.tags, tag];
    }
    this.newTag = '';
  }

  addTagFromComma(event: Event): void {
    event.preventDefault();
    this.addTag();
  }

  removeTag(index: number): void {
    if (this.draft) {
      this.draft.tags = this.draft.tags.filter((_, i) => i !== index);
    }
  }

  addColour(): void {
    if (this.draft) {
      this.draft.colours = [...this.draft.colours, { name: '', hex: '#cccccc' }];
    }
  }

  removeColour(index: number): void {
    if (this.draft) {
      this.draft.colours = this.draft.colours.filter((_, i) => i !== index);
    }
  }

  onSave(): void {
    if (this.draft) {
      this.saved.emit({ ...this.draft });
    }
  }

  onOverlayClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('backdrop-blur-sm')) {
      this.cancelled.emit();
    }
  }
}
