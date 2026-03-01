import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ClothingItem } from '../../core/models/clothing-item.model';

interface CareOption {
  key: string;
  icon: string;
  label: string;
}

const CARE_OPTIONS: CareOption[] = [
  { key: 'dry_clean', icon: 'dry_cleaning',          label: 'DRY'    },
  { key: 'wash',      icon: 'local_laundry_service',  label: 'WASH'   },
  { key: 'iron',      icon: 'iron',                  label: 'IRON'   },
  { key: 'bleach',    icon: 'water',                 label: 'BLEACH' },
];

const CONDITIONS = ['New', 'Excellent', 'Good', 'Fair'];

const CATEGORIES = [
  'Tops', 'Bottoms', 'Outerwear', 'Footwear',
  'Accessories', 'Knitwear', 'Dresses', 'Activewear',
  'Swimwear', 'Underwear',
];

@Component({
  selector: 'app-review-item-modal',
  standalone: true,
  imports: [FormsModule],
  styles: [`
    @keyframes modal-zoom-in {
      from { opacity: 0; transform: scale(0.92); }
      to   { opacity: 1; transform: scale(1); }
    }
    @keyframes backdrop-fadein {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    .modal-animate {
      animation: modal-zoom-in 0.22s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
    }
    .backdrop-animate {
      animation: backdrop-fadein 0.18s ease forwards;
    }
    .modal-scroll::-webkit-scrollbar { width: 4px; }
    .modal-scroll::-webkit-scrollbar-track { background: transparent; }
    .modal-scroll::-webkit-scrollbar-thumb { background: #258df4; }
    .modal-scroll { scrollbar-width: thin; scrollbar-color: #258df4 transparent; }
    input[type="date"]::-webkit-calendar-picker-indicator {
      filter: invert(1) opacity(0.35);
      cursor: pointer;
    }
    /* Remove number input spinners */
    input[type="number"]::-webkit-outer-spin-button,
    input[type="number"]::-webkit-inner-spin-button { -webkit-appearance: none; }
    input[type="number"] { -moz-appearance: textfield; }
  `],
  template: `
    <!-- ── Backdrop ───────────────────────────────────────────────────────── -->
    <div
      class="backdrop-animate fixed inset-0 z-50 flex items-center justify-center p-4"
      style="background: rgba(0,0,0,0.82); backdrop-filter: blur(8px);"
      (click)="onOverlayClick($event)"
    >
      <!-- ── Modal shell ────────────────────────────────────────────────── -->
      <div
        class="modal-animate w-full max-w-4xl bg-black border border-[#1F1F1F] shadow-2xl flex flex-col max-h-[90vh]"
        role="dialog" aria-modal="true" aria-labelledby="enrich-modal-title"
        (click)="$event.stopPropagation()"
      >

        <!-- Header -->
        @if (draft) {
          <div class="flex items-center justify-between p-6 border-b border-[#1F1F1F] shrink-0">
            <div class="flex items-center gap-4">
              <!-- Thumbnail -->
              <div class="w-12 h-12 bg-[#0d0d0d] border border-[#1F1F1F] flex items-center justify-center overflow-hidden shrink-0">
                <img [src]="draft.imageUrl" alt="Item preview"
                     class="w-full h-full object-contain opacity-85" />
              </div>
              <div>
                <h1 id="enrich-modal-title"
                    class="text-xl font-bold tracking-tight uppercase text-white">
                  Enrich Your Item
                </h1>
                <p class="text-xs text-slate-500 font-mono mt-0.5">
                  ID: {{ draft.id.slice(0, 8).toUpperCase() }}
                </p>
              </div>
            </div>
            <button
              class="text-slate-500 hover:text-white transition-colors"
              (click)="cancelled.emit()" aria-label="Close"
            >
              <span class="material-symbols-outlined">close</span>
            </button>
          </div>
        }

        <!-- Body -->
        @if (draft) {
          <div class="flex-1 overflow-y-auto modal-scroll px-8 py-7">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">

              <!-- ══ Left column ════════════════════════════════════════════ -->
              <div class="space-y-7">

                <!-- Brand -->
                <div>
                  <label class="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">
                    Brand
                  </label>
                  <div class="relative">
                    <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"
                          style="font-size:18px">search</span>
                    <input
                      list="enrich-brand-list"
                      type="text"
                      [(ngModel)]="draft.brand"
                      placeholder="Search or add brand…"
                      class="w-full bg-transparent border border-[#1F1F1F] focus:border-primary focus:outline-none text-white font-mono h-12 pl-10 pr-4 text-sm transition-colors placeholder-slate-600"
                    />
                  </div>
                  <datalist id="enrich-brand-list">
                    @for (brand of knownBrands; track brand) {
                      <option [value]="brand"></option>
                    }
                  </datalist>
                </div>

                <!-- Price -->
                <div>
                  <label class="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">
                    Price
                  </label>
                  <div class="flex">
                    <div class="bg-[#1F1F1F] text-slate-300 font-mono h-12 px-4 flex items-center border border-[#1F1F1F] text-sm shrink-0 select-none">
                      {{ currency }}
                    </div>
                    <input
                      type="number"
                      [(ngModel)]="draft.price"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      class="flex-1 bg-transparent border border-[#1F1F1F] border-l-0 focus:border-primary focus:outline-none text-white font-mono h-12 px-4 text-sm transition-colors placeholder-slate-600"
                    />
                  </div>
                </div>

                <!-- Purchase Date -->
                <div>
                  <label class="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">
                    Purchase Date
                  </label>
                  <div class="relative">
                    <input
                      type="date"
                      [(ngModel)]="draft.purchaseDate"
                      class="w-full bg-transparent border border-[#1F1F1F] focus:border-primary focus:outline-none text-white font-mono h-12 px-4 text-sm transition-colors appearance-none"
                    />
                  </div>
                </div>

              </div><!-- /left -->

              <!-- ══ Right column ═══════════════════════════════════════════ -->
              <div class="space-y-7">

                <!-- Category -->
                <div>
                  <label class="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">
                    <span class="inline-flex items-center gap-2">
                      Category
                      <span class="bg-primary/20 text-primary text-[10px] font-mono px-1.5 py-0.5 tracking-wider">
                        AI SUGGESTED
                      </span>
                    </span>
                  </label>
                  <div class="relative">
                    <select
                      [(ngModel)]="draft.category"
                      class="w-full bg-black border border-[#1F1F1F] focus:border-primary focus:outline-none text-white h-12 px-4 text-sm appearance-none transition-colors cursor-pointer"
                    >
                      <!-- Inject AI-suggested value as first option when it doesn't match a preset -->
                      @if (draft.category && !categories.includes(draft.category)) {
                        <option [value]="draft.category" class="bg-black">{{ draft.category }}</option>
                      }
                      @for (cat of categories; track cat) {
                        <option [value]="cat" class="bg-black">{{ cat }}</option>
                      }
                    </select>
                    <span class="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"
                          style="font-size:18px">expand_more</span>
                  </div>
                </div>

                <!-- Care Info -->
                <div>
                  <label class="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">
                    Care Info
                  </label>
                  <div class="grid grid-cols-4 gap-2">
                    @for (opt of careOptions; track opt.key) {
                      <button
                        type="button"
                        [class]="careBtnClass(opt.key)"
                        (click)="toggleCare(opt.key)"
                      >
                        <span class="material-symbols-outlined"
                              [class]="hasCare(opt.key) ? 'text-primary' : 'text-slate-500'"
                              style="font-size:20px">{{ opt.icon }}</span>
                        <span class="text-[9px] font-mono font-bold"
                              [class]="hasCare(opt.key) ? 'text-primary' : 'text-slate-500'">
                          {{ opt.label }}
                        </span>
                      </button>
                    }
                  </div>
                </div>

                <!-- Condition -->
                <div>
                  <label class="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">
                    Condition
                  </label>
                  <div class="flex border border-[#1F1F1F] w-full">
                    @for (cond of conditions; track cond; let last = $last) {
                      <button
                        type="button"
                        [class]="condBtnClass(cond, last)"
                        (click)="setCondition(cond)"
                      >{{ cond }}</button>
                    }
                  </div>
                </div>

              </div><!-- /right -->

            </div>
          </div>
        }

        <!-- Footer -->
        <div class="px-6 py-5 border-t border-[#1F1F1F] flex items-center justify-end gap-4 bg-black shrink-0">
          <button
            type="button"
            class="px-8 h-12 text-xs font-bold uppercase tracking-widest text-slate-400 hover:text-white transition-colors"
            (click)="cancelled.emit()"
          >
            Discard
          </button>
          <button
            type="button"
            class="bg-primary hover:bg-blue-500 transition-colors px-8 h-12 text-xs font-bold uppercase tracking-widest text-white shadow-lg shadow-primary/20"
            (click)="onSave()"
          >
            Add to Wardrobe
          </button>
        </div>

      </div><!-- /modal shell -->
    </div><!-- /backdrop -->
  `,
})
export class ReviewItemModalComponent implements OnChanges {
  @Input() item: ClothingItem | null = null;
  /** Brands from the user's existing wardrobe, used for datalist autocomplete. */
  @Input() knownBrands: string[] = [];
  /**
   * Currency prefix displayed beside the price field.
   * Defaults to INR; will be driven by user settings (TODO: user locale/settings).
   */
  @Input() currency = 'INR';

