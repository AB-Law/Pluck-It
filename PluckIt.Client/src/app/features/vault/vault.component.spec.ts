import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { VaultComponent } from './vault.component';
import { VaultInsightsService } from '../../core/services/vault-insights.service';
import { WardrobeService } from '../../core/services/wardrobe.service';
import { UserProfileService } from '../../core/services/user-profile.service';
import { of, throwError } from 'rxjs';
import { ItemCondition } from '../../core/models/clothing-item.model';
import { SmartGroup, VaultFilters } from './vault-sidebar.component';
import { CollectionService } from '../../core/services/collection.service';
import { MobileNavState } from '../../shared/layout/mobile-nav.state';

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
    collections: () => any[];
    addItem: ReturnType<typeof vi.fn>;
  };
  let route: { snapshot: { queryParamMap: ReturnType<typeof convertToParamMap> }; queryParamMap: any };
  let mobileNavState: MobileNavState;
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

  it('enriches insight rows with item labels and image urls when wardrobe data is present', () => {
    (component as any).allItems.set([ITEM]);
    (component as any).insights.set({
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

    const enriched = (component as any).enrichedInsights();
    expect(enriched?.cpwIntel?.[0]).toMatchObject({
      itemId: 'i-1',
      itemLabel: 'UNQ · Top',
      imageUrl: '/img/1.jpg',
    });
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

  it('renders loading, empty, and suggestion branches in template', () => {
    const root = fixture.nativeElement as HTMLElement;
    (component as any).loading.set(true);
    fixture.detectChanges();
    expect(root.textContent).toContain('Loading vault…');

    (component as any).loading.set(false);
    (component as any).allItems.set([]);
    fixture.detectChanges();
    expect(root.textContent).toContain('No items match your filters.');

    (component as any).wearSuggestions.set([{ ...SUGGESTION, message: 'Test suggestion' } as any]);
    fixture.detectChanges();
    expect(root.textContent).toContain('Test suggestion');

    wardrobeService.logWear.mockReturnValueOnce(of({ ...ITEM, wearCount: 2 }));
    const acceptButton = Array.from(root.querySelectorAll('button')).find(
      btn => btn.textContent?.trim() === 'Mark Worn',
    );
    acceptButton?.click();
    fixture.detectChanges();
    expect((component as any).wearSuggestions()).toEqual([]);

    (component as any).wearSuggestions.set([{ ...SUGGESTION, message: 'Close soon', suggestionId: 's-2' } as any]);
    fixture.detectChanges();
    const dismissButton = Array.from(root.querySelectorAll('button')).find(
      btn => btn.textContent?.trim() === 'Dismiss',
    );
    dismissButton?.click();
    expect(wardrobeService.updateWearSuggestionStatus).toHaveBeenCalledWith('s-2', { status: 'Dismissed' });
  });

  it('renders and toggles edit/share modal overlays', () => {
    const root = fixture.nativeElement as HTMLElement;
    (component as any).editingItem.set(ITEM);
    fixture.detectChanges();
    expect(root.querySelector('app-review-item-modal')).toBeTruthy();

    (component as any).editingItem.set(null);
    (component as any).sharingItem.set(ITEM);
    fixture.detectChanges();
    expect(root.querySelector('app-add-to-collection-modal')).toBeTruthy();
  });

  it('applies computed client-side grouping branches', () => {
    const favourite = { ...ITEM, id: 'fav', tags: ['favorite'], wearCount: 3 };
    const recent = { ...ITEM, id: 'recent', wearCount: 5, tags: [] };
    const archived = { ...ITEM, id: 'old', wearCount: 0, tags: [] };
    (component as any).allItems.set([favourite, recent, archived]);

    (component as any).activeFilters.set({ ...QUERY_FILTER, group: 'favorites' });
    expect(component.filteredItems()).toEqual([favourite]);

    (component as any).activeFilters.set({ ...QUERY_FILTER, group: 'recent' });
    expect(component.filteredItems()).toEqual([favourite, recent]);

    (component as any).searchQuery.set('fav');
    expect(component.filteredItems().length).toBe(1);
    (component as any).searchQuery.set('');
    expect(component.filteredItems().length).toBe(2);
  });

  it('handles cpw display branches and intel lookups', () => {
    (component as any).allItems.set([{ ...ITEM, price: { amount: 120, originalCurrency: 'USD' }, wearCount: 2 } as any]);
    expect(component.avgCpwDisplay()).toBe('$60.00');

    (component as any).allItems.set([{ ...ITEM, price: undefined, wearCount: 0 } as any]);
    expect(component.avgCpwDisplay()).toBe('N/A');

    (component as any).insights.set({
      topWornBrands: ['UNQ'],
      behavioralInsights: { topColorWearShare: { color: 'black', pct: 10 }, unworn90dPct: 0, mostExpensiveUnworn: { itemId: 'x', amount: 10, currency: 'USD' } },
      cpwIntel: [{ itemId: 'i-1', badge: 'great', breakEvenReached: true }],
    });
    expect(component.cpwBadgeFor('i-1')).toBe('great');
    expect(component.breakEvenFor('i-1')).toBe(true);
    expect(component.cpwBadgeFor('missing')).toBe('unknown');
  });

  it('buildQuery and syncUrl include expected defaults and overrides', () => {
    const custom = { ...QUERY_FILTER, brand: 'UNQ', condition: 'New' as ItemCondition, priceRange: [20, 500] as [number, number], minWears: 2 };
    expect((component as any).buildQuery(custom)).toEqual(expect.objectContaining({
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
    expect((component as any).buildQuery(QUERY_FILTER)).toEqual(expect.objectContaining({
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
    const wishlistQuery = (component as any).buildQuery({
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

    expect((component as any).wearSuggestions()).toEqual([]);
  });

  it('falls back to timestamp-based event ids when crypto helpers are missing', () => {
    const originalCrypto = globalThis.crypto;
    try {
      Object.defineProperty(globalThis, 'crypto', {
        value: { getRandomValues: () => new Uint32Array([123]) },
        configurable: true,
      });
      const randomValueId = (component as any).nextClientEventId('wear');
      expect(randomValueId).toMatch(/^wear-/);

      Object.defineProperty(globalThis, 'crypto', {
        value: {},
        configurable: true,
      });
      const fallbackId = (component as any).nextClientEventId('wear');
      expect(fallbackId).toMatch(/^wear-/);
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: originalCrypto, configurable: true });
    }
  });

  it('covers load-more loading state, selected-item branch, and card selection toggles', () => {
    const localItems = [
      { ...ITEM, id: 'a', price: { amount: 10, originalCurrency: 'USD' }, brand: undefined as any, wearCount: 1 },
      { ...ITEM, id: 'b', price: { amount: 120, originalCurrency: 'USD' }, wearCount: 2 },
    ];
    (component as any).allItems.set(localItems);
    (component as any).nextToken.set('more');
    (component as any).hasMore.set(true);
    (component as any).loadingMore.set(true);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const loadMoreButton = Array.from(root.querySelectorAll('button')).find(
      button => button.textContent?.includes('Load More') || button.textContent?.includes('Loading...'),
    ) as HTMLButtonElement;
    expect(loadMoreButton?.disabled).toBe(true);
    expect(loadMoreButton?.textContent).toContain('Loading...');

    (component as any).loadingMore.set(false);
    fixture.detectChanges();
    expect(loadMoreButton?.textContent).toContain('Load More');

    component.onCardSelect(localItems[0]);
    fixture.detectChanges();
    expect((component as any).selectedItem()?.id).toBe('a');
    component.onCardSelect(localItems[0]);
    fixture.detectChanges();
    expect((component as any).selectedItem()).toBeNull();
  });

  it('uses randomUUID branch for client event IDs', () => {
    const originalCrypto = globalThis.crypto;
    try {
      Object.defineProperty(globalThis, 'crypto', {
        value: { randomUUID: vi.fn(() => 'uuid-1') },
        configurable: true,
      });
      const id = (component as any).nextClientEventId('wear');
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

    expect((component as any).buildQuery(explicit)).toEqual(expect.objectContaining({
      brand: 'Acme',
      condition: 'New',
      priceMin: 12,
      priceMax: 420,
      minWears: 3,
      sortField: 'wearCount',
      sortDir: 'asc',
      continuationToken: undefined,
    }));

    (router.navigate as any).mockClear();
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
    (component as any).allItems.set([]);
    expect(component.maxItemPrice()).toBe(5000);

    (component as any).allItems.set([
      { ...ITEM, id: 'x', price: { amount: 9000, originalCurrency: 'USD' }, brand: 'Alpha' },
      { ...ITEM, id: 'y', price: undefined, brand: 'Beta' },
      { ...ITEM, id: 'z', price: { amount: 420, originalCurrency: 'USD' }, brand: undefined },
      { ...ITEM, id: 'w', price: { amount: 7200, originalCurrency: 'USD' }, brand: 'Alpha' },
    ] as any[]);
    expect(component.maxItemPrice()).toBe(9000);
    expect((component as any).knownBrands()).toEqual(['Alpha', 'Beta']);
  });

  it('handles errors for suggestion accept and dismiss flows', () => {
    (component as any).wearSuggestions.set([SUGGESTION as any]);
    wardrobeService.logWear = vi.fn().mockReturnValue(throwError(() => new Error('retry later')));
    component.acceptSuggestion(SUGGESTION as any);
    expect((component as any).wearSuggestions().length).toBe(1);

    wardrobeService.updateWearSuggestionStatus = vi.fn().mockReturnValue(throwError(() => new Error('bad status')));
    component.dismissSuggestion(SUGGESTION as any);
    expect((component as any).wearSuggestions().length).toBe(1);
  });

  it('resets loadingMore when additional pages fail', () => {
    (component as any).nextToken.set('tok');
    (component as any).loadingMore.set(false);
    wardrobeService.getAll = vi.fn().mockReturnValue(throwError(() => new Error('paged fail')));
    component.loadMore();
    expect((component as any).loadingMore()).toBe(false);
  });

  it('routes settings open to shell profile panel on mobile and local panel on desktop', () => {
    Object.defineProperty(globalThis.window, 'innerWidth', { value: 390, configurable: true });
    (component as any).onWindowResize();
    mobileNavState.closePanel();
    (component as any).openSettings();
    expect(mobileNavState.activePanel()).toBe('profile');
    expect((component as any).settingsOpen()).toBe(false);

    mobileNavState.closePanel();
    Object.defineProperty(globalThis.window, 'innerWidth', { value: 1280, configurable: true });
    (component as any).onWindowResize();
    (component as any).openSettings();
    expect((component as any).settingsOpen()).toBe(true);
    expect(mobileNavState.activePanel()).toBe('none');
  });

  it('restores main focus target after settings panel close', async () => {
    const focusSpy = vi.spyOn(
      fixture.nativeElement.querySelector('[aria-label="Vault content"]') as HTMLElement,
      'focus',
    );

    (component as any).settingsOpen.set(true);
    (component as any).closeSettingsPanel();

    await Promise.resolve();
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('clears stale mobile panel before opening settings', () => {
    Object.defineProperty(globalThis.window, 'innerWidth', { value: 390, configurable: true });
    (component as any).onWindowResize();
    mobileNavState.openDigest();
    const closeSpy = vi.spyOn(mobileNavState, 'closePanel');

    (component as any).openSettings();

    expect(closeSpy).toHaveBeenCalled();
    expect(mobileNavState.activePanel()).toBe('profile');
  });
});
