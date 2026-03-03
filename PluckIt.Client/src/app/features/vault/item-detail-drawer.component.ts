import { Component, input, output, signal, computed, inject, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ClothingItem, WearHistoryRecord, WearHistorySummary } from '../../core/models/clothing-item.model';
import { WardrobeService } from '../../core/services/wardrobe.service';
import { UserProfileService } from '../../core/services/user-profile.service';
import { WearHistoryCalendarComponent } from './wear-history-calendar.component';

const CARE_ICON_MAP: Record<string, { icon: string; label: string }> = {
  dry_clean: { icon: 'dry_cleaning',         label: 'Dry Clean Only' },
  wash:      { icon: 'local_laundry_service', label: 'Machine Wash'   },
  iron:      { icon: 'iron',                 label: 'Low Heat Iron'  },
  bleach:    { icon: 'water',                label: 'No Bleach'      },
};

@Component({
  selector: 'app-item-detail-drawer',
  standalone: true,
  imports: [CommonModule, WearHistoryCalendarComponent],
  template: `
    <!-- Slide-in panel — driven by CSS translate transition -->
    <aside
      class="w-80 flex-shrink-0 flex-col border-l border-border-chrome bg-black overflow-y-auto transition-transform duration-300 ease-in-out"
      [class.hidden]="!item()"
      [class.flex]="!!item()"
    >
      @if (item(); as itm) {
        <div class="p-6">

          <!-- Header -->
          <div class="mb-6 flex items-center justify-between">
            <h3 class="text-lg font-bold text-slate-100">Item Details</h3>
            <button class="text-slate-500 hover:text-white transition-colors" (click)="closed.emit()">
              <span class="material-symbols-outlined">close</span>
            </button>
          </div>

          <!-- Image preview -->
          <div class="mb-6 rounded-lg bg-card-dark p-4 border border-border-chrome">
            <div class="flex items-center justify-center h-48 overflow-hidden rounded mb-4 bg-black">
              <img
                [src]="itm.imageUrl"
                [alt]="itm.brand || 'Item'"
                class="h-full w-full object-contain p-2"
                style="mix-blend-mode: lighten"
              />
            </div>
            <h4 class="text-md font-bold text-slate-100">{{ itm.brand || 'Unknown Brand' }}</h4>
            <p class="text-xs text-slate-500 font-mono">Archive ID: #{{ itm.id.slice(-8).toUpperCase() }}</p>
          </div>

          <div class="space-y-6">

            <!-- Analytics -->
            <div>
              <h5 class="mb-2 text-xs font-bold uppercase tracking-widest text-slate-500">Analytics</h5>
              <div class="grid grid-cols-2 gap-4">
                <div class="rounded bg-card-dark p-3 border border-border-chrome">
                  <p class="text-[10px] text-slate-500 mb-0.5">Wear Count</p>
                  <p class="font-mono text-sm font-bold text-slate-100">{{ wearCountDisplay() }}</p>
                </div>
                <div class="rounded bg-card-dark p-3 border border-border-chrome">
                  <p class="text-[10px] text-slate-500 mb-0.5">CPW</p>
                  <p class="font-mono text-sm font-bold text-primary">{{ cpwDisplay() }}</p>
                </div>
                <div class="rounded bg-card-dark p-3 border border-border-chrome">
                  <p class="text-[10px] text-slate-500 mb-0.5">Condition</p>
                  <p class="font-mono text-sm font-bold text-slate-100">{{ itm.condition || '—' }}</p>
                </div>
                <div class="rounded bg-card-dark p-3 border border-border-chrome">
                  <p class="text-[10px] text-slate-500 mb-0.5">Est. Value</p>
                  <p class="font-mono text-sm font-bold text-slate-100">{{ valueDisplay() }}</p>
                </div>
              </div>
            </div>

            <!-- Care Instructions -->
            @if (itm.careInfo?.length) {
              <div>
                <h5 class="mb-2 text-xs font-bold uppercase tracking-widest text-slate-500">Care Instructions</h5>
                <div class="flex flex-wrap gap-2">
                  @for (key of (itm.careInfo ?? []); track key) {
                    <span class="flex items-center gap-1 rounded-full bg-border-chrome px-2 py-1 text-[10px] text-slate-300">
                      <span class="material-symbols-outlined text-xs">{{ careIcon(key) }}</span>
                      {{ careLabel(key) }}
                    </span>
                  }
                </div>
              </div>
            }

            <!-- Aesthetic Tags -->
            @if (itm.aestheticTags?.length) {
              <div>
                <h5 class="mb-2 text-xs font-bold uppercase tracking-widest text-slate-500">Style Tags</h5>
                <div class="flex flex-wrap gap-2">
                  @for (tag of itm.aestheticTags; track tag) {
                    <span class="rounded bg-primary/10 px-2 py-1 text-[10px] font-mono font-bold text-primary">
                      {{ tag | uppercase }}
                    </span>
                  }
                </div>
              </div>
            }

            <!-- Notes / Activity -->
            @if (itm.notes) {
              <div>
                <h5 class="mb-2 text-xs font-bold uppercase tracking-widest text-slate-500">Notes</h5>
                <p class="text-xs text-slate-400 leading-relaxed">{{ itm.notes }}</p>
              </div>
            }

            <!-- Wear History Calendar -->
            <div>
              <h5 class="mb-2 text-xs font-bold uppercase tracking-widest text-slate-500">Wear History</h5>
              @if (wearHistoryLoading()) {
                <p class="text-[11px] text-slate-500 font-mono">Loading timeline…</p>
              } @else {
                <app-wear-history-calendar
                  [events]="wearHistoryEvents()"
                  [summary]="wearHistorySummary()"
                />
              }
            </div>

            <!-- Actions -->
            <div class="pt-2 space-y-3">

              <!-- Log Wear -->
              <button
                class="w-full flex items-center justify-center gap-2 rounded-lg border border-primary/40 py-2.5 text-sm font-bold text-primary hover:bg-primary/10 transition-colors"
                [disabled]="logWearWorking()"
                (click)="logWear(itm)"
                aria-label="Log Wear"
              >
                <span class="material-symbols-outlined text-sm">add_circle</span>
                {{ logWearWorking() ? 'Logging…' : 'Log Wear (+1)' }}
              </button>

              <!-- Share to Collection -->
              <button
                class="w-full rounded-lg bg-primary py-3 text-sm font-bold text-white hover:bg-blue-500 transition-colors"
                (click)="shareToCollection.emit(itm)"
              >
                Share to Collection
              </button>

              <!-- Edit Metadata -->
              <button
                class="w-full rounded-lg border border-border-chrome py-3 text-sm font-bold text-slate-300 hover:bg-card-dark transition-colors"
                (click)="editRequested.emit(itm)"
              >
                Edit Metadata
              </button>

            </div>
          </div>
        </div>
      }
    </aside>
  `,
})
export class ItemDetailDrawerComponent {
  item = input<ClothingItem | null>(null);

