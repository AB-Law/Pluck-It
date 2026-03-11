import {
  Component,
  ElementRef,
  HostListener,
  ViewChild,
  input,
  model,
  output,
} from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Reusable dual-thumb range slider.
 * Emits valueChange with [low, high] numbers.
 */
@Component({
  selector: 'app-range-slider',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="relative h-5 flex items-center select-none" #track (mousedown)="onTrackDown($event)">
      <!-- Background rail -->
      <div class="absolute inset-y-0 flex items-center w-full">
        <div class="relative h-1 w-full rounded-full bg-border-chrome">
          <!-- Active fill -->
          <div
            class="absolute h-full rounded-full bg-primary transition-all"
            [style.left.%]="lowPct"
            [style.width.%]="highPct - lowPct"
          ></div>
          <!-- Low thumb -->
          <div
            class="absolute top-1/2 -translate-y-1/2 h-3 w-3 rounded-full border-2 border-primary bg-black cursor-pointer z-10"
            [style.left.%]="lowPct"
            style="transform: translate(-50%, -50%)"
            (mousedown)="startDrag($event, 'low')"
          ></div>
          <!-- High thumb -->
          <div
            class="absolute top-1/2 -translate-y-1/2 h-3 w-3 rounded-full border-2 border-primary bg-black cursor-pointer z-10"
            [style.left.%]="highPct"
            style="transform: translate(-50%, -50%)"
            (mousedown)="startDrag($event, 'high')"
          ></div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
  `],
})
export class RangeSliderComponent {
  min   = input<number>(0);
  max   = input<number>(100);
  step  = input<number>(1);
  value = model<[number, number]>([0, 100]);

  valueChange = output<[number, number]>();

  @ViewChild('track', { static: true }) trackRef!: ElementRef<HTMLDivElement>;

  private dragging: 'low' | 'high' | null = null;

  get lowPct(): number  {
    const range = this.max() - this.min();
    if (range <= 0) return 0;
    return ((this.value()[0] - this.min()) / range) * 100;
  }
  get highPct(): number {
    const range = this.max() - this.min();
    if (range <= 0) return 0;
    return ((this.value()[1] - this.min()) / range) * 100;
  }

  startDrag(e: MouseEvent, thumb: 'low' | 'high'): void {
    e.preventDefault();
    e.stopPropagation();
    this.dragging = thumb;
  }

  @HostListener('document:mousemove', ['$event'])
  onMouseMove(e: MouseEvent): void {
    if (!this.dragging) return;
    const rect = this.trackRef.nativeElement.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const range = this.max() - this.min();
    const stepped = Math.round((ratio * range) / this.step()) * this.step() + this.min();
    const [low, high] = this.value();

    if (this.dragging === 'low') {
      const newLow = Math.max(this.min(), Math.min(stepped, high - this.step()));
      this.value.set([newLow, high]);
      this.valueChange.emit([newLow, high]);
    } else {
      const newHigh = Math.min(this.max(), Math.max(stepped, low + this.step()));
      this.value.set([low, newHigh]);
      this.valueChange.emit([low, newHigh]);
    }
  }

  @HostListener('document:mouseup')
  onMouseUp(): void { this.dragging = null; }

  onTrackDown(e: MouseEvent): void {
    if ((e.target as HTMLElement).tagName === 'DIV' && this.dragging === null) {
      const rect = this.trackRef.nativeElement.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const range = this.max() - this.min();
      const stepped = Math.round((ratio * range) / this.step()) * this.step() + this.min();
      const [low, high] = this.value();
      const midpoint = (low + high) / 2;
      if (stepped < midpoint) {
        const newLow = Math.max(this.min(), Math.min(stepped, high - this.step()));
        this.value.set([newLow, high]);
        this.valueChange.emit([newLow, high]);
        this.dragging = 'low';
      } else {
        const newHigh = Math.min(this.max(), Math.max(stepped, low + this.step()));
        this.value.set([low, newHigh]);
        this.valueChange.emit([low, newHigh]);
        this.dragging = 'high';
      }
    }
  }
}