  @Output() saved = new EventEmitter<ClothingItem>();
  @Output() cancelled = new EventEmitter<void>();

  draft: ClothingItem | null = null;

  readonly careOptions = CARE_OPTIONS;
  readonly conditions  = CONDITIONS;
  readonly categories  = CATEGORIES;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['item'] && this.item) {
      this.draft = {
        ...this.item,
        tags:         [...(this.item.tags     ?? [])],
        colours:      (this.item.colours      ?? []).map(c => ({ ...c })),
        careInfo:     [...(this.item.careInfo  ?? [])],
        condition:    this.item.condition     ?? null,
        purchaseDate: this.item.purchaseDate  ?? null,
      };
    }
  }

  // ── Care ─────────────────────────────────────────────────────────────────

  toggleCare(key: string): void {
    if (!this.draft) return;
    const set = new Set(this.draft.careInfo ?? []);
    set.has(key) ? set.delete(key) : set.add(key);
    this.draft = { ...this.draft, careInfo: [...set] };
  }

  hasCare(key: string): boolean {
    return !!(this.draft?.careInfo?.includes(key));
  }

  careBtnClass(key: string): string {
    const base = 'aspect-square flex flex-col items-center justify-center gap-1 border transition-colors';
    return this.hasCare(key)
      ? `${base} border-primary bg-primary/10`
      : `${base} border-[#1F1F1F] hover:border-slate-500`;
  }

  // ── Condition ────────────────────────────────────────────────────────────

  setCondition(condition: string): void {
    if (this.draft) this.draft = { ...this.draft, condition };
  }

  condBtnClass(cond: string, isLast: boolean): string {
    const active = this.draft?.condition === cond
      ? 'bg-white text-black'
      : 'text-slate-400 hover:bg-white hover:text-black';
    const border = isLast ? '' : 'border-r border-[#1F1F1F]';
    return `flex-1 py-3 text-[10px] font-bold uppercase transition-colors ${active} ${border}`.trim();
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  onSave(): void {
    if (this.draft) this.saved.emit({ ...this.draft });
  }

  onOverlayClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.cancelled.emit();
  }
}
