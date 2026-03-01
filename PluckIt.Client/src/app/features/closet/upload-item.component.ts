import { Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';

@Component({
  selector: 'app-upload-item',
  standalone: true,
  imports: [],
  template: `
    <div
      class="relative group rounded-xl border-2 border-dashed border-[#333] hover:border-white hover:shadow-[0_0_15px_rgba(255,255,255,0.12)] transition-all duration-300 bg-card-dark/50 p-10 flex flex-col items-center justify-center gap-4 text-center cursor-pointer overflow-hidden"
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
        class="hidden"
        (change)="onFileChange($event)"
      />

      <!-- Scanning status badge -->
      <div class="absolute top-4 right-4 flex items-center gap-2 z-20">
        @if (uploading) {
          <div class="h-1.5 w-1.5 rounded-full bg-green-500 animate-blink"></div>
          <span class="text-[10px] font-mono text-green-500 tracking-wider">SYSTEM: SEGMENTING SILHOUETTE...</span>
        } @else {
          <div class="h-1.5 w-1.5 rounded-full bg-[#444]"></div>
          <span class="text-[10px] font-mono text-[#555] tracking-wider">SYSTEM: READY</span>
        }
      </div>

      <!-- Scan line (visible when uploading) -->
      @if (uploading) {
        <div class="absolute inset-x-0 h-0.5 bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)] z-10 animate-scan pointer-events-none"></div>
      }

      <!-- Dark overlay -->
      <div class="absolute inset-0 bg-black/30 z-0 pointer-events-none"></div>

      <!-- Icon -->
      <div class="bg-[#223649] p-4 rounded-full group-hover:bg-[#2e3f55] transition-colors z-10 relative">
        <span class="material-symbols-outlined text-white" style="font-size:36px">cloud_upload</span>
      </div>

      <!-- Text -->
      <div class="z-10 relative">
        <p class="text-lg font-semibold text-white">Drop clothing images to scan</p>
        <p class="text-slate-text text-sm mt-1">AI automatically removes backgrounds and tags attributes.</p>
      </div>

      <!-- Supported formats -->
      <div class="flex gap-2 mt-1 z-10 relative">
        @for (fmt of ['JPG', 'PNG', 'HEIC']; track fmt) {
          <span class="text-[10px] font-mono uppercase text-slate-500 bg-black/60 border border-[#333] px-2 py-1 rounded">{{ fmt }}</span>
        }
      </div>
    </div>
  `,
})
export class UploadItemComponent {
  @Input() uploading = false;
  @Output() fileSelected = new EventEmitter<File>();
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
    const file = event.dataTransfer?.files[0];
    if (file && file.type.startsWith('image/')) this.fileSelected.emit(file);
  }

  onFileChange(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) {
      this.fileSelected.emit(file);
      (event.target as HTMLInputElement).value = '';
    }
  }
}
