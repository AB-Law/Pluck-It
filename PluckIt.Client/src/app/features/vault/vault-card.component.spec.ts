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
});
