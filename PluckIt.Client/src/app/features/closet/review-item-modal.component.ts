import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ClothingColour, ClothingItem } from '../../core/models/clothing-item.model';

@Component({
  selector: 'app-review-item-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="overlay" (click)="onOverlayClick($event)">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">

        <div class="modal-header">
          <h2 id="modal-title">Review Item</h2>
          <button class="close-btn" (click)="cancelled.emit()" aria-label="Close">✕</button>
        </div>

        <div class="modal-body" *ngIf="draft">

          <!-- Image preview -->
          <div class="image-preview">
            <img [src]="draft.imageUrl" alt="Clothing item" />
          </div>

          <!-- Fields -->
          <div class="fields">

            <div class="field-row">
              <div class="field">
                <label>Brand</label>
                <input type="text" [(ngModel)]="draft.brand" placeholder="e.g. Nike, Zara (optional)" />
              </div>
              <div class="field">
                <label>Category</label>
                <input type="text" [(ngModel)]="draft.category" placeholder="e.g. T-Shirt, Jeans" />
              </div>
            </div>

            <div class="field">
              <label>Price <span class="required">*</span></label>
              <div class="price-input">
                <span class="currency">£</span>
                <input
                  type="number"
                  [(ngModel)]="draft.price"
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                />
              </div>
            </div>

            <!-- Tags -->
            <div class="field">
              <label>Tags</label>
              <div class="chip-container">
                <span class="chip" *ngFor="let tag of draft.tags; let i = index">
                  {{ tag }}
                  <button class="chip-remove" (click)="removeTag(i)" aria-label="Remove tag">×</button>
                </span>
                <input
                  class="chip-input"
                  type="text"
                  [(ngModel)]="newTag"
                  placeholder="Add tag..."
                  (keydown.enter)="addTag()"
                  (keydown.comma)="addTagFromComma($event)"
                />
              </div>
            </div>

            <!-- Colours -->
            <div class="field">
              <label>Colours</label>
              <div class="colours-list">
                <div class="colour-row" *ngFor="let colour of draft.colours; let i = index">
                  <span class="colour-swatch" [style.background]="colour.hex"></span>
                  <input type="text" [(ngModel)]="colour.name" class="colour-name" placeholder="Colour name" />
                  <input type="color" [(ngModel)]="colour.hex" class="colour-picker" [title]="colour.hex" />
                  <button class="chip-remove" (click)="removeColour(i)" aria-label="Remove colour">×</button>
                </div>
                <button class="add-colour-btn" (click)="addColour()">+ Add colour</button>
              </div>
            </div>

            <div class="field">
              <label>Notes</label>
              <textarea [(ngModel)]="draft.notes" placeholder="Any notes about this item..." rows="2"></textarea>
            </div>

          </div>
        </div>

        <div class="modal-footer">
          <button class="btn-secondary" (click)="cancelled.emit()">Cancel</button>
          <button
            class="btn-primary"
            (click)="onSave()"
            [disabled]="!draft?.price || draft?.price! <= 0"
          >Save to Wardrobe</button>
        </div>

      </div>
    </div>
  `,
  styles: [`
    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      padding: 1rem;
    }
    .modal {
      background: #fff;
      border-radius: 16px;
      width: 100%;
      max-width: 680px;
      max-height: 90vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    .modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1.25rem 1.5rem;
      border-bottom: 1px solid #eee;
    }
    .modal-header h2 {
      margin: 0;
      font-size: 1.1rem;
      font-weight: 600;
    }
    .close-btn {
      background: none;
      border: none;
      font-size: 1.1rem;
      cursor: pointer;
      color: #666;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
    }
    .close-btn:hover { background: #f0f0f0; }
    .modal-body {
      display: flex;
      gap: 1.5rem;
      padding: 1.5rem;
      overflow-y: auto;
      flex: 1;
    }
    .image-preview {
      width: 180px;
      flex-shrink: 0;
      border-radius: 12px;
      overflow: hidden;
      background: #f5f5f5;
      display: flex;
      align-items: flex-start;
      justify-content: center;
    }
    .image-preview img {
      width: 100%;
      object-fit: contain;
    }
    .fields {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .field-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }
    label {
      font-size: 0.8rem;
      font-weight: 600;
      color: #444;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .required { color: #c00; }
    input[type=text], input[type=number], textarea {
      border: 1px solid #ddd;
      border-radius: 8px;
      padding: 0.5rem 0.75rem;
      font-size: 0.9rem;
      outline: none;
      transition: border-color 0.15s;
      font-family: inherit;
    }
    input[type=text]:focus, input[type=number]:focus, textarea:focus {
      border-color: #888;
    }
    textarea { resize: vertical; }
    .price-input {
      display: flex;
      align-items: center;
      border: 1px solid #ddd;
      border-radius: 8px;
      overflow: hidden;
      transition: border-color 0.15s;
    }
    .price-input:focus-within { border-color: #888; }
    .currency {
      padding: 0.5rem 0.6rem;
      background: #f5f5f5;
      font-size: 0.9rem;
      color: #555;
      border-right: 1px solid #ddd;
    }
    .price-input input {
      border: none;
      flex: 1;
      padding: 0.5rem 0.75rem;
      font-size: 0.9rem;
      outline: none;
    }
    /* Tags / chips */
    .chip-container {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      border: 1px solid #ddd;
      border-radius: 8px;
      padding: 0.4rem 0.6rem;
      min-height: 2.5rem;
      align-items: center;
    }
    .chip {
      background: #f0f0f0;
      border-radius: 20px;
      padding: 0.2rem 0.6rem;
      font-size: 0.8rem;
      display: flex;
      align-items: center;
      gap: 0.3rem;
    }
    .chip-remove {
      background: none;
      border: none;
      font-size: 1rem;
      line-height: 1;
      cursor: pointer;
      color: #888;
      padding: 0;
    }
    .chip-remove:hover { color: #333; }
    .chip-input {
      border: none !important;
      padding: 0.2rem 0.4rem !important;
      font-size: 0.85rem;
      outline: none;
      min-width: 80px;
      flex: 1;
    }
    /* Colours */
    .colours-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .colour-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .colour-swatch {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      border: 1px solid #ccc;
      flex-shrink: 0;
    }
    .colour-name {
      flex: 1;
    }
    .colour-picker {
      width: 36px;
      height: 30px;
      padding: 2px;
      border: 1px solid #ddd;
      border-radius: 6px;
      cursor: pointer;
    }
    .add-colour-btn {
      background: none;
      border: 1px dashed #bbb;
      border-radius: 8px;
      padding: 0.35rem 0.75rem;
      font-size: 0.8rem;
      color: #666;
      cursor: pointer;
      text-align: left;
    }
    .add-colour-btn:hover { border-color: #888; color: #333; }
    /* Footer */
    .modal-footer {
      display: flex;
      justify-content: flex-end;
      gap: 0.75rem;
      padding: 1rem 1.5rem;
      border-top: 1px solid #eee;
    }
    .btn-primary, .btn-secondary {
      padding: 0.6rem 1.4rem;
      border-radius: 8px;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      border: none;
      transition: opacity 0.15s, background 0.15s;
    }
    .btn-primary {
      background: #111;
      color: #fff;
    }
    .btn-primary:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .btn-primary:not(:disabled):hover { background: #333; }
    .btn-secondary {
      background: #f0f0f0;
      color: #333;
    }
    .btn-secondary:hover { background: #e0e0e0; }
  `]
})
export class ReviewItemModalComponent implements OnChanges {
  @Input() item: ClothingItem | null = null;
  @Output() saved = new EventEmitter<ClothingItem>();
  @Output() cancelled = new EventEmitter<void>();

  draft: ClothingItem | null = null;
  newTag = '';

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['item'] && this.item) {
      // Deep copy so edits don't mutate the original until confirmed
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
    if (this.draft && this.draft.price && this.draft.price > 0) {
      this.saved.emit({ ...this.draft });
    }
  }

  onOverlayClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('overlay')) {
      this.cancelled.emit();
    }
  }
}
