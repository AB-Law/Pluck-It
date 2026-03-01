import {
  Component,
  EventEmitter,
  OnInit,
  Output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { UserProfile, UserProfileService } from '../../core/services/user-profile.service';

const CURRENCIES = [
  { code: 'USD', label: 'USD — US Dollar' },
  { code: 'EUR', label: 'EUR — Euro' },
  { code: 'GBP', label: 'GBP — British Pound' },
  { code: 'INR', label: 'INR — Indian Rupee' },
  { code: 'AUD', label: 'AUD — Australian Dollar' },
  { code: 'CAD', label: 'CAD — Canadian Dollar' },
  { code: 'JPY', label: 'JPY — Japanese Yen' },
  { code: 'CHF', label: 'CHF — Swiss Franc' },
  { code: 'CNY', label: 'CNY — Chinese Yuan' },
  { code: 'SEK', label: 'SEK — Swedish Krona' },
];

const SIZE_SYSTEMS = ['US', 'EU', 'UK'];

const STYLE_OPTIONS = [
  'streetwear', 'minimalist', 'preppy', 'smart casual',
  'athleisure', 'bohemian', 'classic', 'techwear', 'y2k', 'vintage',
];

@Component({
  selector: 'app-profile-panel',
  standalone: true,
  imports: [FormsModule],
  styles: [`
    @keyframes slide-in {
      from { transform: translateX(100%); opacity: 0; }
      to   { transform: translateX(0);    opacity: 1; }
    }
    .panel-animate {
      animation: slide-in 0.22s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
    }
    /* Remove number input spinners */
    input[type="number"]::-webkit-outer-spin-button,
    input[type="number"]::-webkit-inner-spin-button { -webkit-appearance: none; }
    input[type="number"] { -moz-appearance: textfield; }
  `],
  template: `
    <!-- Backdrop -->
    <div
      class="fixed inset-0 z-50"
      style="background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);"
      (click)="closed.emit()"
    ></div>

    <!-- Slide-over panel -->
    <aside
      class="panel-animate fixed top-0 right-0 z-50 h-full w-full max-w-sm bg-black border-l border-[#1F1F1F] flex flex-col shadow-2xl"
      role="dialog" aria-modal="true" aria-labelledby="profile-panel-title"
      (click)="$event.stopPropagation()"
    >
      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-5 border-b border-[#1F1F1F] shrink-0">
        <div>
          <h2 id="profile-panel-title" class="text-white font-bold text-base uppercase tracking-tight">Profile & Settings</h2>
          <p class="text-xs text-slate-500 font-mono mt-0.5">Body stats · Currency · Size system</p>
        </div>
        <button class="text-slate-500 hover:text-white transition-colors" (click)="closed.emit()" aria-label="Close">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>

      <!-- Body -->
      <div class="flex-1 overflow-y-auto px-6 py-6 space-y-8">

        @if (saving()) {
          <div class="flex items-center gap-2 text-primary text-xs font-mono">
            <span class="material-symbols-outlined animate-spin" style="font-size:16px">progress_activity</span>
            Saving…
          </div>
        }
        @if (saveError()) {
          <div class="text-red-400 text-xs font-mono">{{ saveError() }}</div>
        }

        <!-- ── Display preferences ──────────────────────────────────── -->
        <section>
          <h3 class="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">Preferences</h3>
          <div class="space-y-5">

            <!-- Currency -->
            <div>
              <label class="block text-xs text-slate-500 font-mono mb-2">Currency</label>
              <div class="relative">
                <select
                  [(ngModel)]="draft.currencyCode"
                  class="w-full bg-black border border-[#1F1F1F] focus:border-primary focus:outline-none text-white h-11 px-4 text-sm appearance-none cursor-pointer"
                >
                  @for (c of currencies; track c.code) {
                    <option [value]="c.code" class="bg-black">{{ c.label }}</option>
                  }
                </select>
                <span class="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" style="font-size:18px">expand_more</span>
              </div>
            </div>

            <!-- Size system -->
            <div>
              <label class="block text-xs text-slate-500 font-mono mb-2">Preferred Size System</label>
              <div class="flex border border-[#1F1F1F]">
                @for (sys of sizeSystems; track sys; let last = $last) {
                  <button
                    type="button"
                    [class]="sysClass(sys, last)"
                    (click)="draft.preferredSizeSystem = sys"
                  >{{ sys }}</button>
                }
              </div>
            </div>

          </div>
        </section>

        <!-- ── Body measurements ────────────────────────────────────── -->
        <section>
          <h3 class="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">Body Measurements</h3>
          <p class="text-[11px] text-slate-600 font-mono mb-4">All values in centimetres. Used by the stylist for personalised fits.</p>

          <div class="grid grid-cols-2 gap-4">

            <div>
              <label class="block text-[10px] text-slate-500 font-mono mb-1.5">HEIGHT (cm)</label>
              <input type="number" [(ngModel)]="draft.heightCm" min="50" max="250" step="0.5" placeholder="e.g. 175"
                class="w-full bg-transparent border border-[#1F1F1F] focus:border-primary focus:outline-none text-white font-mono h-10 px-3 text-sm transition-colors placeholder-slate-600" />
            </div>

            <div>
              <label class="block text-[10px] text-slate-500 font-mono mb-1.5">WEIGHT (kg)</label>
              <input type="number" [(ngModel)]="draft.weightKg" min="20" max="300" step="0.5" placeholder="e.g. 70"
                class="w-full bg-transparent border border-[#1F1F1F] focus:border-primary focus:outline-none text-white font-mono h-10 px-3 text-sm transition-colors placeholder-slate-600" />
            </div>

            <div>
              <label class="block text-[10px] text-slate-500 font-mono mb-1.5">CHEST (cm)</label>
              <input type="number" [(ngModel)]="draft.chestCm" min="50" max="200" step="0.5" placeholder="e.g. 96"
                class="w-full bg-transparent border border-[#1F1F1F] focus:border-primary focus:outline-none text-white font-mono h-10 px-3 text-sm transition-colors placeholder-slate-600" />
            </div>

            <div>
              <label class="block text-[10px] text-slate-500 font-mono mb-1.5">WAIST (cm)</label>
              <input type="number" [(ngModel)]="draft.waistCm" min="40" max="200" step="0.5" placeholder="e.g. 81"
                class="w-full bg-transparent border border-[#1F1F1F] focus:border-primary focus:outline-none text-white font-mono h-10 px-3 text-sm transition-colors placeholder-slate-600" />
            </div>

            <div>
              <label class="block text-[10px] text-slate-500 font-mono mb-1.5">HIPS (cm)</label>
              <input type="number" [(ngModel)]="draft.hipsCm" min="50" max="200" step="0.5" placeholder="e.g. 101"
                class="w-full bg-transparent border border-[#1F1F1F] focus:border-primary focus:outline-none text-white font-mono h-10 px-3 text-sm transition-colors placeholder-slate-600" />
            </div>

            <div>
              <label class="block text-[10px] text-slate-500 font-mono mb-1.5">INSEAM (cm)</label>
              <input type="number" [(ngModel)]="draft.inseamCm" min="40" max="120" step="0.5" placeholder="e.g. 76"
                class="w-full bg-transparent border border-[#1F1F1F] focus:border-primary focus:outline-none text-white font-mono h-10 px-3 text-sm transition-colors placeholder-slate-600" />
            </div>

          </div>
        </section>

        <!-- ── Style identity ──────────────────────────────────────── -->
        <section>
          <h3 class="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">Style Identity</h3>
          <p class="text-[11px] text-slate-600 font-mono mb-4">Your personal aesthetics — the stylist agent uses these to personalise suggestions.</p>

          <!-- Style preference chips -->
          <div class="mb-5">
            <label class="block text-[10px] text-slate-500 font-mono mb-2">AESTHETICS (pick all that apply)</label>
            <div class="flex flex-wrap gap-2">
              @for (style of styleOptions; track style) {
                <button
                  type="button"
                  [class]="styleChipClass(style)"
                  (click)="toggleStyle(style)"
                >{{ style }}</button>
              }
            </div>
          </div>

          <!-- Favourite brands -->
          <div class="mb-5">
            <label class="block text-[10px] text-slate-500 font-mono mb-2">FAVOURITE BRANDS (comma-separated)</label>
            <input
              type="text"
              [value]="draft.favoriteBrands.join(', ')"
              (blur)="parseBrands($event)"
              placeholder="e.g. Nike, COS, Zara"
              class="w-full bg-transparent border border-[#1F1F1F] focus:border-primary focus:outline-none text-white font-mono h-10 px-3 text-sm transition-colors placeholder-slate-600"
            />
          </div>

          <!-- Preferred colours -->
          <div class="mb-5">
            <label class="block text-[10px] text-slate-500 font-mono mb-2">PREFERRED COLOURS (comma-separated)</label>
            <input
              type="text"
              [value]="draft.preferredColours.join(', ')"
              (blur)="parseColours($event)"
              placeholder="e.g. black, earth tones, pastels"
              class="w-full bg-transparent border border-[#1F1F1F] focus:border-primary focus:outline-none text-white font-mono h-10 px-3 text-sm transition-colors placeholder-slate-600"
            />
          </div>

          <!-- Location city -->
          <div>
            <label class="block text-[10px] text-slate-500 font-mono mb-2">CITY (for weather-aware suggestions)</label>
            <input
              type="text"
              [(ngModel)]="draft.locationCity"
              placeholder="e.g. London"
              class="w-full bg-transparent border border-[#1F1F1F] focus:border-primary focus:outline-none text-white font-mono h-10 px-3 text-sm transition-colors placeholder-slate-600"
            />
          </div>
        </section>

      </div>

      <!-- Footer -->
      <div class="px-6 py-5 border-t border-[#1F1F1F] flex gap-4 shrink-0">
        <button
          type="button"
          class="flex-1 h-11 text-xs font-bold uppercase tracking-widest text-slate-400 hover:text-white border border-[#1F1F1F] hover:border-slate-500 transition-colors"
          (click)="closed.emit()"
        >Cancel</button>
        <button
          type="button"
          class="flex-1 bg-primary hover:bg-blue-500 transition-colors h-11 text-xs font-bold uppercase tracking-widest text-white shadow-lg shadow-primary/20 disabled:opacity-50"
          [disabled]="saving()"
          (click)="save()"
        >Save</button>
      </div>
    </aside>
  `,
})
export class ProfilePanelComponent implements OnInit {
  @Output() closed = new EventEmitter<void>();

  readonly saving    = signal(false);
  readonly saveError = signal<string | null>(null);

  draft: UserProfile = {
    currencyCode: 'USD',
    preferredSizeSystem: 'US',
    stylePreferences: [],
    favoriteBrands: [],
    preferredColours: [],
  };

  readonly currencies   = CURRENCIES;
  readonly sizeSystems  = SIZE_SYSTEMS;
  readonly styleOptions = STYLE_OPTIONS;

  constructor(private profileService: UserProfileService) {}

  ngOnInit(): void {
    const current = this.profileService.profile();
    if (current) {
      this.draft = { ...current };
    } else {
      this.profileService.load().subscribe({
        next: p => { this.draft = { ...p }; },
        error: () => { /* use defaults */ }
      });
    }
  }

  save(): void {
    this.saving.set(true);
    this.saveError.set(null);
    this.profileService.update(this.draft).subscribe({
      next: () => { this.saving.set(false); this.closed.emit(); },
      error: err => {
        this.saving.set(false);
        this.saveError.set(err?.error?.error ?? err?.message ?? 'Save failed. Please try again.');
      }
    });
  }

  toggleStyle(style: string): void {
    const prefs = this.draft.stylePreferences;
    const idx = prefs.indexOf(style);
    this.draft = {
      ...this.draft,
      stylePreferences: idx >= 0 ? prefs.filter(s => s !== style) : [...prefs, style],
    };
  }

  parseBrands(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.draft = { ...this.draft, favoriteBrands: val.split(',').map(s => s.trim()).filter(Boolean) };
  }

  parseColours(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.draft = { ...this.draft, preferredColours: val.split(',').map(s => s.trim()).filter(Boolean) };
  }

  styleChipClass(style: string): string {
    const active = this.draft.stylePreferences.includes(style);
    return [
      'px-3 py-1 text-[11px] font-mono uppercase tracking-wide border transition-colors cursor-pointer',
      active
        ? 'bg-primary border-primary text-white'
        : 'bg-transparent border-[#333] text-slate-400 hover:border-primary hover:text-white',
    ].join(' ');
  }

  sysClass(sys: string, isLast: boolean): string {
    const active = this.draft.preferredSizeSystem === sys
      ? 'bg-white text-black'
      : 'text-slate-400 hover:bg-white hover:text-black';
    const border = isLast ? '' : 'border-r border-[#1F1F1F]';
    return `flex-1 py-2.5 text-xs font-bold uppercase transition-colors ${active} ${border}`.trim();
  }
}
