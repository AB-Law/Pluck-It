import { CommonModule } from '@angular/common';
import { Component, computed, input, signal } from '@angular/core';
import { WearHistoryRecord, WearHistorySummary } from '../../core/models/clothing-item.model';

interface CalendarDay {
  date: Date;
  key: string;
  inMonth: boolean;
  wearCount: number;
}

@Component({
  selector: 'app-wear-history-calendar',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="rounded-lg border border-border-chrome bg-card-dark p-3">
      <div class="mb-3 flex items-center justify-between">
        <button class="text-slate-400 hover:text-white" (click)="shiftMonth(-1)">
          <span class="material-symbols-outlined text-sm">chevron_left</span>
        </button>
        <p class="text-xs font-mono text-slate-300">{{ monthLabel() }}</p>
        <button class="text-slate-400 hover:text-white" (click)="shiftMonth(1)">
          <span class="material-symbols-outlined text-sm">chevron_right</span>
        </button>
      </div>

      <div class="mb-1 grid grid-cols-7 gap-1 text-[10px] font-mono text-slate-500">
        @for (d of ['Su','Mo','Tu','We','Th','Fr','Sa']; track d) {
          <div class="text-center">{{ d }}</div>
        }
      </div>
      <div class="grid grid-cols-7 gap-1">
        @for (d of calendarDays(); track d.key) {
          <div
            class="aspect-square rounded border text-center text-[10px] font-mono flex items-center justify-center"
            [ngClass]="d.inMonth ? 'border-[#2f2f2f] text-slate-300' : 'border-transparent text-slate-600'"
            [style.background]="d.wearCount > 0 ? 'rgba(37,141,244,0.15)' : 'transparent'"
            [title]="d.wearCount > 0 ? (d.wearCount + ' wear' + (d.wearCount > 1 ? 's' : '')) : ''"
          >
            {{ d.date.getDate() }}
          </div>
        }
      </div>

      @if (summary()?.legacyUntrackedCount && summary()!.legacyUntrackedCount > 0) {
        <p class="mt-3 text-[10px] font-mono text-slate-500">
          Pre-tracking wears: {{ summary()!.legacyUntrackedCount }}
        </p>
      }
    </div>
  `,
})
export class WearHistoryCalendarComponent {
  events = input<WearHistoryRecord[]>([]);
  summary = input<WearHistorySummary | null>(null);

  private readonly monthOffset = signal(0);

  readonly monthStart = computed(() => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + this.monthOffset(), 1));
  });

  readonly monthLabel = computed(() =>
    this.monthStart().toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }));

  readonly dayCountMap = computed(() => {
    const map = new Map<string, number>();
    for (const ev of this.events()) {
      const key = this.toKey(new Date(ev.occurredAt));
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  });

  readonly calendarDays = computed<CalendarDay[]>(() => {
    const start = this.monthStart();
    const month = start.getUTCMonth();
    const firstDow = start.getUTCDay();
    const daysInMonth = new Date(Date.UTC(start.getUTCFullYear(), month + 1, 0)).getUTCDate();

    const cells: CalendarDay[] = [];
    for (let i = 0; i < firstDow; i++) {
      const d = new Date(Date.UTC(start.getUTCFullYear(), month, i - firstDow + 1));
      cells.push({ date: d, key: this.toKey(d), inMonth: false, wearCount: 0 });
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(Date.UTC(start.getUTCFullYear(), month, day));
      const key = this.toKey(d);
      cells.push({ date: d, key, inMonth: true, wearCount: this.dayCountMap().get(key) ?? 0 });
    }
    while (cells.length % 7 !== 0) {
      const last = cells.at(-1);
      if (!last) break;
      const { date: lastDate } = last;
      const d = new Date(Date.UTC(lastDate.getUTCFullYear(), lastDate.getUTCMonth(), lastDate.getUTCDate() + 1));
      cells.push({ date: d, key: this.toKey(d), inMonth: false, wearCount: 0 });
    }
    return cells;
  });

  shiftMonth(delta: number): void {
    this.monthOffset.update(v => v + delta);
  }

  private toKey(date: Date): string {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}

