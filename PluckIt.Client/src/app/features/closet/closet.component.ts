import { Component, OnInit, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { WardrobeService } from '../../core/services/wardrobe.service';
import { ClothingItem } from '../../core/models/clothing-item.model';
import { UploadItemComponent } from './upload-item.component';
import { ReviewItemModalComponent } from './review-item-modal.component';

@Component({
  selector: 'app-closet',
  standalone: true,
  imports: [DecimalPipe, UploadItemComponent, ReviewItemModalComponent],
  template: `
    <div class="closet-container">

      <div class="closet-header">
        <h2>Your Closet</h2>
        <p>{{ items().length }} item{{ items().length !== 1 ? 's' : '' }}</p>
      </div>

      <app-upload-item (fileSelected)="onFileSelected($event)" />

      <!-- Upload loading state -->
      @if (uploading()) {
        <div class="upload-status">
          <div class="spinner"></div>
          <span>Processing image &amp; extracting metadata…</span>
        </div>
      }
      @if (uploadError()) {
        <div class="upload-error">
          ⚠️ {{ uploadError() }}
          <button (click)="uploadError.set(null)">Dismiss</button>
        </div>
      }

      <!-- Items grid -->
      @if (items().length > 0) {
        <div class="items-grid">
          @for (item of items(); track item.id) {
            <div class="item-card">
              <div class="item-image">
                <img [src]="item.imageUrl" [alt]="item.category ?? 'Clothing item'" loading="lazy" />
              </div>
              <div class="item-info">
                <p class="item-category">{{ item.category ?? 'Unknown' }}</p>
                @if (item.brand) {
                  <p class="item-brand">{{ item.brand }}</p>
                }
                <div class="item-footer">
                  @if (item.price) {
                    <span class="item-price">£{{ item.price | number:'1.2-2' }}</span>
                  }
                  <div class="colour-dots">
                    @for (colour of item.colours.slice(0, 3); track colour.hex) {
                      <span
                        class="colour-dot"
                        [style.background]="colour.hex"
                        [title]="colour.name"
                      ></span>
                    }
                  </div>
                </div>
              </div>
            </div>
          }
        </div>
      }

      @if (!loading() && items().length === 0) {
        <div class="empty-state">
          <p>Your closet is empty. Upload your first item above.</p>
        </div>
      }
      @if (loading()) {
        <div class="loading-state">
          <div class="spinner"></div>
        </div>
      }

    </div>

    <!-- Review modal -->
    @if (draftItem()) {
      <app-review-item-modal
        [item]="draftItem()"
        (saved)="onItemSaved($event)"
        (cancelled)="draftItem.set(null)"
      />
    }
  `,
  styles: [`
    .closet-container {
      padding: 2rem;
      max-width: 1100px;
      margin: 0 auto;
    }
    .closet-header {
      display: flex;
      align-items: baseline;
      gap: 1rem;
      margin-bottom: 1.5rem;
    }
    .closet-header h2 { margin: 0; }
    .closet-header p { margin: 0; color: #888; font-size: 0.9rem; }

    app-upload-item { display: block; margin-bottom: 1rem; }

    .upload-status {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem 1rem;
      background: #f5f5f5;
      border-radius: 8px;
      font-size: 0.9rem;
      color: #555;
      margin-bottom: 1rem;
    }
    .upload-error {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem 1rem;
      background: #fff3f3;
      border: 1px solid #f5c6c6;
      border-radius: 8px;
      font-size: 0.9rem;
      color: #c00;
      margin-bottom: 1rem;
    }
    .upload-error button {
      margin-left: auto;
      background: none;
      border: none;
      color: #c00;
      cursor: pointer;
      font-size: 0.8rem;
      text-decoration: underline;
      padding: 0;
    }

    .items-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: 1.25rem;
      margin-top: 1.5rem;
    }
    .item-card {
      border: 1px solid #e8e8e8;
      border-radius: 12px;
      overflow: hidden;
      transition: box-shadow 0.2s, transform 0.15s;
      cursor: pointer;
      background: #fff;
    }
    .item-card:hover {
      box-shadow: 0 4px 16px rgba(0,0,0,0.1);
      transform: translateY(-2px);
    }
    .item-image {
      aspect-ratio: 3/4;
      background: #f5f5f5;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .item-image img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .item-info {
      padding: 0.65rem 0.75rem 0.75rem;
    }
    .item-category {
      font-size: 0.85rem;
      font-weight: 600;
      margin: 0 0 0.15rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .item-brand {
      font-size: 0.75rem;
      color: #888;
      margin: 0 0 0.4rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .item-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .item-price {
      font-size: 0.85rem;
      font-weight: 700;
      color: #111;
    }
    .colour-dots {
      display: flex;
      gap: 3px;
    }
    .colour-dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      border: 1px solid #ddd;
    }

    .empty-state, .loading-state {
      text-align: center;
      padding: 3rem;
      color: #aaa;
    }
    .spinner {
      width: 20px;
      height: 20px;
      border: 2px solid #ddd;
      border-top-color: #555;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
    }
    .loading-state .spinner {
      width: 32px;
      height: 32px;
      margin: 0 auto;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  `]
})
export class ClosetComponent implements OnInit {
  items = signal<ClothingItem[]>([]);
  draftItem = signal<ClothingItem | null>(null);
  loading = signal(false);
  uploading = signal(false);
  uploadError = signal<string | null>(null);

  constructor(private wardrobe: WardrobeService) {}

  ngOnInit(): void {
    this.loadItems();
  }

  loadItems(): void {
    this.loading.set(true);
    this.wardrobe.getAll().subscribe({
      next: items => { this.items.set(items); this.loading.set(false); },
      error: () => { this.loading.set(false); }
    });
  }

  onFileSelected(file: File): void {
    console.log('[Closet] onFileSelected', file.name);
    this.uploading.set(true);
    this.uploadError.set(null);
    this.wardrobe.uploadForDraft(file).subscribe({
      next: draft => {
        console.log('[Closet] uploadForDraft success, draft:', draft);
        this.uploading.set(false);
        this.draftItem.set(draft);
        console.log('[Closet] draftItem set:', this.draftItem());
      },
      error: err => {
        console.error('[Closet] uploadForDraft error:', err);
        this.uploading.set(false);
        this.uploadError.set(err?.error?.detail ?? err?.message ?? 'Upload failed. Please try again.');
      }
    });
  }

  onItemSaved(item: ClothingItem): void {
    this.wardrobe.save(item).subscribe({
      next: saved => {
        this.draftItem.set(null);
        this.items.update(current => [saved, ...current]);
      },
      error: err => {
        this.uploadError.set(err?.error?.detail ?? err?.message ?? 'Save failed. Please try again.');
        this.draftItem.set(null);
      }
    });
  }
}

