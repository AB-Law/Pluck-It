import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ClothingCardComponent } from './clothing-card.component';
import { ClothingItem } from '../../core/models/clothing-item.model';

const ITEM: ClothingItem = {
  id: 'item-1',
  imageUrl: '/assets/item-1.jpg',
  tags: ['minimal', 'casual', 'summer'],
  colours: [
    { name: 'Navy', hex: '#001122' },
    { name: 'White', hex: '#FFFFFF' },
  ],
  brand: 'Demo Brand',
  category: 'Outerwear',
  price: null,
  notes: null,
  dateAdded: null,
  wearCount: 1,
  estimatedMarketValue: 75,
  purchaseDate: null,
  condition: null,
};

describe('ClothingCardComponent', () => {
  let component: ClothingCardComponent;
  let fixture: ComponentFixture<ClothingCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ClothingCardComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ClothingCardComponent);
    component = fixture.componentInstance;
    component.item = ITEM;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders selected visual state when selected', () => {
    fixture = TestBed.createComponent(ClothingCardComponent);
    component = fixture.componentInstance;
    component.item = ITEM;
    fixture.componentRef.setInput('selected', true);
    fixture.detectChanges();

    const root = fixture.nativeElement.querySelector('div');
    expect(root?.classList.contains('ring-2')).toBe(true);
    expect(root?.textContent).toContain('check');
  });

  it('does not apply selected visual state when not selected', () => {
    component.selected = false;
    fixture.detectChanges();

    const root = fixture.nativeElement.querySelector('div');
    expect(root?.classList.contains('ring-2')).toBe(false);
    expect(root?.textContent).not.toContain('check');
  });

  it('propagates drag payload on drag start', () => {
    const setData = vi.fn();
    component.onDragStart({ dataTransfer: { setData } } as unknown as DragEvent);
    expect(setData).toHaveBeenCalledWith('text/plain', 'item-1');
    expect(setData).toHaveBeenCalledWith('application/pluckit-item', 'item-1');
  });

  it('emits selected item id and stops propagation on quick toggle click', () => {
    const selectToggled = vi.fn();
    component.selectToggled.subscribe(selectToggled);

    const event = new MouseEvent('click');
    const stopPropagationSpy = vi.spyOn(event, 'stopPropagation');
    component.onToggleSelect(event);

    expect(stopPropagationSpy).toHaveBeenCalled();
    expect(selectToggled).toHaveBeenCalledWith('item-1');
  });

  it('renders and toggles the contextual menu', () => {
    expect(component.menuOpen()).toBe(false);
    fixture.detectChanges();
    const openMenuEvent = new MouseEvent('click');
    const openMenuStopPropagation = vi.spyOn(openMenuEvent, 'stopPropagation');
    component.toggleMenu(openMenuEvent);
    expect(component.menuOpen()).toBe(true);
    expect(openMenuStopPropagation).toHaveBeenCalled();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Edit');
    expect(fixture.nativeElement.textContent).toContain('Delete');
    const closeMenuEvent = new MouseEvent('click');
    const closeMenuStopPropagation = vi.spyOn(closeMenuEvent, 'stopPropagation');
    component.toggleMenu(closeMenuEvent);
    fixture.detectChanges();
    expect(closeMenuStopPropagation).toHaveBeenCalled();
    expect(component.menuOpen()).toBe(false);
  });

  it('emits edit and delete outputs and closes the menu', () => {
    const editRequested = vi.fn();
    const deleteRequested = vi.fn();
    component.editRequested.subscribe(editRequested);
    component.deleteRequested.subscribe(deleteRequested);
    component.menuOpen.set(true);
    fixture.detectChanges();

    component.onEdit();
    component.onDelete();
    expect(editRequested).toHaveBeenCalledWith(ITEM);
    expect(deleteRequested).toHaveBeenCalledWith(ITEM);
    expect(component.menuOpen()).toBe(false);
  });

  it('emits select on UI button click', () => {
    const selectToggled = vi.fn();
    component.selectToggled.subscribe(selectToggled);
    const button = fixture.nativeElement.querySelector('[aria-label="Add to styling"]') as HTMLButtonElement;
    button.click();
    expect(selectToggled).toHaveBeenCalledWith('item-1');
  });
});
