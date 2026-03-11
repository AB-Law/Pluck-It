import { Component, input, output, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ScrapedItem } from '../../core/models/scraped-item.model';

@Component({
  selector: 'app-discover-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      class="group relative flex flex-col rounded-xl border bg-card-dark overflow-hidden
             transition-all duration-200 cursor-pointer"
      [class]="voted() === 'up'
        ? 'border-emerald-600/60 shadow-[0_0_12px_rgba(52,211,153,0.15)]'
        : voted() === 'down'
          ? 'border-rose-700/40'
          : 'border-border-chrome hover:border-primary/50'"
      (click)="cardClicked.emit(item())"
    >
      <!-- Image -->
      <div class="relative w-full overflow-hidden bg-zinc-900" [style.paddingBottom.%]="125">
        <img
          [src]="item().imageUrl"
          [alt]="item().title"
          class="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          loading="lazy"
          (error)="onImgError($event)"
        />

        <!-- Top badges row -->
        <div class="absolute top-2 left-2 right-2 flex items-start justify-between">
          <!-- Source badge -->
          <span
            class="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
            [class]="sourceBadgeClass()"
          >
            {{ item().sourceType }}
          </span>

          <!-- Reddit score (provenance) -->
          @if (item().redditScore) {
            <span class="rounded-full bg-orange-900/60 px-2 py-0.5 text-[10px] font-mono text-orange-300"
                  title="Reddit upvotes">
              ↑ {{ item().redditScore }}
            </span>
          }
        </div>

        <!-- Like/dislike overlay — appear on hover -->
        <div
          class="absolute bottom-0 left-0 right-0 flex items-center justify-between px-2 pb-2 pt-6
                 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
          style="background: linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 100%)"
          (click)="$event.stopPropagation()"
        >
          <!-- Dislike -->
          <button
            class="flex items-center justify-center h-8 w-8 rounded-full transition-all active:scale-90"
            [class]="voted() === 'down'
              ? 'bg-rose-600 text-white'
              : 'bg-black/50 text-slate-300 hover:bg-rose-900/60 hover:text-rose-300'"
            title="Not for me"
            (click)="onVote('down')"
          >
            <span class="material-symbols-outlined text-base">thumb_down</span>
          </button>

          <!-- Our platform like count -->
          <span
            class="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-mono transition-colors"
            [class]="localPlatformScore() > 0
              ? 'bg-emerald-900/70 text-emerald-300'
              : localPlatformScore() < 0
                ? 'bg-rose-900/70 text-rose-300'
                : 'bg-black/60 text-slate-400'"
            title="Pluck-It community likes"
          >
            <span class="material-symbols-outlined text-[10px]">favorite</span>
            {{ localPlatformScore() > 0 ? '+' : '' }}{{ localPlatformScore() }}
          </span>

          <!-- Like -->
          <button
            class="flex items-center justify-center h-8 w-8 rounded-full transition-all active:scale-90"
            [class]="voted() === 'up'
              ? 'bg-emerald-600 text-white'
              : 'bg-black/50 text-slate-300 hover:bg-emerald-900/60 hover:text-emerald-300'"
            title="Love it"
            (click)="onVote('up')"
          >
            <span class="material-symbols-outlined text-base">thumb_up</span>
          </button>
        </div>
      </div>

      <!-- Content -->
      <div class="flex flex-col gap-1.5 p-3">
        <p class="text-xs font-semibold text-slate-100 line-clamp-2 leading-snug">{{ item().title }}</p>

        <!-- Tags -->
        @if (item().tags.length > 0) {
          <div class="flex flex-wrap gap-1">
            @for (tag of item().tags.slice(0, 3); track tag) {
              <span class="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] text-slate-400">{{ tag }}</span>
            }
          </div>
        }

        <!-- Buy links -->
        @if (item().buyLinks.length > 0) {
          <div class="flex flex-wrap gap-1 mt-1">
            @for (link of item().buyLinks; track link.url) {
              <a
                [href]="link.url"
                target="_blank"
                rel="noopener noreferrer"
                class="flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5
                       text-[9px] font-semibold text-primary hover:bg-primary/20 transition-colors"
                (click)="$event.stopPropagation()"
              >
                <span class="material-symbols-outlined text-[10px]">shopping_bag</span>
                {{ link.platform }}
              </a>
            }
          </div>
        }
      </div>
    </div>
  `,
})
export class DiscoverCardComponent {
  item = input.required<ScrapedItem>();
  cardClicked = output<ScrapedItem>();
  feedbackSent = output<{ itemId: string; signal: 'up' | 'down'; galleryImageIndex?: number }>();

  voted = signal<'up' | 'down' | null>(null);
  private readonly scoreDelta = signal(0);

  // Platform score = our scoreSignal ± user's current vote delta
  readonly localPlatformScore = computed(() => this.item().scoreSignal + this.scoreDelta());

  onVote(signal: 'up' | 'down', galleryImageIndex?: number) {
    const prev = this.voted();
    if (prev === signal) return; // already voted same way — no-op

    let prevDelta = 0;
    if (prev === 'up') {
      prevDelta = 1;
    } else if (prev === 'down') {
      prevDelta = -1;
    }
    const newDelta = signal === 'up' ? 1 : -1;
    this.scoreDelta.update(d => d - prevDelta + newDelta);
    this.voted.set(signal);
    this.feedbackSent.emit({ itemId: this.item().id, signal, galleryImageIndex });
  }

  sourceBadgeClass() {
    return this.item().sourceType === 'reddit'
      ? 'bg-orange-900/70 text-orange-300'
      : 'bg-blue-900/70 text-blue-300';
  }

  onImgError(event: Event) {
    (event.target as HTMLImageElement).src =
      'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect fill="%2318181b"/></svg>';
  }
}
