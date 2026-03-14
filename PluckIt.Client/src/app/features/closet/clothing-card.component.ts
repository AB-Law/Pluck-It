import { Component, EventEmitter, Input, Output, input, signal } from '@angular/core';
import { ClothingItem } from '../../core/models/clothing-item.model';

@Component({
  selector: 'app-clothing-card',
  standalone: true,
  imports: [],
  template: `
    <div
      class="group relative bg-card-dark rounded-xl overflow-hidden transition-all flex flex-col cursor-grab active:cursor-grabbing"
      [class.ring-2]="selected"
      [class.ring-primary]="selected"
      [class.hover:ring-1]="!selected"
      [class.hover:ring-primary]="!selected"
      [class.hover:ring-opacity-50]="!selected"
      draggable="true"
      (dragstart)="onDragStart($event)"
    >
      <!-- Image -->
      <div class="relative aspect-[4/5] bg-[#111] p-6 flex items-center justify-center overflow-hidden">
        <img
          [src]="item.imageUrl"
          [alt]="item.category ?? 'Clothing item'"
          class="object-contain h-full w-full drop-shadow-2xl group-hover:scale-105 transition-transform duration-500"
          [attr.loading]="priority() ? 'eager' : 'lazy'"
          [attr.fetchpriority]="priority() ? 'high' : 'auto'"
        />

        <!-- Selected checkmark -->
        @if (selected) {
          <div class="absolute top-3 left-3 h-6 w-6 rounded-full bg-primary flex items-center justify-center shadow-md">
            <span class="material-symbols-outlined text-white" style="font-size:16px">check</span>
          </div>
        }

        <!-- Add-to-styling button (hover) -->
        <button
          class="absolute top-3 left-3 h-6 w-6 rounded-full bg-black/60 backdrop-blur flex items-center justify-center transition-opacity"
          [class.opacity-0]="selected"
          [class.group-hover:opacity-100]="!selected"
          [class.opacity-0]="!selected"
          (click)="onToggleSelect($event)"
          [attr.aria-label]="selected ? 'Remove from styling' : 'Add to styling'"
          title="Add to styling"
        >
          <span class="material-symbols-outlined text-white" style="font-size:14px">add</span>
        </button>

        <button
          class="absolute top-3 right-3 p-2 bg-black/50 backdrop-blur rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
          (click)="toggleMenu($event)"
          aria-label="Item options"
        >
          <span class="material-symbols-outlined text-white" style="font-size:18px">more_horiz</span>
        </button>

        <!-- Dropdown menu -->
        @if (menuOpen()) {
          <div
            class="absolute top-12 right-3 z-20 bg-[#111] border border-[#2a2a2a] shadow-xl min-w-[120px] py-1"
            (click)="$event.stopPropagation()"
          >
            <button
              type="button"
              class="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-slate-300 hover:text-white hover:bg-[#1F1F1F] transition-colors font-mono"
              (click)="onEdit()"
            >
              <span class="material-symbols-outlined" style="font-size:16px">edit</span>
              Edit
            </button>
            <button
              type="button"
              class="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-red-400 hover:text-red-300 hover:bg-[#1F1F1F] transition-colors font-mono"
              (click)="onDelete()"
            >
              <span class="material-symbols-outlined" style="font-size:16px">delete</span>
              Delete
            </button>
          </div>
        }
      </div>

      <!-- Info -->
      <div class="p-4 border-t border-border-subtle flex flex-col gap-2">
        <div class="flex justify-between items-start gap-2">
          <h3 class="text-chrome font-medium truncate text-sm leading-tight">
            {{ item.category ?? 'Unknown' }}
          </h3>
          @if (item.brand) {
            <span class="text-[11px] font-mono text-slate-400 shrink-0">{{ item.brand }}</span>
          }
        </div>

        @if (item.size) {
          <div class="text-[10px] font-mono text-slate-500">
            @if (item.size.letter) { SIZE: {{ item.size.letter }}{{ item.size.system ? ' (' + item.size.system + ')' : '' }} }
            @else if (item.size.waist && item.size.inseam) { {{ item.size.waist }}×{{ item.size.inseam }} }
            @else if (item.size.shoeSize) { EU {{ item.size.shoeSize }} }
          </div>
        }

        @if (item.tags.length > 0) {
          <div class="flex flex-wrap gap-1.5">
            @for (tag of item.tags.slice(0, 3); track tag; let i = $index) {
              <span
                [class]="i === 0
                  ? 'px-2 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-mono border border-primary/20 uppercase tracking-wide'
                  : 'px-2 py-0.5 rounded bg-[#2a2a2a] text-slate-300 text-[10px] font-mono uppercase tracking-wide'"
              >{{ tag }}</span>
            }
          </div>
        }

        @if (item.colours.length > 0) {
          <div class="flex gap-1.5">
            @for (c of item.colours.slice(0, 6); track c.hex) {
              <span
                class="w-3 h-3 rounded-full border border-[#444] shrink-0"
                [style.background]="c.hex"
                [title]="c.name"
              ></span>
            }
          </div>
        }
      </div>
    </div>
  `,
})
export class ClothingCardComponent {
  @Input({ required: true }) item!: ClothingItem;
  @Input() selected = false;
  readonly priority = input<boolean>(false);
  @Output() editRequested   = new EventEmitter<ClothingItem>();
  @Output() deleteRequested = new EventEmitter<ClothingItem>();
  @Output() selectToggled   = new EventEmitter<string>();

  readonly menuOpen = signal(false);

  onDragStart(event: DragEvent): void {
    event.dataTransfer?.setData('text/plain', this.item.id);
    event.dataTransfer?.setData('application/pluckit-item', this.item.id);
  }

  onToggleSelect(event: MouseEvent): void {
    event.stopPropagation();
    this.selectToggled.emit(this.item.id);
  }

  toggleMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.menuOpen.update(v => !v);
  }

  onEdit(): void {
    this.menuOpen.set(false);
    this.editRequested.emit(this.item);
  }

  onDelete(): void {
    this.menuOpen.set(false);
    this.deleteRequested.emit(this.item);
  }
}
