import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ClothingItem, ItemCondition } from '../../core/models/clothing-item.model';
import { UserProfileService } from '../../core/services/user-profile.service';

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

const LETTER_SIZE_CATEGORIES = new Set([
  'Tops', 'Knitwear', 'Outerwear', 'Dresses', 'Activewear', 'Swimwear', 'Underwear',
]);
const LETTER_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
const WAIST_SIZES = Array.from({ length: 25 }, (_, i) => 24 + i);  // 24–48
const INSEAM_SIZES = Array.from({ length: 11 }, (_, i) => 26 + i); // 26–36

function sizeType(category: string | null): 'letter' | 'bottoms' | 'shoe' | 'none' {
  if (!category) return 'none';
  if (category === 'Bottoms') return 'bottoms';
  if (category === 'Footwear') return 'shoe';
  if (LETTER_SIZE_CATEGORIES.has(category)) return 'letter';
  return 'none';
}

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
      class="modal-animate h-full w-full max-w-none md:max-w-4xl md:max-h-[90vh] md:h-auto bg-black border border-[#1F1F1F] shadow-2xl flex flex-col rounded-none md:rounded-lg"
        role="dialog" aria-modal="true" aria-labelledby="enrich-modal-title"
        (click)="$event.stopPropagation()"
      >

        <!-- Header -->
        @if (draft) {
          <div class="flex items-center justify-between px-4 py-4 md:px-6 md:py-6 border-b border-[#1F1F1F] shrink-0">
            <div class="flex items-center gap-4">
              <!-- Thumbnail -->
              <div class="w-12 h-12 bg-[#0d0d0d] border border-[#1F1F1F] flex items-center justify-center overflow-hidden shrink-0">
                <img [src]="draft.imageUrl" alt="Item preview"
                     class="w-full h-full object-contain opacity-85" />
              </div>
              <div>
                <h1 id="enrich-modal-title"
                    class="text-xl font-bold tracking-tight uppercase text-white">
                  {{ isEditMode ? 'Edit Item' : 'Enrich Your Item' }}
                </h1>
                <p class="text-xs text-slate-500 font-mono mt-0.5">
                  ID: {{ draft.id.slice(0, 8).toUpperCase() }}
                </p>
              </div>
            </div>
            <button
              class="touch-target h-10 w-10 flex items-center justify-center rounded-lg text-slate-500 hover:text-white transition-colors"
              (click)="cancelled.emit()" aria-label="Close"
            >
              <span class="material-symbols-outlined">close</span>
            </button>
          </div>
        }

        <!-- Body -->
        @if (draft) {
          <div class="flex-1 overflow-y-auto modal-scroll px-4 py-4 md:px-8 md:py-7">
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
                      [ngModel]="priceAmount"
                      (ngModelChange)="setPriceAmount($event)"
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

                <!-- Notes -->
                <div>
                  <label class="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">
                    Notes
                  </label>
                  <textarea
                    [(ngModel)]="draft.notes"
                    rows="3"
                    placeholder="Any additional notes…"
                    class="w-full bg-transparent border border-[#1F1F1F] focus:border-primary focus:outline-none text-white font-mono px-4 py-3 text-sm transition-colors placeholder-slate-600 resize-none"
                  ></textarea>
                </div>

                <!-- Tags -->
                <div>
                  <label class="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">
                    Tags
                    <span class="ml-2 bg-primary/20 text-primary text-[10px] font-mono px-1.5 py-0.5 tracking-wider">
                      AI SUGGESTED
                    </span>
                  </label>
                  <!-- Chips -->
                  <div class="flex flex-wrap gap-2 mb-2">
                    @for (tag of draft.tags; track tag) {
                      <span class="inline-flex items-center gap-1 px-2 py-1 bg-[#1a1a1a] border border-[#333] text-slate-300 text-[11px] font-mono uppercase tracking-wide">
                        {{ tag }}
                        <button type="button" class="touch-target text-slate-500 hover:text-red-400 transition-colors ml-1 p-0.5"
                                (click)="removeTag(tag)" [attr.aria-label]="'Remove tag ' + tag">
                          <span class="material-symbols-outlined" style="font-size:13px">close</span>
                        </button>
                      </span>
                    }
                  </div>
                  <!-- Add tag input -->
                  <div class="flex gap-2">
                    <input
                      type="text"
                      [(ngModel)]="newTag"
                      (keydown.enter)="addTag(); $event.preventDefault()"
                      placeholder="Add tag…"
                      class="flex-1 bg-transparent border border-[#1F1F1F] focus:border-primary focus:outline-none text-white font-mono h-9 px-3 text-xs transition-colors placeholder-slate-600"
                    />
                    <button type="button"
                            class="touch-target bg-[#1F1F1F] hover:bg-[#2a2a2a] text-slate-300 h-11 px-3 text-xs font-mono border border-[#333] transition-colors"
                            (click)="addTag()">
                      ADD
                    </button>
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
                      @if (!isEditMode) {
                        <span class="bg-primary/20 text-primary text-[10px] font-mono px-1.5 py-0.5 tracking-wider">
                          AI SUGGESTED
                        </span>
                      }
                    </span>
                  </label>
                  <div class="relative">
                    <select
                      [(ngModel)]="draft.category"
                      (ngModelChange)="onCategoryChange()"
                      class="w-full bg-black border border-[#1F1F1F] focus:border-primary focus:outline-none text-white h-12 px-4 text-sm appearance-none transition-colors cursor-pointer"
                    >
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

                <!-- ── Size ─────────────────────────────────────────────── -->
                @if (currentSizeType !== 'none') {
                  <div>
                    <label class="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">
                      Size
                      @if (sizeSystem) {
                        <span class="ml-2 text-[10px] font-mono text-slate-500">({{ sizeSystem }})</span>
                      }
                    </label>

                    <!-- Letter sizes -->
                    @if (currentSizeType === 'letter') {
                      <div class="flex border border-[#1F1F1F] w-full flex-wrap">
                        @for (s of letterSizes; track s; let last = $last) {
                          <button
                            type="button"
                            [class]="letterSizeBtnClass(s, last)"
                            (click)="setLetterSize(s)"
                          >{{ s }}</button>
                        }
                      </div>
                    }

                    <!-- Bottoms: waist × inseam -->
                    @if (currentSizeType === 'bottoms') {
                      <div class="flex gap-3">
                        <div class="flex-1">
                          <label class="block text-[10px] text-slate-500 font-mono mb-1.5">WAIST (in)</label>
                          <div class="relative">
                            <select
                              [ngModel]="draft.size?.waist ?? null"
                              (ngModelChange)="setBottomsSize('waist', $event)"
                              class="w-full bg-black border border-[#1F1F1F] focus:border-primary focus:outline-none text-white h-10 px-3 text-sm appearance-none cursor-pointer"
                            >
                              <option [ngValue]="null" class="bg-black">—</option>
                              @for (w of waistSizes; track w) {
                                <option [ngValue]="w" class="bg-black">{{ w }}</option>
                              }
                            </select>
                            <span class="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" style="font-size:16px">expand_more</span>
                          </div>
                        </div>
                        <div class="flex items-end pb-2.5 text-slate-500 font-mono text-sm">×</div>
                        <div class="flex-1">
                          <label class="block text-[10px] text-slate-500 font-mono mb-1.5">INSEAM (in)</label>
                          <div class="relative">
                            <select
                              [ngModel]="draft.size?.inseam ?? null"
                              (ngModelChange)="setBottomsSize('inseam', $event)"
                              class="w-full bg-black border border-[#1F1F1F] focus:border-primary focus:outline-none text-white h-10 px-3 text-sm appearance-none cursor-pointer"
                            >
                              <option [ngValue]="null" class="bg-black">—</option>
                              @for (i of inseamSizes; track i) {
                                <option [ngValue]="i" class="bg-black">{{ i }}</option>
                              }
                            </select>
                            <span class="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" style="font-size:16px">expand_more</span>
                          </div>
                        </div>
                      </div>
                    }

                    <!-- Shoe size -->
                    @if (currentSizeType === 'shoe') {
                      <input
                        type="number"
                        [ngModel]="draft.size?.shoeSize ?? null"
                        (ngModelChange)="setShoeSize($event)"
                        min="3"
                        max="18"
                        step="0.5"
                        placeholder="e.g. 10.5"
                        class="w-full bg-transparent border border-[#1F1F1F] focus:border-primary focus:outline-none text-white font-mono h-12 px-4 text-sm transition-colors placeholder-slate-600"
                      />
                    }
                  </div>
                }

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
        <div class="px-4 py-4 md:px-6 md:py-5 border-t border-[#1F1F1F] flex items-center justify-end gap-3 md:gap-4 bg-black shrink-0">
          <button
            type="button"
            class="touch-target px-5 md:px-8 h-11 md:h-12 text-xs font-bold uppercase tracking-widest text-slate-400 hover:text-white transition-colors"
            (click)="cancelled.emit()"
          >
            {{ isEditMode ? 'Cancel' : 'Discard' }}
          </button>
          <button
            type="button"
            class="touch-target bg-primary hover:bg-blue-500 transition-colors px-5 md:px-8 h-11 md:h-12 text-xs font-bold uppercase tracking-widest text-white shadow-lg shadow-primary/20"
            (click)="onSave()"
          >
            {{ isEditMode ? 'Save Changes' : 'Add to Wardrobe' }}
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
   * When true, the modal shows "Edit Item" / "Save Changes" language instead of
   * "Enrich Your Item" / "Add to Wardrobe".
   */
  @Input() isEditMode = false;

  @Output() saved    = new EventEmitter<ClothingItem>();
  @Output() updated  = new EventEmitter<ClothingItem>();
  @Output() cancelled = new EventEmitter<void>();

  draft: ClothingItem | null = null;
  newTag = '';

  readonly careOptions = CARE_OPTIONS;
  readonly conditions  = CONDITIONS;
  readonly categories  = CATEGORIES;
  readonly letterSizes = LETTER_SIZES;
  readonly waistSizes  = WAIST_SIZES;
  readonly inseamSizes = INSEAM_SIZES;

  get currency(): string {
    return this.profileService.getOrDefault().currencyCode;
  }

  /** Adapter: read amount from ClothingPrice (or null → empty). */
  get priceAmount(): number | null {
    return this.draft?.price?.amount ?? null;
  }

  /** Adapter: write amount back into the ClothingPrice object. */
  setPriceAmount(val: number | null): void {
    if (!this.draft) return;
    if (val === null || val === undefined) {
      this.draft = { ...this.draft, price: null };
    } else {
      this.draft = {
        ...this.draft,
        price: {
          amount: val,
          originalCurrency: this.currency,
          purchaseDate: this.draft.purchaseDate,
        },
      };
    }
  }

  get sizeSystem(): string {
    return this.profileService.getOrDefault().preferredSizeSystem;
  }

  get currentSizeType(): 'letter' | 'bottoms' | 'shoe' | 'none' {
    return sizeType(this.draft?.category ?? null);
  }

  constructor(private readonly profileService: UserProfileService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['item'] && this.item) {
      this.draft = {
        ...this.item,
        tags:         [...(this.item.tags       ?? [])],
        colours:      (this.item.colours        ?? []).map(c => ({ ...c })),
        careInfo:     [...(this.item.careInfo    ?? [])],
        condition:    this.item.condition     ?? null,
        purchaseDate: this.item.purchaseDate  ?? null,
        size: this.item.size ? { ...this.item.size } : null,
      };
    }
  }

  // ── Tags ─────────────────────────────────────────────────────────────────

  addTag(): void {
    const tag = this.newTag.trim().toLowerCase();
    if (!tag || !this.draft) return;
    if (!this.draft.tags.includes(tag)) {
      this.draft = { ...this.draft, tags: [...this.draft.tags, tag] };
    }
    this.newTag = '';
  }

  removeTag(tag: string): void {
    if (!this.draft) return;
    this.draft = { ...this.draft, tags: this.draft.tags.filter(t => t !== tag) };
  }

  // ── Size ─────────────────────────────────────────────────────────────────

  onCategoryChange(): void {
    // Reset size when category changes to avoid stale size data
    if (this.draft) {
      this.draft = { ...this.draft, size: null };
    }
  }

  setLetterSize(letter: string): void {
    if (!this.draft) return;
    const current = this.draft.size?.letter === letter ? null : letter;
    this.draft = {
      ...this.draft,
      size: current ? { letter: current, system: this.sizeSystem } : null,
    };
  }

  setBottomsSize(field: 'waist' | 'inseam', value: number | null): void {
    if (!this.draft) return;
    this.draft = {
      ...this.draft,
      size: { ...this.draft.size, [field]: value, system: this.sizeSystem },
    };
  }

  setShoeSize(value: number | null): void {
    if (!this.draft) return;
    this.draft = {
      ...this.draft,
      size: value === null ? null : { shoeSize: value, system: this.sizeSystem },
    };
  }

  letterSizeBtnClass(size: string, isLast: boolean): string {
    const active = this.draft?.size?.letter === size
      ? 'bg-white text-black'
      : 'text-slate-400 hover:bg-white hover:text-black';
    const border = isLast ? '' : 'border-r border-[#1F1F1F]';
    return `flex-1 py-3 text-[10px] font-bold uppercase transition-colors ${active} ${border}`.trim();
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
    if (this.draft) this.draft = { ...this.draft, condition: condition as ItemCondition };
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
    if (!this.draft) return;
    if (this.isEditMode) {
      this.updated.emit({ ...this.draft });
    } else {
      this.saved.emit({ ...this.draft });
    }
  }

  onOverlayClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.cancelled.emit();
  }
}
