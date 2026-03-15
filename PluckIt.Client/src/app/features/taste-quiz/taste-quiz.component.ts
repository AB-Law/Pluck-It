import { Component, OnInit, signal, computed, inject } from '@angular/core';

import { RouterModule } from '@angular/router';
import { TasteQuizService } from '../../core/services/taste-quiz.service';
import { QuizCard, QuizSession, TasteProfile } from '../../core/models/scraped-item.model';
import { QuizResultsComponent } from './quiz-results.component';

type SwipeDir = 'up' | 'down' | null;

@Component({
  selector: 'app-taste-quiz',
  standalone: true,
  imports: [RouterModule, QuizResultsComponent],
  styles: [
    `
      @keyframes swipe-out-up {
        to {
          transform: translateY(-100%) rotate(-8deg);
          opacity: 0;
        }
      }
      @keyframes swipe-out-down {
        to {
          transform: translateY(100%) rotate(8deg);
          opacity: 0;
        }
      }
      @keyframes card-in {
        from {
          transform: scale(0.92) translateY(20px);
          opacity: 0;
        }
        to {
          transform: scale(1) translateY(0);
          opacity: 1;
        }
      }
      .card-in {
        animation: card-in 0.3s cubic-bezier(0.23, 1, 0.32, 1) both;
      }
      .like-out {
        animation: swipe-out-up 0.35s cubic-bezier(0.55, 0, 1, 0.45) forwards;
      }
      .skip-out {
        animation: swipe-out-down 0.35s cubic-bezier(0.55, 0, 1, 0.45) forwards;
      }
    `,
  ],
  template: `
    <div class="relative flex min-h-screen flex-col items-center bg-black text-slate-100 px-4 py-6">
      <!-- Back / close -->
      <div class="flex w-full max-w-sm items-center justify-between mb-6">
        <a routerLink="/discover" class="text-slate-500 hover:text-slate-300 transition-colors">
          <span class="material-symbols-outlined">arrow_back</span>
        </a>
        <span class="text-xs font-bold uppercase tracking-widest text-slate-500"
          >Style Calibration</span
        >
        <div class="w-6"></div>
      </div>

      <!-- Show results when done -->
      @if (tasteProfile()) {
        <app-quiz-results [profile]="tasteProfile()!" (retake)="onRetake()" />
      } @else if (loading()) {
        <div class="flex flex-col items-center justify-center flex-1 gap-4">
          <span class="material-symbols-outlined text-4xl text-slate-600 animate-spin"
            >progress_activity</span
          >
          <p class="text-xs text-slate-500">Loading your style quiz…</p>
        </div>
      } @else if (session()) {
        <!-- Progress bar -->
        <div class="w-full max-w-sm mb-4">
          <div class="flex items-center justify-between mb-1.5">
            <span class="text-[10px] text-slate-500"
              >{{ currentIndex() + 1 }} / {{ itemCount() }}</span
            >
            <span class="text-[10px] text-slate-500">Phase {{ session()!.phase }}</span>
          </div>
          <div class="h-1 w-full rounded-full bg-zinc-800">
            <div
              class="h-1 rounded-full bg-primary transition-all duration-300"
              [style.width.%]="progressPct()"
            ></div>
          </div>
        </div>

        <!-- Card stack -->
        <div class="relative w-full max-w-sm flex-1 flex flex-col items-center justify-center">
          @if (currentCard()) {
            <!-- Background hint card -->
            <div
              class="absolute inset-x-4 top-2 h-full rounded-2xl bg-zinc-900 border border-border-chrome scale-95 opacity-40"
            ></div>

            <!-- Main card -->
            <div
              class="relative w-full rounded-2xl border border-border-chrome bg-zinc-950 overflow-hidden shadow-xl"
              [class]="cardAnimClass()"
              [style.transform]="cardTransform()"
              style="touch-action: none;"
              (pointerdown)="onCardPointerDown($event)"
              (pointermove)="onCardPointerMove($event)"
              (pointerup)="onCardPointerUp()"
              (pointercancel)="onCardPointerCancel()"
            >
              <!-- Phase 1: mood card (text) -->
              @if (session()!.phase === 1) {
                <div class="flex flex-col items-center justify-center gap-4 p-8 min-h-[340px]">
                  <span class="material-symbols-outlined text-5xl text-primary">style</span>
                  <h2 class="text-xl font-bold text-center">{{ currentCard()!.primaryMood }}</h2>
                  @if (currentCard()!.title !== currentCard()!.primaryMood) {
                    <p class="text-xs text-slate-400 text-center">{{ currentCard()!.title }}</p>
                  }
                  <div class="flex flex-wrap justify-center gap-1.5 mt-2">
                    @for (tag of currentCard()!.tags.slice(0, 5); track tag) {
                      <span
                        class="rounded-full bg-zinc-800 px-2.5 py-1 text-[10px] text-slate-400"
                        >{{ tag }}</span
                      >
                    }
                  </div>
                </div>
              } @else {
                <!-- Phase 2: image card -->
                <div class="relative w-full" style="padding-bottom: 125%">
                  <img
                    [src]="currentCard()!.imageUrl"
                    [alt]="currentCard()!.title"
                    class="absolute inset-0 w-full h-full object-cover"
                    (error)="onImgError($event)"
                  />
                  <!-- Gradient overlay -->
                  <div
                    class="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent"
                  ></div>
                  <div class="absolute bottom-0 left-0 right-0 p-4">
                    <p class="text-xs font-semibold text-slate-200 line-clamp-2">
                      {{ currentCard()!.title }}
                    </p>
                    <div class="flex flex-wrap gap-1 mt-1">
                      @for (tag of currentCard()!.tags.slice(0, 3); track tag) {
                        <span class="rounded bg-black/50 px-1.5 py-0.5 text-[9px] text-slate-300">{{
                          tag
                        }}</span>
                      }
                    </div>
                  </div>
                </div>
              }
            </div>

            <!-- Like/Skip buttons -->
            <div class="flex items-center justify-center gap-8 mt-8">
              <!-- Skip / dislike -->
              <button
                class="flex h-16 w-16 items-center justify-center rounded-full border-2 border-rose-700/50 bg-rose-900/20
                       text-rose-400 hover:bg-rose-900/40 active:scale-95 transition-all"
                (click)="onChoice('down')"
                [disabled]="responding()"
              >
                <span class="material-symbols-outlined text-2xl">thumb_down</span>
              </button>

              <!-- Like -->
              <button
                class="flex h-16 w-16 items-center justify-center rounded-full border-2 border-emerald-600/50 bg-emerald-900/20
                       text-emerald-400 hover:bg-emerald-900/40 active:scale-95 transition-all"
                (click)="onChoice('up')"
                [disabled]="responding()"
              >
                <span class="material-symbols-outlined text-2xl">thumb_up</span>
              </button>
            </div>

            <!-- Hint labels -->
            <div class="flex items-center justify-center gap-24 mt-2">
              <span class="text-[10px] text-slate-600">Skip</span>
              <span class="text-[10px] text-slate-600">Love it</span>
            </div>
          } @else {
            <!-- All done — completing -->
            <div class="flex flex-col items-center justify-center flex-1 gap-4">
              <span class="material-symbols-outlined text-4xl text-primary animate-spin"
                >progress_activity</span
              >
              <p class="text-xs text-slate-500">Building your taste profile…</p>
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class TasteQuizComponent implements OnInit {
  private readonly quizService = inject(TasteQuizService);

  protected loading = signal(true);
  protected responding = signal(false);
  protected session = signal<QuizSession | null>(null);
  protected currentIndex = signal(0);
  protected tasteProfile = signal<TasteProfile | null>(null);
  protected swipeDir = signal<SwipeDir>(null);
  protected dragOffsetY = signal(0);
  protected dragging = signal(false);
  private dragStartY = 0;
  private readonly swipeThreshold = 90;

  readonly currentCard = computed<QuizCard | null>(() => {
    const s = this.session();
    if (!s) return null;
    const idx = this.currentIndex();
    return idx < s.items.length ? s.items[idx] : null;
  });

  readonly progressPct = computed(() => {
    const s = this.session();
    const items = s?.items;
    const count = Array.isArray(items) ? items.length : 0;
    if (!count) return 0;
    return Math.round((this.currentIndex() / count) * 100);
  });

  readonly itemCount = computed(() => {
    const s = this.session();
    const items = s?.items;
    return Array.isArray(items) ? items.length : 0;
  });

  readonly cardAnimClass = computed(() => {
    const d = this.swipeDir();
    if (d === 'up') return 'like-out';
    if (d === 'down') return 'skip-out';
    return 'card-in';
  });

  readonly cardTransform = computed(() => {
    const y = this.dragOffsetY();
    if (!y) return '';
    const rot = Math.max(-10, Math.min(10, y / 14));
    return `translateY(${y}px) rotate(${rot}deg)`;
  });

  ngOnInit() {
    this.quizService.getOrCreateSession().subscribe({
      next: (session) => {
        this.session.set(session);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  respond(signal: 'up' | 'down') {
    const s = this.session();
    const card = this.currentCard();
    if (!s || !card || this.responding()) return;

    this.responding.set(true);
    this.swipeDir.set(signal);

    const payload =
      s.phase === 1
        ? { cardPrimaryMood: card.primaryMood ?? card.title, signal }
        : { scrapedItemId: card.id, signal };

    this.quizService.respond(s.id, payload).subscribe({
      next: () => this.advanceCard(),
      error: () => {
        this.dragOffsetY.set(0);
        this.swipeDir.set(null);
        this.responding.set(false);
      },
    });
  }

  onChoice(signal: 'up' | 'down') {
    this.respond(signal);
  }

  private advanceCard() {
    const s = this.session()!;
    const next = this.currentIndex() + 1;

    // Small delay for animation
    setTimeout(() => {
      this.dragOffsetY.set(0);
      this.swipeDir.set(null);
      this.responding.set(false);

      if (next >= this.itemCount()) {
        // Complete the quiz
        this.quizService.complete(s.id).subscribe({
          next: (profile) => this.tasteProfile.set(profile),
        });
      } else {
        this.currentIndex.set(next);
      }
    }, 350);
  }

  onRetake() {
    this.session.set(null);
    this.tasteProfile.set(null);
    this.currentIndex.set(0);
    this.loading.set(true);
    this.quizService.getOrCreateSession().subscribe({
      next: (session) => {
        this.session.set(session);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  onImgError(event: Event) {
    (event.target as HTMLImageElement).src =
      'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect fill="%2318181b"/></svg>';
  }

  onCardPointerDown(event: PointerEvent) {
    if (this.responding()) return;
    this.dragging.set(true);
    this.dragStartY = event.clientY;
  }

  onCardPointerMove(event: PointerEvent) {
    if (!this.dragging() || this.responding()) return;
    this.dragOffsetY.set(event.clientY - this.dragStartY);
  }

  onCardPointerUp() {
    if (!this.dragging() || this.responding()) return;
    this.dragging.set(false);
    const dy = this.dragOffsetY();
    if (dy <= -this.swipeThreshold) {
      this.respond('up');
      return;
    }
    if (dy >= this.swipeThreshold) {
      this.respond('down');
      return;
    }
    this.dragOffsetY.set(0);
  }

  onCardPointerCancel() {
    this.dragging.set(false);
    if (!this.responding()) this.dragOffsetY.set(0);
  }
}
