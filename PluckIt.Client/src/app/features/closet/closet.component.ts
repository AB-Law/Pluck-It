import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WardrobeService } from '../../core/services/wardrobe.service';
import { ClothingItem } from '../../core/models/clothing-item.model';
import { UploadItemComponent } from './upload-item.component';
import { ReviewItemModalComponent } from './review-item-modal.component';

@Component({
  selector: 'app-closet',
  standalone: true,
  imports: [CommonModule, UploadItemComponent, ReviewItemModalComponent],
  template: `
    <div class="closet-container">

      <div class="closet-header">
        <h2>Your Closet</h2>
        <p>{{ items.length }} item{{ items.length !== 1 ? 's' : '' }}</p>
      </div>

      <app-upload-item (fileSelected)="onFileSelected($event)" />

      <!-- Upload loading state -->
      <div class="upload-status" *ngIf="uploading">
        <div class="spinner"></div>
        <span>Processing image &amp; extracting metadata…</span>
      </div>
      <div class="upload-error" *ngIf="uploadError">
        ⚠️ {{ uploadError }}
        <button (click)="uploadError = null">Dismiss</button>
      </div>

      <!-- Items grid -->
      <div class="items-grid" *ngIf="items.length > 0">
        <div class="item-card" *ngFor="let item of items">
          <div class="item-image">
            <img [src]="item.imageUrl" [alt]="item.category ?? 'Clothing item'" loading="lazy" />
          </div>
          <div class="item-info">
            <p class="item-category">{{ item.category ?? 'Unknown' }}</p>
            <p class="item-brand" *ngIf="item.brand">{{ item.brand }}</p>
            <div class="item-footer">
              <span class="item-price" *ngIf="item.price">£{{ item.price | number:'1.2-2' }}</span>
              <div class="colour-dots">
                <span
                  class="colour-dot"
                  *ngFor="let colour of item.colours.slice(0, 3)"
                  [style.background]="colour.hex"
                  [title]="colour.name"
                ></span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="empty-state" *ngIf="!loading && items.length === 0">
        <p>Your closet is empty. Upload your first item above.</p>
      </div>
      <div class="loading-state" *ngIf="loading">
        <div class="spinner"></div>
      </div>

    </div>

    <!-- Review modal -->
    <app-review-item-modal
      *ngIf="draftItem"
      [item]="draftItem"
      (saved)="onItemSaved($event)"
      (cancelled)="draftItem = null"
    />
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
  items: ClothingItem[] = [];
  draftItem: ClothingItem | null = null;
  loading = false;
  uploading = false;
  uploadError: string | null = null;

  constructor(private wardrobe: WardrobeService) {}

  ngOnInit(): void {
    this.loadItems();
  }

  loadItems(): void {
    this.loading = true;
    this.wardrobe.getAll().subscribe({
      next: items => { this.items = items; this.loading = false; },
      error: () => { this.loading = false; }
    });
  }

  onFileSelected(file: File): void {
    this.uploading = true;
    this.uploadError = null;
    this.wardrobe.uploadForDraft(file).subscribe({
      next: draft => {
        this.uploading = false;
        this.draftItem = draft;
      },
      error: err => {
        this.uploading = false;
        this.uploadError = err?.error?.detail ?? err?.message ?? 'Upload failed. Please try again.';
      }
    });
  }

  onItemSaved(item: ClothingItem): void {
    this.wardrobe.save(item).subscribe({
      next: saved => {
        this.draftItem = null;
        this.items = [saved, ...this.items];
      },
      error: err => {
        this.uploadError = err?.error?.detail ?? err?.message ?? 'Save failed. Please try again.';
        this.draftItem = null;
      }
    });
  }
}

