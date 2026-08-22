import { Component, input } from '@angular/core';

@Component({
  selector: 'app-stat-card',
  standalone: true,
  imports: [],
  template: `
    <div class="flex-1 min-w-[180px] rounded-lg border border-border-chrome bg-card-dark/95 p-5">
      <p class="mb-1 text-[10px] uppercase tracking-[0.18em] text-app-soft font-medium">{{ label() }}</p>
      <h4 class="text-3xl font-semibold font-mono tracking-tight" [class]="valueClass()">{{ value() }}</h4>
      @if (trend()) {
        <div class="mt-2 flex items-center gap-1 text-xs text-success">
          <span class="material-symbols-outlined" style="font-size:14px">trending_up</span>
          <span>{{ trend() }}</span>
        </div>
      } @else if (subtext()) {
        <p class="mt-2 text-xs text-app-soft">{{ subtext() }}</p>
      }
    </div>
  `,
})
export class StatCardComponent {
  label = input.required<string>();
  value = input.required<string>();
  subtext = input<string | null>(null);
  trend = input<string | null>(null);
  /** Optional extra Tailwind classes for the value text, e.g. "text-primary" */
  valueClass = input<string>('text-slate-100');
}
