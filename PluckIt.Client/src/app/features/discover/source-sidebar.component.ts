import { Component, input, output, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ScraperSource } from '../../core/models/scraped-item.model';

@Component({
  selector: 'app-source-sidebar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <aside
      class="flex h-full w-64 flex-shrink-0 flex-col border-r border-border-chrome bg-black"
      [class.fixed]="mobileMode()"
      [class.inset-0]="mobileMode()"
      [class.z-50]="mobileMode()"
      [class.right-0]="mobileMode()"
      [class.w-full]="mobileMode()"
    >
      @if (mobileMode()) {
        <div class="mb-2 border-b border-border-chrome px-4 py-4 flex items-center justify-between">
          <h2 class="text-xs font-bold uppercase tracking-widest text-slate-500">Sources</h2>
          <button
            class="touch-target h-10 w-10 flex items-center justify-center rounded-lg bg-zinc-900 text-slate-500 hover:text-white"
            aria-label="Close sources"
            (click)="closed.emit()"
            title="Close sources"
          >
            <span class="material-symbols-outlined" style="font-size:20px">close</span>
          </button>
        </div>
      }
      <!-- Header -->
      @if (!mobileMode()) {
        <div class="border-b border-border-chrome px-4 py-4">
          <h2 class="text-xs font-bold uppercase tracking-widest text-slate-500">Sources</h2>
        </div>
      }

      <!-- Source list -->
      <div class="flex-1 overflow-y-auto px-3 py-3 space-y-1">
        <!-- All / Global -->
        <button
          class="touch-target flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors"
          [class]="activeSourceId() === null ? 'bg-primary/10 text-primary' : 'text-slate-400 hover:bg-zinc-900 hover:text-slate-100'"
          (click)="sourceSelected.emit(null)"
        >
          <span class="material-symbols-outlined text-base">explore</span>
          <span class="text-xs font-medium">All Sources</span>
        </button>

        <!-- Reddit section -->
        <p class="mt-3 px-3 text-[9px] font-bold uppercase tracking-widest text-slate-600">Reddit</p>
        @for (src of redditSources(); track src.id) {
          <button
            class="touch-target flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors"
            [class]="activeSourceId() === src.id
              ? 'bg-primary/10 text-primary'
              : 'text-slate-400 hover:bg-zinc-900 hover:text-slate-100'"
            (click)="sourceSelected.emit(src.id)"
          >
            <span class="material-symbols-outlined text-base text-orange-400">forum</span>
            <span class="flex-1 text-xs font-medium truncate">{{ src.name }}</span>
            @if (!src.isGlobal) {
              <button
                class="touch-target rounded-lg p-1.5 text-slate-600 hover:text-red-400 transition-colors"
                title="Unsubscribe"
                aria-label="Unsubscribe from source"
                (click)="unsubscribe.emit(src.id); $event.stopPropagation()"
              >
                <span class="material-symbols-outlined text-[12px]">close</span>
              </button>
            }
          </button>
        }

        <!-- Brand section -->
        @if (brandSources().length > 0) {
          <p class="mt-3 px-3 text-[9px] font-bold uppercase tracking-widest text-slate-600">Brands</p>
          @for (src of brandSources(); track src.id) {
            <button
            class="touch-target flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors"
              [class]="activeSourceId() === src.id
                ? 'bg-primary/10 text-primary'
                : 'text-slate-400 hover:bg-zinc-900 hover:text-slate-100'"
              (click)="sourceSelected.emit(src.id)"
            >
              <span class="material-symbols-outlined text-base text-blue-400">storefront</span>
              <span class="flex-1 text-xs font-medium truncate">{{ src.name }}</span>
              @if (!src.isGlobal) {
                <button
                class="touch-target rounded-lg p-1.5 text-slate-600 hover:text-red-400 transition-colors"
                title="Unsubscribe"
                aria-label="Unsubscribe from source"
                  (click)="unsubscribe.emit(src.id); $event.stopPropagation()"
                >
                  <span class="material-symbols-outlined text-[12px]">close</span>
                </button>
              }
            </button>
          }
        }
      </div>

      <!-- Suggest new brand -->
      <div class="border-t border-border-chrome px-4 py-4 space-y-2">
        @if (!showForm()) {
          <button
            class="touch-target flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border-chrome
                   py-2 text-xs text-slate-500 hover:border-primary/50 hover:text-primary transition-colors"
            (click)="showForm.set(true)"
          >
            <span class="material-symbols-outlined text-base">add</span>
            Suggest a brand
          </button>
        } @else {
          <div class="space-y-2">
            <input
              [(ngModel)]="brandName"
              placeholder="Brand name"
              class="w-full rounded-lg bg-zinc-900 border border-border-chrome px-3 py-1.5 text-xs text-slate-100
                     placeholder-slate-600 outline-none focus:border-primary/50"
            />
            <input
              [(ngModel)]="brandUrl"
              placeholder="Listing page URL"
              class="w-full rounded-lg bg-zinc-900 border border-border-chrome px-3 py-1.5 text-xs text-slate-100
                     placeholder-slate-600 outline-none focus:border-primary/50"
            />
            <div class="flex gap-2">
              <button
                class="flex-1 touch-target rounded-lg bg-primary/10 border border-primary/30 px-3 py-1.5 text-xs font-medium
                       text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
                [disabled]="!brandName.trim() || !brandUrl.trim()"
                (click)="onSuggest()"
              >
                Submit
              </button>
              <button
                class="touch-target rounded-lg border border-border-chrome px-3 py-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
                (click)="showForm.set(false)"
              >
                Cancel
              </button>
            </div>
          </div>
        }
      </div>
    </aside>
  `,
})
export class SourceSidebarComponent {
  sources = input.required<ScraperSource[]>();
  activeSourceId = input<string | null>(null);

  sourceSelected = output<string | null>();
  unsubscribe = output<string>();
  suggestBrand = output<{ name: string; url: string }>();

  showForm = signal(false);
  brandName = '';
  brandUrl = '';

  mobileMode = input<boolean>(false);
  closed = output<void>();

  redditSources = computed(() => this.sources().filter(s => s.sourceType === 'reddit'));
  brandSources = computed(() => this.sources().filter(s => s.sourceType === 'brand'));

  onSuggest() {
    if (!this.brandName.trim() || !this.brandUrl.trim()) return;
    this.suggestBrand.emit({ name: this.brandName.trim(), url: this.brandUrl.trim() });
    this.brandName = '';
    this.brandUrl = '';
    this.showForm.set(false);
  }
}
