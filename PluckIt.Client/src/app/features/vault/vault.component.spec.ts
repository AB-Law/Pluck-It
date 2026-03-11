import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { VaultComponent } from './vault.component';
import { VaultInsightsService } from '../../core/services/vault-insights.service';
import { WardrobeService } from '../../core/services/wardrobe.service';
import { UserProfileService } from '../../core/services/user-profile.service';
import { of, throwError } from 'rxjs';
import { ItemCondition } from '../../core/models/clothing-item.model';
import { SmartGroup, VaultFilters } from './vault-sidebar.component';

describe('VaultComponent', () => {
  let component: VaultComponent;
  let fixture: ComponentFixture<VaultComponent>;
  let wardrobeService: {
    getAll: ReturnType<typeof vi.fn>;
    getWearSuggestions: ReturnType<typeof vi.fn>;
    logWear: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateWearSuggestionStatus: ReturnType<typeof vi.fn>;
  };
  let insightsService: { getInsights: ReturnType<typeof vi.fn> };
  let profileService: {
    load: ReturnType<typeof vi.fn>;
    getOrDefault: ReturnType<typeof vi.fn>;
  };
  let route: { snapshot: { queryParamMap: ReturnType<typeof convertToParamMap> }; queryParamMap: any };
  const ITEM = {
    id: 'i-1',
    imageUrl: '/img/1.jpg',
    tags: [],
    colours: [],
    brand: 'UNQ',
    category: 'Top',
    price: { amount: 20, originalCurrency: 'USD' },
    notes: null,
    dateAdded: '2026-03-01T00:00:00Z',
    wearCount: 1,
    estimatedMarketValue: 100,
    purchaseDate: null,
    condition: 'New' as ItemCondition,
  };
  const ITEM_WITH_WEAR = { ...ITEM, id: 'i-2', wearCount: 0 };
  const SUGGESTION = { suggestionId: 's-1', itemId: 'i-1', message: 'Mark this worn this week' };
  const QUERY_FILTER: VaultFilters = {
    group: 'all' as SmartGroup,
    priceRange: [0, 999999],
    minWears: 0,
    brand: '',
    condition: '',
    sortField: 'dateAdded',
    sortDir: 'desc',
  };

  beforeEach(async () => {
    wardrobeService = {
      getAll: vi.fn().mockReturnValue(of({ items: [ITEM], pageInfo: {} })),
      getWearSuggestions: vi.fn().mockReturnValue(of({ suggestions: [] })),
      logWear: vi.fn().mockReturnValue(of({ ...ITEM, wearCount: 2 })),
      update: vi.fn().mockReturnValue(of(ITEM)),
      updateWearSuggestionStatus: vi.fn().mockReturnValue(of({})),
    };
    insightsService = {
      getInsights: vi.fn().mockReturnValue(of({
        topWornBrands: ['UNQ'],
        behavioralInsights: {
          topColorWearShare: {
            color: 'black',
            pct: 32,
          },
          unworn90dPct: 18,
          mostExpensiveUnworn: {
            itemId: 'i-2',
            amount: 220,
            currency: 'USD',
          },
        },
        cpwIntel: [
          { itemId: 'i-1', badge: 'good', breakEvenReached: false },
        ],
      })),
    };
    profileService = {
      load: vi.fn().mockReturnValue(of({ id: 'u-1' })),
      getOrDefault: vi.fn().mockReturnValue({ currencyCode: 'USD' }),
    };
    route = {
      snapshot: { queryParamMap: convertToParamMap({}) },
      queryParamMap: of(convertToParamMap({})),
    };

    await TestBed.configureTestingModule({
      imports: [VaultComponent],
      providers: [
        { provide: ActivatedRoute, useValue: route },
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: VaultInsightsService, useValue: insightsService },
        { provide: WardrobeService, useValue: wardrobeService },
        { provide: UserProfileService, useValue: profileService },
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(VaultComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('loads profile, filters and items on init', () => {
    expect(profileService.load).toHaveBeenCalledTimes(1);
    expect(wardrobeService.getAll).toHaveBeenCalledTimes(1);
    expect(wardrobeService.getWearSuggestions).toHaveBeenCalledTimes(1);
    expect(insightsService.getInsights).toHaveBeenCalledWith(90, 100);
    const firstCall = wardrobeService.getAll.mock.calls[0][0];
    expect(firstCall.pageSize).toBe(24);
    expect(firstCall.sortField).toBe('dateAdded');
    expect((component as any).loading()).toBe(false);
    expect(component.filteredItems()).toEqual([ITEM]);
  });

  it('toggles card selection and updates filtered items for favorites/search', () => {
    component.onCardSelect(ITEM);
    expect((component as any).selectedItem()?.id).toBe('i-1');
    component.onCardSelect(ITEM);
    expect((component as any).selectedItem()).toBeNull();

    (component as any).searchQuery.set('missing');
    expect(component.filteredItems()).toEqual([]);
    (component as any).searchQuery.set('');
    expect(component.filteredItems()).toEqual([ITEM]);
  });

  it('reloads data when filters change and syncs URL', () => {
    component.onFiltersChange({
      ...QUERY_FILTER,
      brand: 'UNQ',
      sortField: 'wearCount',
      sortDir: 'asc',
      minWears: 2,
      priceRange: [10, 40],
    });
    expect(wardrobeService.getAll).toHaveBeenCalledTimes(2);
    expect(profileService.load).toHaveBeenCalledTimes(1);
  });

  it('restores query filters from URL and loads initial query params', () => {
    route.snapshot.queryParamMap = convertToParamMap({
      group: 'favorites',
      priceMin: '10',
      priceMax: '250',
      minWears: '2',
      brand: 'UNQ',
      condition: 'New',
      sortField: 'wearCount',
      sortDir: 'asc',
    });
    route.queryParamMap = of(route.snapshot.queryParamMap);
    wardrobeService.getAll = vi.fn().mockReturnValue(
      of({ items: [ITEM], nextContinuationToken: 'p2' }),
    );

    fixture = TestBed.createComponent(VaultComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    expect(wardrobeService.getAll).toHaveBeenCalledTimes(1);
    expect((component as any).activeFilters()).toEqual(expect.objectContaining({
      group: 'favorites',
      priceRange: [10, 250],
      minWears: 2,
      brand: 'UNQ',
      condition: 'New',
      sortField: 'wearCount',
      sortDir: 'asc',
    }));
    expect((component as any).nextToken()).toBe('p2');
  });

  it('increments wear count optimistically and preserves fallback on failure', () => {
    component.onCardWear(ITEM);
    expect((component as any).allItems()).toContainEqual({ ...ITEM, wearCount: 2 });
    wardrobeService.logWear.mockReturnValueOnce(throwError(() => new Error('nope')));
    component.onCardWear({ ...ITEM, wearCount: 2 });
    expect(wardrobeService.logWear).toHaveBeenCalledWith('i-1', {
      source: 'vault_card',
      clientEventId: expect.stringContaining('wear-'),
    });
  });

  it('rolls back optimistic wear update when logging fails', () => {
    wardrobeService.logWear.mockReturnValueOnce(throwError(() => new Error('fail')));
    component.onCardWear(ITEM);
    expect((component as any).allItems()).toEqual([ITEM]);
  });

  it('loads more items when a continuation token exists', () => {
    wardrobeService.getAll = vi.fn()
      .mockReturnValueOnce(of({ items: [ITEM], nextContinuationToken: 'tok' }))
      .mockReturnValueOnce(of({ items: [ITEM_WITH_WEAR], nextContinuationToken: null }));
    fixture = TestBed.createComponent(VaultComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    component.loadMore();
    expect(wardrobeService.getAll).toHaveBeenCalledTimes(2);
    expect((component as any).allItems()).toEqual([ITEM, ITEM_WITH_WEAR]);
    expect((component as any).hasMore()).toBe(false);
    expect((component as any).loadingMore()).toBe(false);
    expect((component as any).nextToken()).toBeNull();
  });

  it('ignores loadMore when no continuation token is available', () => {
    component.loadMore();
    expect(wardrobeService.getAll).toHaveBeenCalledTimes(1);
  });

  it('avoids concurrent loadMore calls while loadingMore is true', () => {
    (component as any).nextToken.set('tok');
    (component as any).loadingMore.set(true);
    component.loadMore();
    expect(wardrobeService.getAll).toHaveBeenCalledTimes(1);
  });

  it('refreshes insights and suggestions after wear logging', () => {
    const initialInsightsCalls = (insightsService.getInsights as any).mock.calls.length;
    const initialSuggestionCalls = (wardrobeService.getWearSuggestions as any).mock.calls.length;

    component.onWearLogged({ ...ITEM, wearCount: 3 });

    expect((component as any).selectedItem()).toEqual({ ...ITEM, wearCount: 3 });
    expect((component as any).allItems()).toContainEqual({ ...ITEM, wearCount: 3 });
    expect(insightsService.getInsights).toHaveBeenCalledTimes(initialInsightsCalls + 1);
    expect(wardrobeService.getWearSuggestions).toHaveBeenCalledTimes(initialSuggestionCalls + 1);
  });

  it('returns default intel values when an item is not recognized', () => {
    expect(component.cpwBadgeFor('missing')).toBe('unknown');
    expect(component.breakEvenFor('missing')).toBe(false);
  });

  it('opens share/edit modals and accepts wear suggestions', () => {
    const suggestion = { suggestionId: 's-1', itemId: 'i-1', message: 'Wear this' };
    component.acceptSuggestion(suggestion as any);
    expect(wardrobeService.logWear).toHaveBeenCalledWith('i-1', {
      source: 'suggestion_prompt',
      clientEventId: expect.stringContaining('wear-'),
      stylingActivityId: 's-1',
    });

    component.openEditModal(ITEM);
    expect((component as any).editingItem()).toEqual(ITEM);
    component.openShareModal(ITEM);
    expect((component as any).sharingItem()).toEqual(ITEM);
    component.onItemUpdated({ ...ITEM, notes: 'updated' });
    expect(wardrobeService.update).toHaveBeenCalledWith({ ...ITEM, notes: 'updated' });
  });

  it('dismisses a wear suggestion from the list', () => {
    (component as any).wearSuggestions.set([SUGGESTION as any]);
    component.dismissSuggestion(SUGGESTION as any);
    expect(wardrobeService.updateWearSuggestionStatus).toHaveBeenCalledWith('s-1', { status: 'Dismissed' });
    expect((component as any).wearSuggestions()).toEqual([]);
  });

  it('handles initial item load failure without blocking UI state', () => {
    wardrobeService.getAll = vi.fn().mockReturnValue(throwError(() => new Error('boom')));
    fixture = TestBed.createComponent(VaultComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    expect((component as any).loading()).toBe(false);
  });

  it('resets insights to null when the insights call fails', () => {
    insightsService.getInsights = vi.fn().mockReturnValue(throwError(() => new Error('boom')));
    fixture = TestBed.createComponent(VaultComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    expect((component as any).insights()).toBeNull();
    expect((component as any).loadingInsights()).toBe(false);
  });
});
