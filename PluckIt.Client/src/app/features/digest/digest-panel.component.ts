import {
  Component,
  EventEmitter,
  OnInit,
  Output,
  signal,
} from '@angular/core';
import { DigestService } from '../../core/services/digest.service';
import { WardrobeDigest, DigestSuggestion } from '../../core/models/digest.model';

@Component({
  selector: 'app-digest-panel',
  standalone: true,
  imports: [],
  styles: [`
    @keyframes slide-in {
      from { transform: translateX(100%); opacity: 0; }
      to   { transform: translateX(0);    opacity: 1; }
    }
    .panel-animate {
      animation: slide-in 0.22s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
    }
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
      role="dialog" aria-modal="true" aria-labelledby="digest-panel-title"
      (click)="$event.stopPropagation()"
    >
      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-5 border-b border-[#1F1F1F] shrink-0">
        <div>
          <h2 id="digest-panel-title" class="text-white font-bold text-base uppercase tracking-tight">Weekly Digest</h2>
          <p class="text-xs text-slate-500 font-mono mt-0.5">AI-curated purchase suggestions</p>
        </div>
        <button class="text-slate-500 hover:text-white transition-colors" (click)="closed.emit()" aria-label="Close">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>

      <!-- Body -->
      <div class="flex-1 overflow-y-auto px-6 py-6">

        @if (loading()) {
          <div class="flex flex-col items-center gap-3 py-12 text-slate-500">
            <span class="material-symbols-outlined animate-spin text-primary" style="font-size:32px">progress_activity</span>
            <span class="text-xs font-mono">Loading digest…</span>
          </div>
        } @else if (loadError()) {
          <div class="text-red-400 text-sm font-mono py-4">{{ loadError() }}</div>
        } @else if (!digest()) {
          <div class="flex flex-col items-center gap-3 py-12 text-slate-500">
            <span class="material-symbols-outlined" style="font-size:40px">auto_awesome</span>
            <p class="text-sm text-center font-mono">No digest yet. Add items to your wardrobe and check back next Monday.</p>
          </div>
        } @else {

          <!-- Digest metadata -->
          <div class="mb-5 text-[11px] font-mono text-slate-600 space-y-0.5">
            <p>Generated {{ formatDate(digest()!.generatedAt) }}</p>
            <p>{{ digest()!.totalItems }} items · {{ digest()!.itemsWithWearHistory ?? 0 }} worn</p>
            @if (digest()!.climateZone) {
              <p>Climate: {{ digest()!.climateZone }}</p>
            }
          </div>

          <!-- Suggestion cards -->
          <div class="space-y-4">
            @for (s of digest()!.suggestions; track $index; let i = $index) {
              <div class="border border-[#1F1F1F] rounded-xl p-4 space-y-3">

                <!-- Item description -->
                <p class="text-white text-sm leading-relaxed">{{ s.item }}</p>

                <!-- Why this? collapsible -->
                <div>
                  <button
                    type="button"
                    class="flex items-center gap-1.5 text-[11px] font-mono text-slate-500 hover:text-primary transition-colors"
                    (click)="toggleRationale(i)"
                    [attr.aria-expanded]="rationaleOpen()[i]"
                  >
                    <span class="material-symbols-outlined" style="font-size:14px">
                      {{ rationaleOpen()[i] ? 'expand_less' : 'expand_more' }}
                    </span>
                    Why this?
                  </button>

                  @if (rationaleOpen()[i]) {
                    <p class="mt-2 text-[11px] font-mono text-slate-400 leading-relaxed border-l-2 border-primary/40 pl-3">
                      {{ s.rationale }}
                    </p>
                  }
                </div>

                <!-- Feedback buttons -->
                <div class="flex items-center gap-2">
                  <button
                    type="button"
                    class="flex items-center gap-1 h-8 px-3 rounded-lg border transition-colors text-xs font-mono"
                    [class]="feedbackSent()[i] === 'up'
                      ? 'bg-green-900/30 border-green-700 text-green-400'
                      : 'border-[#1F1F1F] text-slate-500 hover:border-green-700 hover:text-green-400'"
                    (click)="sendFeedback(i, s, 'up')"
                    [disabled]="feedbackSent()[i] != null"
                    title="Good suggestion"
                  >
                    <span class="material-symbols-outlined" style="font-size:14px">thumb_up</span>
                    <span class="hidden sm:inline">Good pick</span>
                  </button>

                  <button
                    type="button"
                    class="flex items-center gap-1 h-8 px-3 rounded-lg border transition-colors text-xs font-mono"
                    [class]="feedbackSent()[i] === 'down'
                      ? 'bg-red-900/30 border-red-700 text-red-400'
                      : 'border-[#1F1F1F] text-slate-500 hover:border-red-700 hover:text-red-400'"
                    (click)="sendFeedback(i, s, 'down')"
                    [disabled]="feedbackSent()[i] != null"
                    title="Not for me"
                  >
                    <span class="material-symbols-outlined" style="font-size:14px">thumb_down</span>
                    <span class="hidden sm:inline">Not for me</span>
                  </button>
                </div>

              </div>
            }
          </div>

        }
      </div>
    </aside>
  `,
})
export class DigestPanelComponent implements OnInit {
  @Output() closed = new EventEmitter<void>();

  readonly loading    = signal(true);
  readonly loadError  = signal<string | null>(null);
  readonly digest     = signal<WardrobeDigest | null>(null);
  readonly rationaleOpen = signal<boolean[]>([]);
  readonly feedbackSent  = signal<(string | null)[]>([]);

  constructor(private digestService: DigestService) {}

  ngOnInit(): void {
    this.digestService.getLatest().subscribe({
      next: res => {
        this.digest.set(res.digest);
        const len = res.digest?.suggestions.length ?? 0;
        this.rationaleOpen.set(Array(len).fill(false));
        const blank: (string | null)[] = Array(len).fill(null);
        this.feedbackSent.set(blank);
        this.loading.set(false);

        // Restore any feedback the user already gave for this digest
        if (res.digest) {
          this.digestService.getFeedback(res.digest.id).subscribe({
            next: fb => {
              this.feedbackSent.update(arr => {
                const copy = [...arr];
                for (const entry of fb.feedback) {
                  copy[entry.suggestionIndex] = entry.signal;
                }
                return copy;
              });
            },
          });
        }
      },
      error: err => {
        this.loadError.set(err?.error?.detail ?? 'Could not load digest.');
        this.loading.set(false);
      },
    });
  }

  toggleRationale(index: number): void {
    this.rationaleOpen.update(arr => {
      const copy = [...arr];
      copy[index] = !copy[index];
      return copy;
    });
  }

  sendFeedback(index: number, suggestion: DigestSuggestion, signal: 'up' | 'down'): void {
    const d = this.digest();
    if (!d) return;

    this.feedbackSent.update(arr => {
      const copy = [...arr];
      copy[index] = signal;
      return copy;
    });

    this.digestService.sendFeedback({
      digestId: d.id,
      suggestionIndex: index,
      suggestionDescription: suggestion.item,
      signal,
    }).subscribe({
      error: () => {
        // Revert on failure
        this.feedbackSent.update(arr => {
          const copy = [...arr];
          copy[index] = null;
          return copy;
        });
      },
    });
  }

  formatDate(iso: string): string {
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        day: 'numeric', month: 'short', year: 'numeric'
      });
    } catch {
      return iso;
    }
  }
}
