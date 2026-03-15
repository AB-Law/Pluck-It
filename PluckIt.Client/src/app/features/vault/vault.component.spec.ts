import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WritableSignal } from '@angular/core';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { VaultComponent } from './vault.component';
import { VaultInsightsService } from '../../core/services/vault-insights.service';
import { WardrobeService } from '../../core/services/wardrobe.service';
import { UserProfileService } from '../../core/services/user-profile.service';
import { ItemCondition, ClothingItem, WardrobeQuery, WearSuggestionItem } from '../../core/models/clothing-item.model';
import { of, throwError, Observable } from 'rxjs';
import { SmartGroup, VaultFilters } from './vault-sidebar.component';
import { CollectionService } from '../../core/services/collection.service';
import { MobileNavState } from '../../shared/layout/mobile-nav.state';
import { VaultInsightsPanelData, VaultInsightsResponse } from '../../core/models/vault-insights.model';

describe('VaultComponent', () => {
  let component: VaultComponent;
  let fixture: ComponentFixture<VaultComponent>;
  let router: {
    navigate: ReturnType<typeof vi.fn>;
    createUrlTree: ReturnType<typeof vi.fn>;
    serializeUrl: ReturnType<typeof vi.fn>;
    isActive: ReturnType<typeof vi.fn>;
  };
  let wardrobeService: {
    getAll: ReturnType<typeof vi.fn>;
    getWearSuggestions: ReturnType<typeof vi.fn>;
    logWear: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateWearSuggestionStatus: ReturnType<typeof vi.fn>;
    getWearHistory: ReturnType<typeof vi.fn>;
  };
  let insightsService: { getInsights: ReturnType<typeof vi.fn> };
  let profileService: {
    load: ReturnType<typeof vi.fn>;
    getOrDefault: ReturnType<typeof vi.fn>;
  };
  let collectionService: {
    loadAll: ReturnType<typeof vi.fn>;
    collections: () => unknown[];
    addItem: ReturnType<typeof vi.fn>;
  };
  let route: {
    snapshot: { queryParamMap: ReturnType<typeof convertToParamMap> };
    queryParamMap: Observable<ReturnType<typeof convertToParamMap>>;
  };
  let mobileNavState: MobileNavState;
  type VaultComponentInternals = {
    loading: WritableSignal<boolean>;
    loadingInsights: WritableSignal<boolean>;
    loadingMore: WritableSignal<boolean>;
    hasMore: WritableSignal<boolean>;
    nextToken: WritableSignal<string | null>;
    searchQuery: WritableSignal<string>;
    activeFilters: WritableSignal<VaultFilters>;
    allItems: WritableSignal<ClothingItem[]>;
    selectedItem: WritableSignal<ClothingItem | null>;
    editingItem: WritableSignal<ClothingItem | null>;
    sharingItem: WritableSignal<ClothingItem | null>;
    wearSuggestions: WritableSignal<WearSuggestionItem[]>;
    insights: WritableSignal<VaultInsightsResponse | null>;
    settingsOpen: WritableSignal<boolean>;
    enrichedInsights: () => VaultInsightsPanelData | null;
    buildQuery: (filters: VaultFilters, continuationToken?: string | null) => WardrobeQuery;
    nextClientEventId: (prefix: string) => string;
    onWindowResize: () => void;
    openSettings: () => void;
    closeSettingsPanel: () => void;
    knownBrands: () => string[];
  };
  const asInternal = (): VaultComponentInternals => component as unknown as VaultComponentInternals;
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
  const SUGGESTION: WearSuggestionItem = {
    suggestionId: 's-1',
    itemId: 'i-1',
    message: 'Mark this worn this week',
    activityAt: '2026-03-15T00:00:00Z',
  };
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
      getWearHistory: vi.fn().mockReturnValue(of({ items: [] })),
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
    collectionService = {
      loadAll: vi.fn().mockReturnValue(of({})),
      collections: () => [],
      addItem: vi.fn().mockReturnValue(of({})),
    };
    router = {
      navigate: vi.fn(),
      createUrlTree: vi.fn((commands: unknown) => ({
        toString: () => (typeof commands === 'string' ? commands : `/${(commands as unknown[]).join('/')}`),
      })),
      serializeUrl: vi.fn((tree: { toString: () => string }) => tree.toString()),
      isActive: vi.fn(() => false),
    };
    route = {
      snapshot: { queryParamMap: convertToParamMap({}) },
      queryParamMap: of(convertToParamMap({})),
    };

    await TestBed.configureTestingModule({
      imports: [VaultComponent],
      providers: [
        { provide: ActivatedRoute, useValue: route },
        { provide: Router, useValue: router },
        { provide: VaultInsightsService, useValue: insightsService },
        { provide: WardrobeService, useValue: wardrobeService },
        { provide: UserProfileService, useValue: profileService },
        { provide: CollectionService, useValue: collectionService },
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(VaultComponent);
    component = fixture.componentInstance;
    mobileNavState = TestBed.inject(MobileNavState);
    fixture.detectChanges();
  });

  afterEach(() => {
    mobileNavState.closePanel();
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
    expect(asInternal().loading()).toBe(false);
    expect(component.filteredItems()).toEqual([ITEM]);
  });

  it('toggles card selection and updates filtered items for favorites/search', () => {
    component.onCardSelect(ITEM);
    expect(asInternal().selectedItem()?.id).toBe('i-1');
    component.onCardSelect(ITEM);
    expect(asInternal().selectedItem()).toBeNull();

    asInternal().searchQuery.set('missing');
    expect(component.filteredItems()).toEqual([]);
    asInternal().searchQuery.set('');
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
    expect(asInternal().activeFilters()).toEqual(expect.objectContaining({
      group: 'favorites',
      priceRange: [10, 250],
      minWears: 2,
      brand: 'UNQ',
      condition: 'New',
      sortField: 'wearCount',
      sortDir: 'asc',
    }));
    expect(asInternal().nextToken()).toBe('p2');
  });

  it('increments wear count optimistically and preserves fallback on failure', () => {
    component.onCardWear(ITEM);
    expect(asInternal().allItems()).toContainEqual({ ...ITEM, wearCount: 2 });
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
    expect(asInternal().allItems()).toEqual([ITEM]);
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
    expect(asInternal().allItems()).toEqual([ITEM, ITEM_WITH_WEAR]);
    expect(asInternal().hasMore()).toBe(false);
    expect(asInternal().loadingMore()).toBe(false);
    expect(asInternal().nextToken()).toBeNull();
  });

  it('ignores loadMore when no continuation token is available', () => {
    component.loadMore();
    expect(wardrobeService.getAll).toHaveBeenCalledTimes(1);
  });

  it('avoids concurrent loadMore calls while loadingMore is true', () => {
    asInternal().nextToken.set('tok');
    asInternal().loadingMore.set(true);
    component.loadMore();
    expect(wardrobeService.getAll).toHaveBeenCalledTimes(1);
  });

  it('refreshes insights and suggestions after wear logging', () => {
    const initialInsightsCalls = insightsService.getInsights.mock.calls.length;
    const initialSuggestionCalls = wardrobeService.getWearSuggestions.mock.calls.length;

    component.onWearLogged({ ...ITEM, wearCount: 3 });

    expect(asInternal().selectedItem()).toEqual({ ...ITEM, wearCount: 3 });
    expect(asInternal().allItems()).toContainEqual({ ...ITEM, wearCount: 3 });
    expect(insightsService.getInsights).toHaveBeenCalledTimes(initialInsightsCalls + 1);
    expect(wardrobeService.getWearSuggestions).toHaveBeenCalledTimes(initialSuggestionCalls + 1);
  });

  it('returns default intel values when an item is not recognized', () => {
    expect(component.cpwBadgeFor('missing')).toBe('unknown');
    expect(component.breakEvenFor('missing')).toBe(false);
  });

  it('enriches insight rows with item labels and image urls when wardrobe data is present', () => {
    asInternal().allItems.set([ITEM]);
    asInternal().insights.set({
      generatedAt: '2026-03-12T00:00:00Z',
      currency: 'USD',
      insufficientData: false,
      behavioralInsights: {
        topColorWearShare: { color: 'black', pct: 20 },
        unworn90dPct: 0,
        mostExpensiveUnworn: { itemId: 'i-2', amount: 20, currency: 'USD' },
      },
      cpwIntel: [
        {
          itemId: 'i-1',
          badge: 'low',
          breakEvenReached: false,
          breakEvenTargetCpw: 100,
          recentWearRate: 1.2,
          historicalWearRate: 0.6,
          wearRateTrend: 'up',
        },
      ],
    });

    const enriched = asInternal().enrichedInsights();
    expect(enriched?.cpwIntel?.[0]).toMatchObject({
      itemId: 'i-1',
      itemLabel: 'UNQ · Top',
      imageUrl: '/img/1.jpg',
    });
  });

  it('opens share/edit modals and accepts wear suggestions', () => {
    const suggestion: WearSuggestionItem = {
      ...SUGGESTION,
      message: 'Wear this',
      activityAt: '2026-03-15T00:00:00Z',
    };
    component.acceptSuggestion(suggestion);
    expect(wardrobeService.logWear).toHaveBeenCalledWith('i-1', {
      source: 'suggestion_prompt',
      clientEventId: expect.stringContaining('wear-'),
      stylingActivityId: 's-1',
    });

    component.openEditModal(ITEM);
    expect(asInternal().editingItem()).toEqual(ITEM);
    component.openShareModal(ITEM);
    expect(asInternal().sharingItem()).toEqual(ITEM);
    component.onItemUpdated({ ...ITEM, notes: 'updated' });
    expect(wardrobeService.update).toHaveBeenCalledWith({ ...ITEM, notes: 'updated' });
  });

  it('dismisses a wear suggestion from the list', () => {
    asInternal().wearSuggestions.set([SUGGESTION]);
    component.dismissSuggestion(SUGGESTION);
    expect(wardrobeService.updateWearSuggestionStatus).toHaveBeenCalledWith('s-1', { status: 'Dismissed' });
    expect(asInternal().wearSuggestions()).toEqual([]);
  });

  it('handles initial item load failure without blocking UI state', () => {
    wardrobeService.getAll = vi.fn().mockReturnValue(throwError(() => new Error('boom')));
    fixture = TestBed.createComponent(VaultComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    expect(asInternal().loading()).toBe(false);
  });

  it('resets insights to null when the insights call fails', () => {
    insightsService.getInsights = vi.fn().mockReturnValue(throwError(() => new Error('boom')));
    fixture = TestBed.createComponent(VaultComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    expect(asInternal().insights()).toBeNull();
    expect(asInternal().loadingInsights()).toBe(false);
  });

  it('renders loading, empty, and suggestion branches in template', () => {
    const root = fixture.nativeElement as HTMLElement;
    asInternal().loading.set(true);
    fixture.detectChanges();
    expect(root.textContent).toContain('Loading vault…');

    asInternal().loading.set(false);
    asInternal().allItems.set([]);
    fixture.detectChanges();
    expect(root.textContent).toContain('No items match your filters.');

    asInternal().wearSuggestions.set([{ ...SUGGESTION, message: 'Test suggestion' }]);
    fixture.detectChanges();
    expect(root.textContent).toContain('Test suggestion');

    wardrobeService.logWear.mockReturnValueOnce(of({ ...ITEM, wearCount: 2 }));
    const acceptButton = Array.from(root.querySelectorAll('button')).find(
      btn => btn.textContent?.trim() === 'Mark Worn',
    );
    acceptButton?.click();
    fixture.detectChanges();
    expect(asInternal().wearSuggestions()).toEqual([]);

    asInternal().wearSuggestions.set([{ ...SUGGESTION, message: 'Close soon', suggestionId: 's-2' }]);
    fixture.detectChanges();
    const dismissButton = Array.from(root.querySelectorAll('button')).find(
      btn => btn.textContent?.trim() === 'Dismiss',
    );
    dismissButton?.click();
    expect(wardrobeService.updateWearSuggestionStatus).toHaveBeenCalledWith('s-2', { status: 'Dismissed' });
  });

  it('renders and toggles edit/share modal overlays', () => {
    const root = fixture.nativeElement as HTMLElement;
    asInternal().editingItem.set(ITEM);
    fixture.detectChanges();
    expect(root.querySelector('app-review-item-modal')).toBeTruthy();

    asInternal().editingItem.set(null);
    asInternal().sharingItem.set(ITEM);
    fixture.detectChanges();
    expect(root.querySelector('app-add-to-collection-modal')).toBeTruthy();
  });

  it('applies computed client-side grouping branches', () => {
    const favourite = { ...ITEM, id: 'fav', tags: ['favorite'], wearCount: 3 };
    const recent = { ...ITEM, id: 'recent', wearCount: 5, tags: [] };
    const archived = { ...ITEM, id: 'old', wearCount: 0, tags: [] };
    asInternal().allItems.set([favourite, recent, archived]);

    asInternal().activeFilters.set({ ...QUERY_FILTER, group: 'favorites' });
    expect(component.filteredItems()).toEqual([favourite]);

    asInternal().activeFilters.set({ ...QUERY_FILTER, group: 'recent' });
    expect(component.filteredItems()).toEqual([favourite, recent]);

    asInternal().searchQuery.set('fav');
    expect(component.filteredItems().length).toBe(1);
    asInternal().searchQuery.set('');
    expect(component.filteredItems().length).toBe(2);
  });

  it('handles cpw display branches and intel lookups', () => {
    asInternal().allItems.set([{ ...ITEM, price: { amount: 120, originalCurrency: 'USD' }, wearCount: 2 }]);
    expect(component.avgCpwDisplay()).toBe('$60.00');

    asInternal().allItems.set([{ ...ITEM, price: null, wearCount: 0 }]);
    expect(component.avgCpwDisplay()).toBe('N/A');

    asInternal().insights.set({
      generatedAt: new Date().toISOString(),
      currency: 'USD',
      insufficientData: false,
      behavioralInsights: { topColorWearShare: { color: 'black', pct: 10 }, unworn90dPct: 0, mostExpensiveUnworn: { itemId: 'x', amount: 10, currency: 'USD' } },
      cpwIntel: [{ itemId: 'i-1', badge: 'low', breakEvenReached: true, breakEvenTargetCpw: 42 }],
    });
    expect(component.cpwBadgeFor('i-1')).toBe('low');
    expect(component.breakEvenFor('i-1')).toBe(true);
    expect(component.cpwBadgeFor('missing')).toBe('unknown');
  });

  it('buildQuery and syncUrl include expected defaults and overrides', () => {
    const custom = { ...QUERY_FILTER, brand: 'UNQ', condition: 'New' as ItemCondition, priceRange: [20, 500] as [number, number], minWears: 2 };
    expect(asInternal().buildQuery(custom)).toEqual(expect.objectContaining({
      brand: 'UNQ',
      condition: 'New',
      priceMin: 20,
      priceMax: 500,
      minWears: 2,
      includeWishlisted: false,
      pageSize: 24,
      sortField: 'dateAdded',
      sortDir: 'desc',
    }));
    expect(asInternal().buildQuery(QUERY_FILTER)).toEqual(expect.objectContaining({
      brand: undefined,
      condition: undefined,
      priceMin: undefined,
      priceMax: undefined,
      minWears: undefined,
      includeWishlisted: false,
      pageSize: 24,
    }));

    component['syncUrl'](custom);
    expect(router.navigate).toHaveBeenCalledWith([], expect.objectContaining({
      queryParams: {
        group: null,
        priceMin: 20,
        priceMax: 500,
        minWears: 2,
        brand: 'UNQ',
        condition: 'New',
        sortField: null,
        sortDir: null,
      },
      replaceUrl: true,
    }));
  });

  it('buildQuery includes wishlisted items only for the wishlist group', () => {
    const wishlistQuery = asInternal().buildQuery({
      ...QUERY_FILTER,
      group: 'wishlist',
    });
    expect(wishlistQuery.includeWishlisted).toBe(true);
  });

  it('handles wear suggestions load failure without breaking state', () => {
    wardrobeService.getWearSuggestions = vi.fn().mockReturnValue(throwError(() => new Error('no suggestions')));
    fixture = TestBed.createComponent(VaultComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    expect(asInternal().wearSuggestions()).toEqual([]);
  });

  it('falls back to timestamp-based event ids when crypto helpers are missing', () => {
    const originalCrypto = globalThis.crypto;
    try {
      Object.defineProperty(globalThis, 'crypto', {
        value: { getRandomValues: () => new Uint32Array([123]) },
        configurable: true,
      });
      const randomValueId = asInternal().nextClientEventId('wear');
      expect(randomValueId).toMatch(/^wear-/);

      Object.defineProperty(globalThis, 'crypto', {
        value: {},
        configurable: true,
      });
      const fallbackId = asInternal().nextClientEventId('wear');
      expect(fallbackId).toMatch(/^wear-/);
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: originalCrypto, configurable: true });
    }
  });

  it('covers load-more loading state, selected-item branch, and card selection toggles', () => {
    const localItems = [
      { ...ITEM, id: 'a', price: { amount: 10, originalCurrency: 'USD' }, brand: null, wearCount: 1 },
      { ...ITEM, id: 'b', price: { amount: 120, originalCurrency: 'USD' }, wearCount: 2 },
    ];
    asInternal().allItems.set(localItems);
    asInternal().nextToken.set('more');
    asInternal().hasMore.set(true);
    asInternal().loadingMore.set(true);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const loadMoreButton = Array.from(root.querySelectorAll('button')).find(
      button => button.textContent?.includes('Load More') || button.textContent?.includes('Loading...'),
    ) as HTMLButtonElement;
    expect(loadMoreButton?.disabled).toBe(true);
    expect(loadMoreButton?.textContent).toContain('Loading...');

    asInternal().loadingMore.set(false);
    fixture.detectChanges();
    expect(loadMoreButton?.textContent).toContain('Load More');

    component.onCardSelect(localItems[0]);
    fixture.detectChanges();
    expect(asInternal().selectedItem()?.id).toBe('a');
    component.onCardSelect(localItems[0]);
    fixture.detectChanges();
    expect(asInternal().selectedItem()).toBeNull();
  });

  it('uses randomUUID branch for client event IDs', () => {
    const originalCrypto = globalThis.crypto;
    try {
      Object.defineProperty(globalThis, 'crypto', {
        value: { randomUUID: vi.fn(() => 'uuid-1') },
        configurable: true,
      });
      const id = asInternal().nextClientEventId('wear');
      expect(id).toContain('wear-uuid-1-');
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: originalCrypto, configurable: true });
    }
  });

  it('builds query and syncUrl for both default and explicit parameter branches', () => {
    const explicit = {
      ...QUERY_FILTER,
      group: 'favorites' as SmartGroup,
      brand: 'Acme',
      condition: 'New' as ItemCondition,
      priceRange: [12, 420] as [number, number],
      minWears: 3,
      sortField: 'wearCount' as const,
      sortDir: 'asc' as const,
    } as VaultFilters;

    expect(asInternal().buildQuery(explicit)).toEqual(expect.objectContaining({
      brand: 'Acme',
      condition: 'New',
      priceMin: 12,
      priceMax: 420,
      minWears: 3,
      sortField: 'wearCount',
      sortDir: 'asc',
      continuationToken: undefined,
    }));

    router.navigate.mockClear();
    component['syncUrl'](explicit);
    expect(router.navigate).toHaveBeenCalledWith([], expect.objectContaining({
      queryParams: expect.objectContaining({
        group: 'favorites',
        priceMin: 12,
        priceMax: 420,
        minWears: 3,
        brand: 'Acme',
        condition: 'New',
        sortField: 'wearCount',
        sortDir: 'asc',
      }),
      replaceUrl: true,
    }));
  });

  it('computes max price and known brand collection across item variants', () => {
    asInternal().allItems.set([]);
    expect(component.maxItemPrice()).toBe(5000);

    asInternal().allItems.set([
      { ...ITEM, id: 'x', price: { amount: 9000, originalCurrency: 'USD' }, brand: 'Alpha' },
      { ...ITEM, id: 'y', price: undefined, brand: 'Beta' },
      { ...ITEM, id: 'z', price: { amount: 420, originalCurrency: 'USD' }, brand: null },
      { ...ITEM, id: 'w', price: { amount: 7200, originalCurrency: 'USD' }, brand: 'Alpha' },
    ] as ClothingItem[]);
    expect(component.maxItemPrice()).toBe(9000);
    expect(asInternal().knownBrands()).toEqual(['Alpha', 'Beta']);
  });

  it('handles errors for suggestion accept and dismiss flows', () => {
    asInternal().wearSuggestions.set([SUGGESTION]);
    wardrobeService.logWear = vi.fn().mockReturnValue(throwError(() => new Error('retry later')));
    component.acceptSuggestion(SUGGESTION);
    expect(asInternal().wearSuggestions().length).toBe(1);

    wardrobeService.updateWearSuggestionStatus = vi.fn().mockReturnValue(throwError(() => new Error('bad status')));
    component.dismissSuggestion(SUGGESTION);
    expect(asInternal().wearSuggestions().length).toBe(1);
  });

  it('resets loadingMore when additional pages fail', () => {
    asInternal().nextToken.set('tok');
    asInternal().loadingMore.set(false);
    wardrobeService.getAll = vi.fn().mockReturnValue(throwError(() => new Error('paged fail')));
    component.loadMore();
    expect(asInternal().loadingMore()).toBe(false);
  });

  it('routes settings open to shell profile panel on mobile and local panel on desktop', () => {
    Object.defineProperty(globalThis.window, 'innerWidth', { value: 390, configurable: true });
    asInternal().onWindowResize();
    mobileNavState.closePanel();
    asInternal().openSettings();
    expect(mobileNavState.activePanel()).toBe('profile');
    expect(asInternal().settingsOpen()).toBe(false);

    mobileNavState.closePanel();
    Object.defineProperty(globalThis.window, 'innerWidth', { value: 1280, configurable: true });
    asInternal().onWindowResize();
    asInternal().openSettings();
    expect(asInternal().settingsOpen()).toBe(true);
    expect(mobileNavState.activePanel()).toBe('none');
  });

  it('restores main focus target after settings panel close', async () => {
    const focusSpy = vi.spyOn(
      fixture.nativeElement.querySelector('[aria-label="Vault content"]') as HTMLElement,
      'focus',
    );

    asInternal().settingsOpen.set(true);
    asInternal().closeSettingsPanel();

    await Promise.resolve();
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('clears stale mobile panel before opening settings', () => {
    Object.defineProperty(globalThis.window, 'innerWidth', { value: 390, configurable: true });
    asInternal().onWindowResize();
    mobileNavState.openDigest();
    const closeSpy = vi.spyOn(mobileNavState, 'closePanel');

    asInternal().openSettings();

    expect(closeSpy).toHaveBeenCalled();
    expect(mobileNavState.activePanel()).toBe('profile');
  });
});
