import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SimpleChanges } from '@angular/core';
import { ReviewItemModalComponent } from './review-item-modal.component';
import { UserProfileService } from '../../core/services/user-profile.service';
import { ClothingItem } from '../../core/models/clothing-item.model';

const BASE_ITEM: ClothingItem = {
  id: 'item-1',
  imageUrl: '/assets/item-1.jpg',
  tags: ['minimal'],
  colours: [{ name: 'Navy', hex: '#001122' }],
  brand: 'Demo',
  category: 'Tops',
  price: null,
  notes: null,
  dateAdded: null,
  wearCount: 3,
  estimatedMarketValue: 120,
  purchaseDate: null,
  condition: 'Good',
  careInfo: ['wash'],
  size: {
    letter: 'M',
    system: 'EU',
    waist: 30,
    inseam: 32,
    shoeSize: null,
  },
};

describe('ReviewItemModalComponent', () => {
  let component: ReviewItemModalComponent;
  let fixture: ComponentFixture<ReviewItemModalComponent>;

  const createChanges = (item: ClothingItem): SimpleChanges => ({
    item: {
      previousValue: null,
      currentValue: item,
      firstChange: true,
      isFirstChange: () => true,
    },
  });

  const setInputItem = (item: ClothingItem) => {
    component.item = item;
    component.ngOnChanges(createChanges(item));
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReviewItemModalComponent],
      providers: [
        {
          provide: UserProfileService,
          useValue: {
            getOrDefault: vi.fn().mockReturnValue({ currencyCode: 'USD', preferredSizeSystem: 'US' }),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ReviewItemModalComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    setInputItem(BASE_ITEM);
    expect(component).toBeTruthy();
    expect(component.draft).toBeTruthy();
  });

  it('clones incoming item on changes to keep mutations isolated', () => {
    setInputItem(BASE_ITEM);
    expect(component.draft).toEqual(expect.objectContaining({ id: BASE_ITEM.id, category: BASE_ITEM.category }));
    expect(component.draft).not.toBe(component.item as any);
    expect(component.draft?.tags).not.toBe(BASE_ITEM.tags);
    expect(component.draft?.colours).not.toBe(BASE_ITEM.colours);
  });

  it('adds a normalized tag and prevents duplicates', () => {
    setInputItem(BASE_ITEM);
    component.newTag = '  SUMMER VIBE  ';
    component.addTag();
    expect(component.draft?.tags).toContain('summer vibe');
    expect(component.newTag).toBe('');
    component.addTag();
    expect(component.draft?.tags.filter(t => t === 'summer vibe')).toHaveLength(1);
  });

  it('does not add empty tags', () => {
    setInputItem(BASE_ITEM);
    component.newTag = '   ';
    component.addTag();
    expect(component.draft?.tags).toEqual(['minimal']);
  });

  it('removes an existing tag', () => {
    setInputItem({
      ...BASE_ITEM,
      tags: ['minimal', 'summer', 'casual'],
    });
    component.removeTag('summer');
    expect(component.draft?.tags).toEqual(['minimal', 'casual']);
  });

  it('resets category-dependent size when category changes', () => {
    setInputItem({ ...BASE_ITEM, category: 'Tops', size: { letter: 'M', system: 'US' } });
    expect(component.draft?.size).toEqual({ letter: 'M', system: 'US' });
    component.onCategoryChange();
    expect(component.draft?.size).toBeNull();
  });

  it('toggles letter size and preserves preferred system', () => {
    setInputItem({ ...BASE_ITEM, size: null });
    component.setLetterSize('L');
    expect(component.draft?.size).toEqual({ letter: 'L', system: 'US' });
    component.setLetterSize('L');
    expect(component.draft?.size).toBeNull();
  });

  it('writes bottoms sizes into the current draft size object', () => {
    setInputItem({ ...BASE_ITEM, size: null });
    component.setBottomsSize('waist', 34);
    expect(component.draft?.size).toEqual({ waist: 34, system: 'US' });
    component.setBottomsSize('inseam', 33);
    expect(component.draft?.size).toEqual({ waist: 34, inseam: 33, system: 'US' });
  });

  it('writes or clears shoe size', () => {
    setInputItem({ ...BASE_ITEM, size: null });
    component.setShoeSize(9.5);
    expect(component.draft?.size).toEqual({ shoeSize: 9.5, system: 'US' });
    component.setShoeSize(null);
    expect(component.draft?.size).toBeNull();
  });

  it('toggles care options and computes care state', () => {
    setInputItem({ ...BASE_ITEM, careInfo: ['wash'] });
    expect(component.hasCare('wash')).toBe(true);
    component.toggleCare('wash');
    expect(component.hasCare('wash')).toBe(false);
    component.toggleCare('dry_clean');
    expect(component.hasCare('dry_clean')).toBe(true);
    expect(component.careBtnClass('dry_clean')).toContain('bg-primary/10');
  });

  it('sets condition and emits save/update payload', () => {
    setInputItem({ ...BASE_ITEM, condition: 'Good' });
    component.setCondition('New');
    expect(component.draft?.condition).toBe('New');

    const saved = vi.fn();
    const updated = vi.fn();
    component.saved.subscribe(saved);
    component.updated.subscribe(updated);

    component.onSave();
    expect(saved).toHaveBeenCalledTimes(1);

    component.isEditMode = true;
    component.onSave();
    expect(updated).toHaveBeenCalledTimes(1);
  });

  it('closes when clicking on overlay backdrop', () => {
    const cancelled = vi.fn();
    component.cancelled.subscribe(cancelled);
    const target = document.createElement('div');
    component.onOverlayClick({ target, currentTarget: target } as unknown as MouseEvent);
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it('returns CSS variants for card components', () => {
    setInputItem({ ...BASE_ITEM, condition: 'Excellent' });
    component.setCondition('Excellent');
    expect(component.condBtnClass('Excellent', false)).toContain('bg-white');
    expect(component.condBtnClass('Good', true)).not.toContain('border-r');
    expect(component.letterSizeBtnClass('M', true)).toContain('text-[10px]');
  });
});
