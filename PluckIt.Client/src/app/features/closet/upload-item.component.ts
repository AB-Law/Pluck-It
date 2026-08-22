import { Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';

@Component({
  selector: 'app-upload-item',
  standalone: true,
  imports: [],
  template: `
    <div
      class="relative group rounded-xl border border-border-chrome/80 hover:border-primary hover:shadow-[0_0_20px_rgba(196,131,106,0.2)] transition-all duration-300 bg-card-dark/60 p-10 flex flex-col items-center justify-center gap-4 text-center cursor-pointer overflow-hidden"
      [class.border-primary]="dragging"
      (dragover)="onDragOver($event)"
      (dragleave)="dragging = false"
      (drop)="onDrop($event)"
      (click)="fileInput.click()"
    >
      <input
        #fileInput
        type="file"
        accept="image/*,.heic"
        multiple
        class="hidden"
        (change)="onFileChange($event)"
      />

      <!-- Scanning status badge -->
      <div class="absolute top-4 right-4 flex items-center gap-2 z-20">
        @if (uploading) {
          <div class="h-1.5 w-1.5 rounded-full bg-green-500 animate-blink"></div>
          <span class="text-[10px] text-green-500 tracking-wider">Processing images...</span>
        } @else {
          <div class="h-1.5 w-1.5 rounded-full bg-border-chrome"></div>
          <span class="text-[10px] text-slate-500 tracking-wider">Upload ready</span>
        }
      </div>

      <!-- Scan line (visible when uploading) -->
      @if (uploading) {
        <div class="absolute inset-x-0 h-0.5 bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)] z-10 animate-scan pointer-events-none"></div>
      }

      <!-- Dark overlay -->
      <div class="absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(196,131,106,0.1),transparent_45%)] z-0 pointer-events-none"></div>

      <!-- Icon -->
      <div class="bg-primary/20 p-4 rounded-full group-hover:bg-primary/30 transition-colors z-10 relative">
        <span class="material-symbols-outlined text-chrome" style="font-size:36px">cloud_upload</span>
      </div>

      <!-- Text -->
      <div class="z-10 relative">
        <p class="text-lg font-semibold text-chrome">Drop clothing images to scan</p>
        <p class="text-slate-text text-sm mt-1">Select multiple photos - AI removes backgrounds and tags attributes.</p>
      </div>

      <!-- Supported formats -->
      <div class="flex gap-2 mt-1 z-10 relative">
        @for (fmt of ['JPG', 'PNG', 'HEIC']; track fmt) {
          <span class="text-[10px] uppercase text-slate-500 bg-app-elevated border border-border-chrome px-2 py-1 rounded">{{ fmt }}</span>
        }
        <span class="text-[10px] uppercase text-slate-500 bg-app-elevated border border-border-chrome px-2 py-1 rounded">MULTI-SELECT</span>
      </div>
    </div>
  `,
})
export class UploadItemComponent {
  @Input() uploading = false;
  /** Emits an array of selected files (one or more). */
  @Output() fileSelected = new EventEmitter<File[]>();
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  dragging = false;

  openFilePicker(): void {
    this.fileInput.nativeElement.click();
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging = true;
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging = false;
    const files = Array.from(event.dataTransfer?.files ?? [])
      .filter(f => f.type.startsWith('image/') || f.name.toLowerCase().endsWith('.heic'));
    if (files.length > 0) this.fileSelected.emit(files);
  }

  onFileChange(event: Event): void {
    const files = Array.from((event.target as HTMLInputElement).files ?? []);
    if (files.length > 0) {
      this.fileSelected.emit(files);
      (event.target as HTMLInputElement).value = '';
    }
  }
}

