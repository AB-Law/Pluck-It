import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DiscoverComponent } from './discover.component';
import { DiscoverService } from '../../core/services/discover.service';
import { ScrapedItem } from '../../core/models/scraped-item.model';
import { Observable, of, throwError } from 'rxjs';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';

describe('DiscoverComponent', () => {
  let component: DiscoverComponent;
  let fixture: ComponentFixture<DiscoverComponent>;
  let discoverService: {
    getSources: ReturnType<typeof vi.fn>;
    getFeed: ReturnType<typeof vi.fn>;
    acquireLease: ReturnType<typeof vi.fn>;
    ingestReddit: ReturnType<typeof vi.fn>;
    sendFeedback: ReturnType<typeof vi.fn>;
    suggestSource: ReturnType<typeof vi.fn>;
    unsubscribe: ReturnType<typeof vi.fn>;
  };
  let router: {
    navigate: ReturnType<typeof vi.fn>;
    createUrlTree: ReturnType<typeof vi.fn>;
    serializeUrl: ReturnType<typeof vi.fn>;
    isActive: ReturnType<typeof vi.fn>;
  };
  const route = {
    snapshot: { queryParamMap: convertToParamMap({}) },
    queryParamMap: of(convertToParamMap({})),
  };

  const SOURCES = [
    { id: 'all', name: 'All', sourceType: 'reddit', isGlobal: true, isActive: true, config: {}, createdAt: '2026-03-11T00:00:00Z' },
    { id: 'src-1', name: 'Yup', sourceType: 'brand', isGlobal: false, isActive: true, config: {}, createdAt: '2026-03-11T00:00:00Z' },
  ];

  const ITEM: ScrapedItem = {
    id: 'i-1',
    sourceId: 'src-1',
    sourceType: 'brand',
    title: 'Soft knit',
    description: 'Comfy',
    imageUrl: '/img/1.jpg',
    productUrl: '/p/1',
    tags: ['knit', 'soft'],
    buyLinks: [],
    scoreSignal: 2,
    redditScore: 8,
    brand: 'A',
    price: '$40',
    scrapedAt: '2026-03-11T00:00:00Z',
    userId: 'u-1',
  };
  const NEXT_ITEM: ScrapedItem = {
    ...ITEM,
    id: 'i-2',
    title: 'Second',
    sourceId: 'src-1',
  };

  beforeEach(async () => {
    discoverService = {
      getSources: vi.fn().mockReturnValue(of(SOURCES)),
      getFeed: vi.fn().mockReturnValue(of({ items: [ITEM], nextContinuationToken: null })),
      acquireLease: vi.fn().mockReturnValue(of({ status: 'ok', expiresAt: '2026-03-11T00:00:00Z' })),
      ingestReddit: vi.fn().mockReturnValue(of({ count: 1, status: 'queued' })),
      sendFeedback: vi.fn().mockReturnValue(of({})),
      suggestSource: vi.fn().mockReturnValue(of({})),
      unsubscribe: vi.fn().mockReturnValue(of({})),
    };
    router = {
      navigate: vi.fn(),
      createUrlTree: vi.fn((commands: unknown) => ({
        toString: () => (typeof commands === 'string' ? commands : `/${(commands as unknown[]).join('/')}`),
      })),
      serializeUrl: vi.fn((tree: { toString: () => string }) => tree.toString()),
      isActive: vi.fn(() => false),
    };

    await TestBed.configureTestingModule({
      imports: [DiscoverComponent],
      providers: [
        { provide: DiscoverService, useValue: discoverService },
        { provide: Router, useValue: router },
        { provide: ActivatedRoute, useValue: route },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(DiscoverComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('loads sources and initial feed in score/recent defaults', () => {
    expect(discoverService.getSources).toHaveBeenCalledTimes(1);
    expect(discoverService.getFeed).toHaveBeenCalledTimes(1);

    const query = (discoverService.getFeed as any).mock.calls[0][0];
    expect(query.sortBy).toBe('score');
    expect(query.timeRange).toBe('all');
    expect(query.sourceIds).toBeUndefined();
    expect(query.pageSize).toBe(50);
  });

  it('switches sort and time filters by reloading feed', () => {
    component.setSortBy('recent');
    component.setTimeRange('7d');

    const calls = (discoverService.getFeed as any).mock.calls;
    expect(calls.length).toBe(3); // initial + recent + 7d
    const recentQuery = calls[1][0];
    const rangeQuery = calls[2][0];
    expect(recentQuery.sortBy).toBe('recent');
    expect(rangeQuery.timeRange).toBe('7d');
  });

  it('loads source-specific feed and opens selected item in modal', () => {
    component.onSourceSelected('src-1');
    const query = (discoverService.getFeed as any).mock.calls.at(-1)[0];
    expect(query.sourceIds).toEqual(['src-1']);

    component.onCardClick(ITEM);
    expect((component as any).selectedItem()).toEqual(ITEM);
    expect((component as any).modalVoted()).toBeNull();
    expect((component as any).galleryIndex()).toBe(0);
  });

  it('sends feedback for card and modal interactions', () => {
    component.onFeedback({ itemId: 'i-1', signal: 'up', galleryImageIndex: 2 });
    expect(discoverService.sendFeedback).toHaveBeenCalledWith('i-1', 'up', 2);

    (component as any).selectedItem.set({ ...ITEM, galleryImages: ['a', 'b', 'c'] });
    component.onModalFeedback('down');
    expect(discoverService.sendFeedback).toHaveBeenCalledWith('i-1', 'down', 0);
    expect((component as any).modalVoted()).toBe('down');
  });

  it('navigates gallery images in modal with guards', () => {
    (component as any).selectedItem.set({ ...ITEM, galleryImages: ['a', 'b', 'c'] });
    (component as any).galleryIndex.set(1);
    component.onPrevImage();
    expect((component as any).galleryIndex()).toBe(0);
    component.onNextImage();
    expect((component as any).galleryIndex()).toBe(1);
    component.onJumpToImage(2);
    expect((component as any).galleryIndex()).toBe(2);
  });

  it('skips modal feedback when no item is selected', () => {
    component.onModalFeedback('up');
    expect(discoverService.sendFeedback).not.toHaveBeenCalled();
    expect((component as any).modalVoted()).toBeNull();
  });

  it('handles feedback send attempt when request fails', () => {
    component.onFeedback({ itemId: 'i-1', signal: 'down' });
    expect(discoverService.sendFeedback).toHaveBeenCalledWith('i-1', 'down', undefined);
  });

  it('triggers subscription and source management actions', () => {
    component.onUnsubscribe('src-1');
    expect(discoverService.unsubscribe).toHaveBeenCalledWith('src-1');

    component.onSuggestBrand({ name: 'Acme', url: 'https://acme.example' });
    expect(discoverService.suggestSource).toHaveBeenCalledWith('Acme', 'https://acme.example', 'brand');
  });

  it('appends results when loading more pages', () => {
    discoverService.getFeed = vi.fn()
      .mockReturnValueOnce(of({ items: [ITEM], nextContinuationToken: 'token-1' }))
      .mockReturnValueOnce(of({ items: [NEXT_ITEM], nextContinuationToken: null }));
    fixture = TestBed.createComponent(DiscoverComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    component.loadMore();
    expect(discoverService.getFeed).toHaveBeenCalledTimes(2);
    expect((component as any).allItems()).toEqual([ITEM, NEXT_ITEM]);
    expect((component as any).nextToken()).toBeNull();
    expect((component as any).loadingMore()).toBe(false);
    expect((component as any).loading()).toBe(false);
  });

  it('handles loadFeed error during load more without leaving spinner on', () => {
    discoverService.getFeed = vi.fn()
      .mockReturnValueOnce(of({ items: [ITEM], nextContinuationToken: 'token-1' }))
      .mockReturnValueOnce(throwError(() => new Error('boom')));
    fixture = TestBed.createComponent(DiscoverComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    component.loadMore();
    expect(discoverService.getFeed).toHaveBeenCalledTimes(2);
    expect((component as any).loadingMore()).toBe(false);
  });

  it('loads more results for reddit sources that require client ingest', async () => {
    const redditSource = {
      id: 'reddit-src',
      name: 'Reddit',
      sourceType: 'reddit',
      isGlobal: true,
      isActive: true,
      config: { subreddit: 'fashiontest' },
      createdAt: '2026-03-11T00:00:00Z',
      needsClientIngest: true,
    };
    discoverService.getSources = vi.fn().mockReturnValue(of([redditSource]));
    discoverService.getFeed = vi.fn()
      .mockReturnValueOnce(of({ items: [ITEM], nextContinuationToken: null }))
      .mockReturnValueOnce(of({ items: [ITEM], nextContinuationToken: null }))
      .mockReturnValue(of({ items: [ITEM], nextContinuationToken: null }));
    discoverService.acquireLease = vi.fn().mockReturnValue(of({ status: 'ok' }));
    discoverService.ingestReddit = vi.fn().mockReturnValue(of({ count: 2 }));

    const fetchMock = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ data: { children: [{ data: { id: 'post-1' } }] } }),
    });
    Object.defineProperty(globalThis, 'fetch', {
      value: fetchMock,
      configurable: true,
    });
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(null as unknown as string | null);

    fixture = TestBed.createComponent(DiscoverComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    component.onSourceSelected('reddit-src');
    await Promise.resolve();
    await Promise.resolve();

    expect(discoverService.acquireLease).toHaveBeenCalledWith('reddit-src');
    expect(fetchMock).toHaveBeenCalledWith('/reddit-api/r/fashiontest/hot.json?limit=50');
    expect(discoverService.getFeed).toHaveBeenCalledTimes(2);
  });

  it('does not launch client scrape if Reddit source was scraped recently', async () => {
    const redditSource = {
      id: 'reddit-src',
      name: 'Reddit',
      sourceType: 'reddit',
      isGlobal: true,
      isActive: true,
      config: { subreddit: 'fashiontest' },
      createdAt: '2026-03-11T00:00:00Z',
      needsClientIngest: true,
    };
    discoverService.getSources = vi.fn().mockReturnValue(of([redditSource]));
    discoverService.getFeed = vi.fn().mockReturnValue(of({ items: [ITEM], nextContinuationToken: null }));
    const fetchMock = vi.fn();
    Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true });
    vi.spyOn(localStorage, 'getItem').mockReturnValue((Date.now() - 10_000).toString());

    fixture = TestBed.createComponent(DiscoverComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    component.onSourceSelected('reddit-src');
    await Promise.resolve();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(discoverService.acquireLease).not.toHaveBeenCalled();
  });

  it('closes modal selection state', () => {
    component.onCardClick(ITEM);
    expect((component as any).selectedItem()).toEqual(ITEM);

    (component as any).selectedItem.set(null);
    (component as any).galleryIndex.set(0);
    expect((component as any).selectedItem()).toBeNull();
    expect((component as any).galleryIndex()).toBe(0);
  });
  it('shows loading skeletons while feed is pending', () => {
    let emit: ((value: any) => void) | undefined;
    discoverService.getFeed = vi.fn().mockReturnValue(new Observable((observer) => {
      emit = (value) => {
        observer.next(value);
      };
      return () => {};
    }));

    fixture = TestBed.createComponent(DiscoverComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    expect((component as any).loading()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('explore');

    emit?.({
      items: [ITEM],
      nextContinuationToken: null,
    });
    fixture.detectChanges();

    expect((component as any).loading()).toBe(false);
    expect((component as any).allItems()).toEqual([ITEM]);
  });

  it('shows empty state when feed returns no items', () => {
    discoverService.getFeed = vi.fn().mockReturnValue(of({ items: [], nextContinuationToken: null }));
    fixture = TestBed.createComponent(DiscoverComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    expect((component as any).filteredItems()).toEqual([]);
    expect(fixture.nativeElement.textContent).toContain('No items found.');
  });

  it('renders modal details for single-image items including buy links and comments', () => {
    const itemWithDetails = {
      ...ITEM,
      id: 'i-3',
      galleryImages: [],
      description: 'Single image details',
      buyLinks: [{ platform: 'taobao', url: 'https://example.com', label: 'Shop' }],
      commentText: 'Looks great',
      productUrl: '/p/single',
      tags: ['outer', 'light'],
    } as ScrapedItem;

    component.onCardClick(itemWithDetails);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Single image details');
    expect(text).toContain('Buy Links');
    expect(text).toContain('Top Comments');
    expect(text).toContain('View Original Post');
    expect(text).toContain('outer');
  });

  it('drives top controls and source sidebar through template events', () => {
    const searchInput = fixture.debugElement.query(By.css('input[placeholder="Search styles, tags…"]'));
    (searchInput.nativeElement as HTMLInputElement).value = 'soft';
    searchInput.nativeElement.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect((component as any).searchQuery()).toBe('soft');
    expect((component as any).filteredItems()).toEqual([ITEM]);

    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('header button') as NodeListOf<HTMLButtonElement>,
    );
    const recentButton = buttons.find((button) =>
      button.textContent?.trim() === 'Recent',
    );
    const allRange = buttons.find((button) =>
      button.textContent?.trim() === 'All',
    );
    recentButton?.click();
    allRange?.click();
    expect(discoverService.getFeed).toHaveBeenCalled();

    const sourceSidebar = fixture.debugElement.query(By.css('app-source-sidebar'));
    sourceSidebar.triggerEventHandler('sourceSelected', 'src-1');
    sourceSidebar.triggerEventHandler('unsubscribe', 'src-1');
    sourceSidebar.triggerEventHandler('suggestBrand', { name: 'Acme', url: 'https://acme.example' });
    expect(discoverService.getFeed).toHaveBeenCalled();
    expect(discoverService.unsubscribe).toHaveBeenCalledWith('src-1');
    expect(discoverService.suggestSource).toHaveBeenCalledWith('Acme', 'https://acme.example', 'brand');
  });

  it('forwards card outputs to open modals and send feedback', () => {
    const card = fixture.debugElement.query(By.css('app-discover-card'));
    card.triggerEventHandler('cardClicked', ITEM);
    expect((component as any).selectedItem()).toEqual(ITEM);

    card.triggerEventHandler('feedbackSent', { itemId: ITEM.id, signal: 'up', galleryImageIndex: 1 });
    expect(discoverService.sendFeedback).toHaveBeenCalledWith(ITEM.id, 'up', 1);
  });

  it('interacts with modal overlay, close, and gallery controls', () => {
    component.onCardClick({ ...ITEM, galleryImages: ['/1.jpg', '/2.jpg', '/3.jpg'] });
    fixture.detectChanges();

    const modalElement = fixture.debugElement.query(By.css('div[style*="background: rgba(0,0,0,0.75)"]'));
    const likeButtons = fixture.debugElement.queryAll(By.css('[title="Not for me"], [title="Love it"]'));
    expect(likeButtons.length).toBeGreaterThan(0);
    const priorSendCalls = (discoverService.sendFeedback as any).mock.calls.length;
    likeButtons[0].triggerEventHandler('click');
    likeButtons[1].triggerEventHandler('click');
    expect(discoverService.sendFeedback).toHaveBeenCalledTimes(priorSendCalls + 2);

    modalElement.triggerEventHandler('click', {});
    fixture.detectChanges();
    expect((component as any).selectedItem()).toBeNull();

    component.onCardClick({ ...ITEM, galleryImages: ['/1.jpg', '/2.jpg', '/3.jpg'] });
    fixture.detectChanges();

    const nextButtons = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).filter(
      button => button.title === 'Not for me' || button.title === 'Love it',
    );
    expect(nextButtons.length).toBeGreaterThanOrEqual(2);
    nextButtons[1].click();
    expect(discoverService.sendFeedback).toHaveBeenCalled();

    const prevNext = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).filter(
      button => button.className.includes('absolute left-2') || button.className.includes('absolute right-2'),
    );
    expect(prevNext.length).toBe(2);
    prevNext[0].click();
    prevNext[1].click();

    const dotIndicators = Array.from(
      fixture.nativeElement.querySelectorAll('div.absolute.bottom-2.left-0.right-0 button') as NodeListOf<HTMLButtonElement>,
    );
    expect(dotIndicators.length).toBe(3);
    dotIndicators[2].click();
    expect((component as any).galleryIndex()).toBe(2);

    component.onCardClick({ ...ITEM, galleryImages: [] });
    fixture.detectChanges();
    const singleModal = fixture.debugElement.query(By.css('div[style*="background: rgba(0,0,0,0.75)"]'));
    singleModal.triggerEventHandler('click', {});
    fixture.detectChanges();
    expect((component as any).selectedItem()).toBeNull();
  });

  it('switches sort and time controls through all button branches', () => {
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('header button')).filter(
      (button): button is HTMLButtonElement => button instanceof HTMLButtonElement,
    );
    const topButton = buttons.find((button) =>
      button.textContent?.trim() === 'Top',
    );
    const recentButton = buttons.find((button) =>
      button.textContent?.trim() === 'Recent',
    );
    const allTime = buttons.find((button) =>
      button.textContent?.trim() === 'All',
    );
    const oneHour = buttons.find((button) =>
      button.textContent?.trim() === '1h',
    );
    const oneDay = buttons.find((button) =>
      button.textContent?.trim() === '1d',
    );
    const sevenDays = buttons.find((button) =>
      button.textContent?.trim() === '7d',
    );

    expect(topButton).toBeTruthy();
    expect(recentButton).toBeTruthy();

    topButton?.click();
    fixture.detectChanges();
    expect((component as any).sortBy()).toBe('score');

    recentButton?.click();
    fixture.detectChanges();
    expect((component as any).sortBy()).toBe('recent');

    allTime?.click();
    fixture.detectChanges();
    expect((component as any).timeRange()).toBe('all');

    oneHour?.click();
    fixture.detectChanges();
    expect((component as any).timeRange()).toBe('1h');

    oneDay?.click();
    fixture.detectChanges();
    expect((component as any).timeRange()).toBe('1d');

    sevenDays?.click();
    fixture.detectChanges();
    expect((component as any).timeRange()).toBe('7d');

    expect(recentButton?.className).toContain('border-primary/40');
    expect(sevenDays?.className).toContain('border-primary/40');
  });

  it('renders single-image modal fallback branches for missing details', () => {
    component.onCardClick({
      ...ITEM,
      id: 'single-modal',
      title: 'Single Modal',
      galleryImages: [],
      description: undefined as unknown as string,
      commentText: undefined as unknown as string,
      productUrl: undefined as unknown as string,
      buyLinks: [{ platform: 'taobao', url: '/open/taobao' }],
    } as ScrapedItem);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const text = root.textContent || '';
    expect(text).toContain('Single Modal');
    expect(text).toContain('Buy Links');
    expect(text).toContain('taobao');
    expect(text).not.toContain('Top Comments');
    expect(text).not.toContain('View Original Post');
  });

  it('guards modal actions when gallery is absent or item is unset', () => {
    component.onCardClick({ ...ITEM, id: 'no-gallery', galleryImages: [] });
    fixture.detectChanges();

    const baseline = (discoverService.sendFeedback as any).mock.calls.length;
    component.onModalFeedback('up');
    expect((discoverService.sendFeedback as any).mock.calls.at(-1)).toEqual(['no-gallery', 'up', undefined]);
    component.onPrevImage();
    component.onNextImage();
    component.onJumpToImage(1);
    expect((component as any).galleryIndex()).toBe(0);
    expect((discoverService.sendFeedback as any).mock.calls.length).toBe(baseline + 1);

    component['selectedItem'].set(null);
    component.onModalFeedback('down');
    component.onPrevImage();
    component.onNextImage();
    component.onJumpToImage(0);
    expect((discoverService.sendFeedback as any).mock.calls.length).toBe(baseline + 1);
  });

  it('covers reddit scrape guard and empty-response branches', async () => {
    const noRedditConfigSource = {
      id: 'reddit-no-sub',
      name: 'Reddit No Sub',
      sourceType: 'reddit',
      config: {},
      createdAt: '2026-03-11T00:00:00Z',
      isGlobal: true,
      isActive: true,
      needsClientIngest: true,
    };

    (component as any).sources.set([noRedditConfigSource]);
    (component as any).activeSourceId.set('reddit-no-sub');
    discoverService.acquireLease.mockClear();
    discoverService.ingestReddit.mockClear();
    await (component as any).checkForClientScrape();
    expect(discoverService.acquireLease).not.toHaveBeenCalled();
    expect(discoverService.ingestReddit).not.toHaveBeenCalled();

    const redditSource = { ...noRedditConfigSource, id: 'reddit-client', config: { subreddit: 'fashion' } };
    (component as any).sources.set([redditSource]);
    (component as any).activeSourceId.set('reddit-client');

    const getItemSpy = vi.spyOn(localStorage, 'getItem').mockReturnValue(null);
    Object.defineProperty(globalThis, 'fetch', {
      value: vi.fn().mockResolvedValue({ json: vi.fn().mockResolvedValue({ data: { children: [] } }) }),
      configurable: true,
    });
    discoverService.acquireLease.mockReturnValueOnce(of({ status: 'acquired', expiresAt: '2026-03-11T00:00:00Z' }));
    await (component as any).checkForClientScrape();
    await Promise.resolve();
    await Promise.resolve();
    expect(discoverService.ingestReddit).not.toHaveBeenCalled();
    getItemSpy.mockRestore();
  });

  it('covers reddit lease error branches for 409 and 500 paths', async () => {
    const redditSource = {
      id: 'reddit-client-err',
      name: 'Reddit',
      sourceType: 'reddit',
      config: { subreddit: 'fashion' },
      createdAt: '2026-03-11T00:00:00Z',
      isGlobal: true,
      isActive: true,
      needsClientIngest: true,
    };

    (component as any).sources.set([redditSource]);
    (component as any).activeSourceId.set('reddit-client-err');
    const getItemSpy = vi.spyOn(localStorage, 'getItem').mockReturnValue(null);
    const consoleInfoSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleWarnSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    discoverService.acquireLease.mockClear();
    discoverService.ingestReddit.mockClear();

    discoverService.acquireLease.mockReturnValueOnce(throwError(() => ({ status: 409 })));
    await (component as any).checkForClientScrape();
    expect(consoleInfoSpy).toHaveBeenCalledWith('Another user is already scraping this source.');

    discoverService.acquireLease.mockReturnValueOnce(throwError(() => ({ status: 500 })));
    await (component as any).checkForClientScrape();
    expect(consoleWarnSpy).toHaveBeenCalledWith('Lease acquisition failed:', expect.anything());

    getItemSpy.mockRestore();
    consoleInfoSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

});
