import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ItemDetailDrawerComponent } from './item-detail-drawer.component';
import { WardrobeService } from '../../core/services/wardrobe.service';
import { UserProfileService } from '../../core/services/user-profile.service';
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

describe('ItemDetailDrawerComponent', () => {
  let fixture: ComponentFixture<ItemDetailDrawerComponent>;
  let component: ItemDetailDrawerComponent;
  let wardrobeService: Pick<WardrobeService, 'logWear' | 'getWearHistory'>;
  let logWearCalls = 0;

  beforeEach(async () => {
    logWearCalls = 0;
    wardrobeService = {
      logWear: () => {
        logWearCalls += 1;
        return of({ ...ITEM, wearCount: 3 });
      },
      getWearHistory: () => of({
        itemId: ITEM.id,
        events: [],
        summary: { totalInRange: 0, legacyUntrackedCount: 0 },
      }),
    };

    await TestBed.configureTestingModule({
      imports: [ItemDetailDrawerComponent],
      providers: [
        { provide: WardrobeService, useValue: wardrobeService },
        {
          provide: UserProfileService,
          useValue: { getOrDefault: () => ({ currencyCode: 'USD' }) },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ItemDetailDrawerComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('item', ITEM);
    fixture.detectChanges();
  });

  it('logs wear from action button', () => {
    const btn = fixture.nativeElement.querySelector('button[aria-label="Log Wear"]') as HTMLButtonElement;
    btn.click();
    expect(logWearCalls).toBe(1);
  });
});
