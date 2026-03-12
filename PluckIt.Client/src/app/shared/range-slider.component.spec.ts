import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RangeSliderComponent } from './range-slider.component';

describe('RangeSliderComponent', () => {
  let fixture: ComponentFixture<RangeSliderComponent>;
  let component: RangeSliderComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RangeSliderComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(RangeSliderComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('min', 0);
    fixture.componentRef.setInput('max', 100);
    fixture.componentRef.setInput('step', 10);
    fixture.componentRef.setInput('value', [20, 80]);
    fixture.detectChanges();
  });

  it('reports percentage position for both thumbs', () => {
    expect(component.lowPct).toBe(20);
    expect(component.highPct).toBe(80);
  });

  it('returns zero percent when range is invalid', () => {
    fixture.componentRef.setInput('min', 100);
    fixture.componentRef.setInput('max', 100);
    fixture.detectChanges();
    expect(component.lowPct).toBe(0);
    expect(component.highPct).toBe(0);
  });

  it('starts dragging on thumb pointerdown', () => {
    const spy = vi.fn();
    const event = { preventDefault: spy, stopPropagation: vi.fn() } as unknown as PointerEvent;
    component.startDrag(event, 'low');
    expect(spy).toHaveBeenCalled();
    expect((component as unknown as { dragging: string | null }).dragging).toBe('low');
  });

  it('moves low thumb with clamped step and emits range', () => {
    let emitted: [number, number] | null = null;
    component.valueChange.subscribe((value) => { emitted = value; });

    component.startDrag({ preventDefault: () => {}, stopPropagation: () => {}, pointerId: 1 } as PointerEvent, 'low');
    vi.spyOn(component.trackRef.nativeElement, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 100,
    } as DOMRect);

    component.onPointerMove({ clientX: 95 } as PointerEvent);
    expect(component.value()).toEqual([70, 80]);
    expect(emitted).toEqual([70, 80]);
  });

  it('moves high thumb and enforces min gap with step', () => {
    let emitted: [number, number] | null = null;
    component.valueChange.subscribe((value) => { emitted = value; });

    component.startDrag({ preventDefault: () => {}, stopPropagation: () => {}, pointerId: 1 } as PointerEvent, 'high');
    vi.spyOn(component.trackRef.nativeElement, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 100,
    } as DOMRect);

    component.onPointerMove({ clientX: 10 } as PointerEvent);
    expect(component.value()).toEqual([20, 30]);
    expect(emitted).toEqual([20, 30]);
  });

  it('chooses low thumb when clicking left half of midpoint and keeps dragging state', () => {
    let emitted: [number, number] | null = null;
    component.valueChange.subscribe((value) => { emitted = value; });

    vi.spyOn(component.trackRef.nativeElement, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 100,
    } as DOMRect);

    component.onTrackDown({
      clientX: 20,
      target: component.trackRef.nativeElement,
      currentTarget: component.trackRef.nativeElement,
      preventDefault: () => {},
      stopPropagation: () => {},
    } as unknown as PointerEvent);
    expect(emitted).toEqual([20, 80]);
    expect((component as unknown as { dragging: string | null }).dragging).toBe('low');
  });

  it('chooses high thumb when clicking right half of midpoint and clears on mouseup', () => {
    let emitted: [number, number] | null = null;
    component.valueChange.subscribe((value) => { emitted = value; });

    vi.spyOn(component.trackRef.nativeElement, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 100,
    } as DOMRect);

    component.onTrackDown({
      clientX: 90,
      target: component.trackRef.nativeElement,
      currentTarget: component.trackRef.nativeElement,
      preventDefault: () => {},
      stopPropagation: () => {},
    } as unknown as PointerEvent);
    expect(emitted).toEqual([20, 90]);
    expect((component as unknown as { dragging: string | null }).dragging).toBe('high');

    component.onPointerUp();
    expect((component as unknown as { dragging: string | null }).dragging).toBe(null);
  });
});
