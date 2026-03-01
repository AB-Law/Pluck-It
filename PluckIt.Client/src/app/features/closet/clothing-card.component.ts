import { Component, Input } from '@angular/core';
import { ClothingItem } from '../../core/models/clothing-item.model';

@Component({
  selector: 'app-clothing-card',
  standalone: true,
  imports: [],
  template: `
    <div class="group bg-card-dark rounded-xl overflow-hidden hover:ring-1 hover:ring-primary/50 transition-all flex flex-col cursor-pointer">
      <!-- Image -->
      <div class="relative aspect-[4/5] bg-[#111] p-6 flex items-center justify-center overflow-hidden">
        <img
          [src]="item.imageUrl"
          [alt]="item.category ?? 'Clothing item'"
          class="object-contain h-full w-full drop-shadow-2xl group-hover:scale-105 transition-transform duration-500"
        />
        <button
          class="absolute top-3 right-3 p-2 bg-black/50 backdrop-blur rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
          (click)="$event.stopPropagation()"
        >
          <span class="material-symbols-outlined text-white" style="font-size:18px">more_horiz</span>
        </button>
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
}
