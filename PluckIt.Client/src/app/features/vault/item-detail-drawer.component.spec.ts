import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ItemDetailDrawerComponent } from './item-detail-drawer.component';
import { WardrobeService } from '../../core/services/wardrobe.service';
import { UserProfileService } from '../../core/services/user-profile.service';
import { ClothingItem } from '../../core/models/clothing-item.model';
import { WritableSignal } from '@angular/core';

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
  type ItemDetailDrawerComponentInternals = {
    logWearWorking: WritableSignal<boolean>;
    wearHistoryEvents: WritableSignal<unknown[]>;
  };
  const asInternal = (): ItemDetailDrawerComponentInternals =>
    component as unknown as ItemDetailDrawerComponentInternals;

  beforeEach(async () => {
    logWearCalls = 0;
    wardrobeService = {
      logWear: vi.fn().mockImplementation(() => {
        logWearCalls += 1;
        return of({ ...ITEM, wearCount: 3 });
      }),
      getWearHistory: vi.fn().mockReturnValue(of({
        itemId: ITEM.id,
        events: [],
        summary: { totalInRange: 0, legacyUntrackedCount: 0 },
      })),
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

  it('emits close/edit/share actions', () => {
    let closed = 0;
    let shareItem: ClothingItem | null = null;
    let editItem: ClothingItem | null = null;
    component.closed.subscribe(() => { closed += 1; });
    component.shareToCollection.subscribe((item) => { shareItem = item; });
    component.editRequested.subscribe((item) => { editItem = item; });

    const host = fixture.nativeElement as HTMLElement;
    const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>('button'));
    const closeBtn = buttons.find(btn => btn.textContent?.trim() !== 'Log Wear (+1)' && btn.textContent?.trim() !== 'Logging…' && !btn.textContent?.includes('Share to Collection') && !btn.textContent?.includes('Edit Metadata'));
    closeBtn?.click();
    expect(closed).toBe(1);

    const shareBtn = buttons.find(btn => btn.textContent?.includes('Share to Collection'));
    const editBtn = buttons.find(btn => btn.textContent?.includes('Edit Metadata'));
    shareBtn?.click();
    editBtn?.click();

    expect(shareItem).toEqual(ITEM);
    expect(editItem).toEqual(ITEM);
  });

  it('emits wearLogged payload when log wear succeeds and refreshes history', () => {
    let logged: ClothingItem | null = null;
    component.wearLogged.subscribe(item => { logged = item; });

    const buttons = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button[aria-label="Log Wear"]')
    );
    buttons[0].click();

    expect(logWearCalls).toBe(1);
    expect(wardrobeService.logWear).toHaveBeenCalledWith(ITEM.id, {
      source: 'item_drawer',
      clientEventId: expect.stringContaining('wear-'),
    });
    expect(logged).toEqual({ ...ITEM, wearCount: 3 });
    expect(wardrobeService.getWearHistory).toHaveBeenCalledTimes(2);
  });

  it('clears working state when logging fails', () => {
    (wardrobeService.logWear as ReturnType<typeof vi.fn>).mockReturnValueOnce(throwError(() => new Error('nope')));
    const buttons = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button[aria-label="Log Wear"]')
    );
    buttons[0].click();
    expect(asInternal().logWearWorking()).toBe(false);
  });

  it('updates visible sections when metadata includes notes, care info, and tags', () => {
    fixture.componentRef.setInput('item', {
      ...ITEM,
      notes: 'Great fit',
      careInfo: ['dry_clean', 'unknown'],
      aestheticTags: ['casual', 'warm'],
    });
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent || '';
    expect(text).toContain('Notes');
    expect(text).toContain('Great fit');
    expect(text).toContain('Dry Clean Only');
    expect(text).toContain('unknown');
    expect(text).toContain('CASUAL');
  });

  it('hides drawer body when no item is provided', () => {
    fixture.componentRef.setInput('item', null);
    fixture.detectChanges();

    const aside = fixture.nativeElement.querySelector('aside');
    expect(aside?.classList.contains('hidden')).toBe(true);
    expect(asInternal().wearHistoryEvents()).toEqual([]);
  });
});
