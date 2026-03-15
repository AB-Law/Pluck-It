import { ComponentFixture, TestBed } from '@angular/core/testing';
import { VaultCardComponent } from './vault-card.component';
import { ClothingItem } from '../../core/models/clothing-item.model';

const ITEM: ClothingItem = {
  id: 'item-1',
  imageUrl: 'https://example.com/a.png',
  tags: [],
  colours: [{ name: 'Black', hex: '#000000' }],
  brand: 'Zara',
  category: 'Tops',
  price: { amount: 120, originalCurrency: 'USD' },
  notes: null,
  dateAdded: '2026-01-01T00:00:00Z',
  wearCount: 2,
  estimatedMarketValue: null,
  purchaseDate: null,
  condition: null,
};

describe('VaultCardComponent', () => {
  let fixture: ComponentFixture<VaultCardComponent>;
  let component: VaultCardComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [VaultCardComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(VaultCardComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('item', ITEM);
    fixture.detectChanges();
  });

  it('emits wearIncrementRequested on +1 wear click', () => {
    let called = false;
    component.wearIncrementRequested.subscribe(() => { called = true; });
    const btn = fixture.nativeElement.querySelector('button[aria-label="Log wear"]') as HTMLButtonElement;
    btn.click();
    expect(called).toBe(true);
  });

  it('renders computed badge, value, and aesthetic tag branches', () => {
    expect(component.cpwDisplay()).toContain('$60');
    expect(component.valueDisplay()).toContain('$120');
    expect(component.aestheticTag()).toBe('Tops');
    expect(component.cpwBadgeClass()).toContain('bg-primary/20');

    fixture.componentRef.setInput('cpwBadge', 'low');
    fixture.detectChanges();
    expect(component.cpwBadgeClass()).toContain('bg-emerald-900/40');
  });

  it('falls back to N/A for cpw when wear count is zero', () => {
    fixture.componentRef.setInput('item', {
      ...ITEM,
      price: { amount: 120, originalCurrency: 'USD' },
      wearCount: 0,
      estimatedMarketValue: null,
    });
    fixture.detectChanges();
    expect(component.cpwDisplay()).toBe('N/A');
  });

  it('renders selected state and break-even helper text', () => {
    fixture.componentRef.setInput('isSelected', true);
    fixture.componentRef.setInput('breakEvenReached', true);
    fixture.detectChanges();
    expect((fixture.nativeElement.textContent || '').includes('SELECTED')).toBe(true);
    expect((fixture.nativeElement.textContent || '').includes('You’ve broken even on this item')).toBe(true);
  });

  it('emits select toggles when card is clicked', () => {
    let selectedId: string | null = null;
    component.selectToggled.subscribe(value => { selectedId = value; });
    (fixture.nativeElement.querySelector('div') as HTMLElement).click();
    expect(selectedId).toBe('item-1');
  });

  it('initializes drag payload on drag start', () => {
    const setData = vi.fn();
    component.onDragStart({ dataTransfer: { setData } } as unknown as DragEvent);
    expect(setData).toHaveBeenCalledWith('text/plain', 'item-1');
    expect(setData).toHaveBeenCalledWith('application/pluckit-item', 'item-1');
  });

  it('stops propagation when quick wear is clicked', () => {
    const quickWearEvent = new MouseEvent('click');
    const stopPropagation = vi.spyOn(quickWearEvent, 'stopPropagation');
    component.onQuickWear(quickWearEvent);
    expect(stopPropagation).toHaveBeenCalled();
  });
});
