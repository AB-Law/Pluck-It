import { Component, EventEmitter, effect, OnInit, Output, signal, inject } from '@angular/core';
import { DigestService } from '../../core/services/digest.service';
import { FeedbackSignal, WardrobeDigest, DigestSuggestion } from '../../core/models/digest.model';
import {
  OfflineQueueService,
  OfflineQueuedAction,
} from '../../core/services/offline-queue.service';
import { NetworkService } from '../../core/services/network.service';
import { showOfflineBlockMessage } from '../../shared/offline-message';
import { firstValueFrom } from 'rxjs';

interface OfflineDigestFeedbackPayload {
  digestId: string;
  suggestionIndex: number;
  suggestionDescription?: string;
  signal: FeedbackSignal;
  retryCount?: number;
}

@Component({
  selector: 'app-digest-panel',
  standalone: true,
  imports: [],
  styles: [
    `
      @keyframes slide-in {
        from {
          transform: translateX(100%);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
      .panel-animate {
        animation: slide-in 0.22s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
      }
    `,
  ],
  template: `
    <!-- Backdrop -->
    <div
      class="fixed inset-0 z-50"
      style="background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);"
      (click)="closed.emit()"
    ></div>

    <!-- Slide-over panel -->
    <aside
      class="panel-animate fixed top-0 right-0 z-50 h-full w-full max-w-full md:max-w-sm bg-black border-l border-[#1F1F1F] flex flex-col shadow-2xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="digest-panel-title"
      (click)="$event.stopPropagation()"
    >
      <!-- Header -->
      <div class="flex items-center justify-between px-4 py-4 border-b border-[#1F1F1F] shrink-0">
        <div>
          <h2
            id="digest-panel-title"
            class="text-white font-bold text-base uppercase tracking-tight"
          >
            Weekly Digest
          </h2>
          <p class="text-xs text-slate-500 font-mono mt-0.5">AI-curated purchase suggestions</p>
        </div>
        <button
          class="touch-target h-10 w-10 flex items-center justify-center rounded-lg text-slate-500 hover:text-white transition-colors"
          (click)="closed.emit()"
          aria-label="Close"
        >
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>

      <!-- Body -->
      <div class="flex-1 overflow-y-auto px-4 py-5 md:px-6 md:py-6">
        @if (loading()) {
          <div class="flex flex-col items-center gap-3 py-12 text-slate-500">
            <span class="material-symbols-outlined animate-spin text-primary" style="font-size:32px"
              >progress_activity</span
            >
            <span class="text-xs font-mono">Loading digest…</span>
          </div>
        } @else if (loadError()) {
          <div class="text-red-400 text-sm font-mono py-4">{{ loadError() }}</div>
        } @else if (!digest()) {
          <div class="flex flex-col items-center gap-3 py-12 text-slate-500">
            <span class="material-symbols-outlined" style="font-size:40px">auto_awesome</span>
            <p class="text-sm text-center font-mono">
              No digest yet. Add items to your wardrobe and check back next Monday.
            </p>
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
                    <p
                      class="mt-2 text-[11px] font-mono text-slate-400 leading-relaxed border-l-2 border-primary/40 pl-3"
                    >
                      {{ s.rationale }}
                    </p>
                  }
                </div>

                <!-- Feedback buttons -->
                <div class="flex items-center gap-2">
                  <button
                    type="button"
                    class="touch-target flex items-center gap-1 h-10 px-3 rounded-lg border transition-colors text-xs font-mono"
                    [class]="
                      feedbackSent()[i] === 'up'
                        ? 'bg-green-900/30 border-green-700 text-green-400'
                        : 'border-[#1F1F1F] text-slate-500 hover:border-green-700 hover:text-green-400'
                    "
                    (click)="sendFeedback(i, s, 'up')"
                    [disabled]="feedbackSent()[i] !== null"
                    title="Good suggestion"
                  >
                    <span class="material-symbols-outlined" style="font-size:14px">thumb_up</span>
                    <span class="hidden sm:inline">Good pick</span>
                  </button>

                  <button
                    type="button"
                    class="touch-target flex items-center gap-1 h-10 px-3 rounded-lg border transition-colors text-xs font-mono"
                    [class]="
                      feedbackSent()[i] === 'down'
                        ? 'bg-red-900/30 border-red-700 text-red-400'
                        : 'border-[#1F1F1F] text-slate-500 hover:border-red-700 hover:text-red-400'
                    "
                    (click)="sendFeedback(i, s, 'down')"
                    [disabled]="feedbackSent()[i] !== null"
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
  private readonly digestService = inject(DigestService);
  private readonly offlineQueue = inject(OfflineQueueService);
  private readonly networkService = inject(NetworkService);

  @Output() closed = new EventEmitter<void>();

  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly digest = signal<WardrobeDigest | null>(null);
  readonly rationaleOpen = signal<boolean[]>([]);
  readonly feedbackSent = signal<(string | null)[]>([]);

  private _isDrainingFeedback = false;
  private readonly _MAX_OFFLINE_FEEDBACK_RETRIES = 3;

  constructor() {
    effect(() => {
      if (this.networkService.isCurrentlyOnline()) {
        queueMicrotask(() => void this._drainOfflineDigestFeedback());
      }
    });
  }

  ngOnInit(): void {
    this.digestService.getLatest().subscribe({
      next: (res) => {
        this.digest.set(res.digest);
        const len = res.digest?.suggestions.length ?? 0;
        this.rationaleOpen.set(new Array(len).fill(false));
        const blank: (string | null)[] = new Array(len).fill(null);
        this.feedbackSent.set(blank);
        this.loading.set(false);

        // Restore any feedback the user already gave for this digest
        if (res.digest) {
          this.digestService.getFeedback(res.digest.id).subscribe({
            next: (fb) => {
              this.feedbackSent.update((arr) => {
                const copy = [...arr];
                for (const entry of fb.feedback) {
                  copy[entry.suggestionIndex] = entry.signal;
                }
                return copy;
              });
            },
          });
        }
        queueMicrotask(() => void this._drainOfflineDigestFeedback());
      },
      error: (err) => {
        this.loadError.set(err?.error?.detail ?? 'Could not load digest.');
        this.loading.set(false);
      },
    });
  }

  toggleRationale(index: number): void {
    this.rationaleOpen.update((arr) => {
      const copy = [...arr];
      copy[index] = !copy[index];
      return copy;
    });
  }

  sendFeedback(index: number, suggestion: DigestSuggestion, signal: 'up' | 'down'): void {
    const d = this.digest();
    if (!d) return;

    const payload = {
      digestId: d.id,
      suggestionIndex: index,
      suggestionDescription: suggestion.item,
      signal,
      retryCount: 0,
    };

    this.feedbackSent.update((arr) => {
      const copy = [...arr];
      copy[index] = signal;
      return copy;
    });

    if (!this.networkService.isCurrentlyOnline()) {
      this.offlineQueue.enqueue('digest/feedback', payload);
      this.loadError.set(
        showOfflineBlockMessage(
          'Digest feedback',
          'Your response was queued and will send when you reconnect.',
        ),
      );
      return;
    }

    this.digestService.sendFeedback(payload).subscribe({
      error: () => {
        // Revert on failure
        this.feedbackSent.update((arr) => {
          const copy = [...arr];
          copy[index] = null;
          return copy;
        });
      },
    });
  }

  private async _drainOfflineDigestFeedback(): Promise<void> {
    if (this._isDrainingFeedback || !this.networkService.isCurrentlyOnline()) {
      return;
    }

    this._isDrainingFeedback = true;
    try {
      const actions = this.offlineQueue.drain();
      const nextActions: OfflineQueuedAction[] = actions.filter(
        (action) => action.type !== 'digest/feedback',
      );

      for (const action of actions) {
        if (action.type !== 'digest/feedback') {
          continue;
        }

        const payload = this._parseQueuedDigestPayload(action.payload);
        if (!payload) {
          continue;
        }

        const sent = await this._sendQueuedFeedback(payload);
        if (!sent) {
          const retryCount = (payload.retryCount ?? 0) + 1;
          if (retryCount <= this._MAX_OFFLINE_FEEDBACK_RETRIES) {
            nextActions.push({
              ...action,
              payload: {
                ...payload,
                retryCount,
              },
              timestamp: Date.now(),
            });
          }
        }
      }

      this.offlineQueue.persistOfflineUploads(nextActions);
    } finally {
      this._isDrainingFeedback = false;
    }
  }

  private _parseQueuedDigestPayload(payload: unknown): OfflineDigestFeedbackPayload | null {
    if (!payload || typeof payload !== 'object') return null;
    const value = payload as Partial<OfflineDigestFeedbackPayload>;
    if (typeof value.digestId !== 'string' || typeof value.suggestionIndex !== 'number')
      return null;
    if (value.signal !== 'up' && value.signal !== 'down') return null;
    if (
      value.suggestionDescription !== undefined &&
      typeof value.suggestionDescription !== 'string'
    ) {
      return null;
    }
    if (value.retryCount !== undefined && typeof value.retryCount !== 'number') return null;

    return {
      digestId: value.digestId,
      suggestionIndex: value.suggestionIndex,
      suggestionDescription: value.suggestionDescription,
      signal: value.signal,
      retryCount: value.retryCount,
    };
  }

  private async _sendQueuedFeedback(payload: OfflineDigestFeedbackPayload): Promise<boolean> {
    try {
      await firstValueFrom(
        this.digestService.sendFeedback({
          digestId: payload.digestId,
          suggestionIndex: payload.suggestionIndex,
          suggestionDescription: payload.suggestionDescription,
          signal: payload.signal,
        }),
      );

      if (this.digest()?.id === payload.digestId) {
        this.feedbackSent.update((arr) => {
          const copy = [...arr];
          if (payload.suggestionIndex >= 0 && payload.suggestionIndex < copy.length) {
            copy[payload.suggestionIndex] = payload.signal;
          }
          return copy;
        });
      }
      return true;
    } catch {
      return false;
    }
  }

  formatDate(iso: string): string {
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return iso;
    }
  }
}
