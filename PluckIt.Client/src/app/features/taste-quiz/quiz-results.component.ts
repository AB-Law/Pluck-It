import { Component, Input, Output, EventEmitter } from '@angular/core';

import { RouterModule } from '@angular/router';
import { TasteProfile } from '../../core/models/scraped-item.model';

@Component({
  selector: 'app-quiz-results',
  standalone: true,
  imports: [RouterModule],
  styles: [
    `
      @keyframes fade-up {
        from {
          opacity: 0;
          transform: translateY(24px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      .fade-up {
        animation: fade-up 0.5s cubic-bezier(0.23, 1, 0.32, 1) both;
      }
    `,
  ],
  template: `
    <div
      class="flex flex-col items-center justify-start min-h-screen bg-black text-slate-100 px-6 py-10 gap-8 fade-up"
    >
      <!-- Icon -->
      <div class="rounded-full bg-primary/10 border border-primary/30 p-5">
        <span class="material-symbols-outlined text-4xl text-primary">psychology</span>
      </div>

      <div class="text-center space-y-1">
        <h1 class="text-xl font-bold">Your Style Profile</h1>
        <p class="text-xs text-slate-500">Based on your taste calibration</p>
      </div>

      <!-- Style keywords -->
      @if (profile.styleKeywords.length > 0) {
        <div class="w-full max-w-sm space-y-3">
          <p class="text-[10px] font-bold uppercase tracking-widest text-slate-500 text-center">
            Style Signals
          </p>
          <div class="flex flex-wrap justify-center gap-2">
            @for (kw of profile.styleKeywords; track kw; let i = $index) {
              <span
                class="rounded-full border border-primary/40 bg-primary/10 px-4 py-1.5 text-xs font-semibold text-primary"
                [style.animation-delay]="i * 60 + 'ms'"
                style="animation: fade-up 0.4s cubic-bezier(0.23,1,0.32,1) both;"
              >
                {{ kw }}
              </span>
            }
          </div>
        </div>
      }

      <!-- Brands -->
      @if (profile.brands.length > 0) {
        <div class="w-full max-w-sm space-y-3">
          <p class="text-[10px] font-bold uppercase tracking-widest text-slate-500 text-center">
            Favourite Brands
          </p>
          <div class="flex flex-wrap justify-center gap-2">
            @for (brand of profile.brands; track brand) {
              <span
                class="rounded-lg bg-zinc-900 border border-border-chrome px-3 py-1.5 text-xs text-slate-300"
              >
                {{ brand }}
              </span>
            }
          </div>
        </div>
      }

      <!-- Inferred from badge -->
      <div
        class="flex items-center gap-2 rounded-full bg-zinc-900 border border-border-chrome px-4 py-2"
      >
        <span class="material-symbols-outlined text-sm text-slate-500">
          {{ profile.inferredFrom === 'mood_cards' ? 'style' : 'image' }}
        </span>
        <span class="text-[10px] text-slate-500">
          Inferred from
          {{ profile.inferredFrom === 'mood_cards' ? 'mood archetypes' : 'outfit images' }}
        </span>
      </div>

      <!-- CTA -->
      <div class="flex flex-col w-full max-w-sm gap-3 mt-auto">
        <a
          routerLink="/discover"
          class="flex items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-bold
                 text-black hover:bg-primary/80 transition-colors"
        >
          <span class="material-symbols-outlined text-base">explore</span>
          Explore Your Feed
        </a>
        <button
          class="flex items-center justify-center gap-2 rounded-xl border border-border-chrome py-3 text-sm
                 text-slate-400 hover:text-slate-100 transition-colors"
          (click)="retake.emit()"
        >
          Retake Quiz
        </button>
      </div>
    </div>
  `,
})
export class QuizResultsComponent {
  @Input({ required: true }) profile!: TasteProfile;
  @Output() retake = new EventEmitter<void>();
}