  closed           = output<void>();
  editRequested    = output<ClothingItem>();
  shareToCollection = output<ClothingItem>();
  wearLogged       = output<ClothingItem>();

  protected logWearWorking = signal(false);
  protected wearHistoryLoading = signal(false);
  protected wearHistoryEvents = signal<WearHistoryRecord[]>([]);
  protected wearHistorySummary = signal<WearHistorySummary | null>(null);

  private wardrobeService = inject(WardrobeService);
  private profileService  = inject(UserProfileService);

  constructor() {
    effect(() => {
      const itm = this.item();
      if (!itm) {
        this.wearHistoryEvents.set([]);
        this.wearHistorySummary.set(null);
        return;
      }
      this.wearHistoryLoading.set(true);
      this.wardrobeService.getWearHistory(itm.id).subscribe({
        next: res => {
          this.wearHistoryEvents.set(res.events ?? []);
          this.wearHistorySummary.set(res.summary ?? null);
          this.wearHistoryLoading.set(false);
        },
        error: () => this.wearHistoryLoading.set(false),
      });
    });
  }

  private get currency(): string {
    return this.profileService.getOrDefault().currencyCode;
  }

  readonly wearCountDisplay = computed(() =>
    String(this.item()?.wearCount ?? 0));

  readonly cpwDisplay = computed(() => {
    const itm = this.item();
    if (!itm) return '—';
    const price = itm.price?.amount;
    const wears = itm.wearCount;
    if (!price || wears === 0) return 'N/A';
    return this.fmt(price / wears, itm.price?.originalCurrency ?? this.currency);
  });

  readonly valueDisplay = computed(() => {
    const itm = this.item();
    if (!itm) return '—';
    const val = itm.estimatedMarketValue ?? itm.price?.amount;
    return val != null ? this.fmt(val, itm.price?.originalCurrency ?? this.currency) : '—';
  });

  careIcon(key: string): string  { return CARE_ICON_MAP[key]?.icon  ?? 'info'; }
  careLabel(key: string): string { return CARE_ICON_MAP[key]?.label ?? key;    }

  logWear(itm: ClothingItem): void {
    if (this.logWearWorking()) return;
    this.logWearWorking.set(true);
    const rand = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    this.wardrobeService.logWear(itm.id, {
      source: 'item_drawer',
      clientEventId: `wear-${rand}`,
    }).subscribe({
      next: updated => {
        this.wearLogged.emit(updated);
        this.logWearWorking.set(false);
        this.wardrobeService.getWearHistory(itm.id).subscribe({
          next: res => {
            this.wearHistoryEvents.set(res.events ?? []);
            this.wearHistorySummary.set(res.summary ?? null);
          },
        });
      },
      error: () => this.logWearWorking.set(false),
    });
  }

  private fmt(val: number, currency: string): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency ?? 'USD',
      maximumFractionDigits: 2,
    }).format(val);
  }
}
