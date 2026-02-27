import { Component, ElementRef, EventEmitter, Output, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-upload-item',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      class="upload-zone"
      [class.dragging]="dragging"
      (dragover)="onDragOver($event)"
      (dragleave)="dragging = false"
      (drop)="onDrop($event)"
      (click)="fileInput.click()"
    >
      <input
        #fileInput
        type="file"
        accept="image/*"
        (change)="onFileChange($event)"
        style="display:none"
      />
      <div class="upload-icon">📷</div>
      <p class="upload-text">Drop a clothing photo here<br />or <span class="browse-link">click to browse</span></p>
    </div>
  `,
  styles: [`
    .upload-zone {
      border: 2px dashed #ccc;
      border-radius: 12px;
      padding: 2.5rem 2rem;
      text-align: center;
      cursor: pointer;
      transition: border-color 0.2s, background 0.2s;
      background: #fafafa;
      user-select: none;
    }
    .upload-zone:hover, .upload-zone.dragging {
      border-color: #555;
      background: #f0f0f0;
    }
    .upload-icon {
      font-size: 2.5rem;
      margin-bottom: 0.5rem;
    }
    .upload-text {
      color: #666;
      margin: 0;
      font-size: 0.9rem;
      line-height: 1.6;
    }
    .browse-link {
      color: #333;
      font-weight: 600;
      text-decoration: underline;
    }
  `]
})
export class UploadItemComponent {
  @Output() fileSelected = new EventEmitter<File>();
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  dragging = false;

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging = true;
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging = false;
    const file = event.dataTransfer?.files[0];
    if (file && file.type.startsWith('image/')) this.fileSelected.emit(file);
  }

  onFileChange(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) {
      this.fileSelected.emit(file);
      // Reset so same file can be re-uploaded
      (event.target as HTMLInputElement).value = '';
    }
  }
}
