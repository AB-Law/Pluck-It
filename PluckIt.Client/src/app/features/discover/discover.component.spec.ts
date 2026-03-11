import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DiscoverComponent } from './discover.component';
import { DiscoverService } from '../../core/services/discover.service';
import { ScrapedItem } from '../../core/models/scraped-item.model';
import { Observable, of, throwError } from 'rxjs';

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

    await TestBed.configureTestingModule({
      imports: [DiscoverComponent],
      providers: [
        { provide: DiscoverService, useValue: discoverService },
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

});
