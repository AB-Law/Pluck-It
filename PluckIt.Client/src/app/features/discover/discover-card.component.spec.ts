import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DiscoverCardComponent } from './discover-card.component';
import { ScrapedItem } from '../../core/models/scraped-item.model';

const ITEM: ScrapedItem = {
  id: 'item-1',
  sourceId: 'src-1',
  sourceType: 'reddit',
  title: 'Retro jacket',
  description: 'Nice jacket',
  imageUrl: '/img/jacket.jpg',
  productUrl: 'https://shop.example',
  tags: ['denim', 'vintage', 'winter'],
  buyLinks: [{ platform: 'yupoo', url: 'https://shop.example/buy', label: 'Buy' }],
  scoreSignal: 3,
  redditScore: 123,
  brand: null,
  price: '$120',
  scrapedAt: '2026-03-11T00:00:00Z',
  userId: 'u-1',
};

describe('DiscoverCardComponent', () => {
  let fixture: ComponentFixture<DiscoverCardComponent>;
  let component: DiscoverCardComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DiscoverCardComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(DiscoverCardComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('item', ITEM);
    fixture.detectChanges();
  });

  it('emits cardClicked with current item', () => {
    let clicked: ScrapedItem | null = null;
    component.cardClicked.subscribe((item) => {
      clicked = item;
    });

    const card = fixture.nativeElement.querySelector('div') as HTMLDivElement;
    card.click();

    expect(clicked).toEqual(ITEM);
  });

  it('updates score and emitted feedback on up vote', () => {
    let payload: { itemId: string; signal: 'up' | 'down'; galleryImageIndex?: number } | null = null;
    component.feedbackSent.subscribe((value) => { payload = value; });

    const up = fixture.nativeElement.querySelector('button[title="Love it"]') as HTMLButtonElement;
    up.click();
    fixture.detectChanges();

    expect(component.voted()).toBe('up');
    expect(component.localPlatformScore()).toBe(4);
    expect(payload).toEqual({ itemId: 'item-1', signal: 'up', galleryImageIndex: undefined });
  });

  it('toggles from up to down by adjusting score delta', () => {
    const up = fixture.nativeElement.querySelector('button[title="Love it"]') as HTMLButtonElement;
    const down = fixture.nativeElement.querySelector('button[title="Not for me"]') as HTMLButtonElement;
    const payloads: Array<{ itemId: string; signal: 'up' | 'down'; galleryImageIndex?: number }> = [];
    component.feedbackSent.subscribe((value) => { payloads.push(value); });

    up.click();
    down.click();

    expect(component.voted()).toBe('down');
    expect(component.localPlatformScore()).toBe(2);
    expect(payloads).toEqual([
      { itemId: 'item-1', signal: 'up', galleryImageIndex: undefined },
      { itemId: 'item-1', signal: 'down', galleryImageIndex: undefined },
    ]);
  });

  it('does not emit feedback when repeating the same vote', () => {
    let payloadCount = 0;
    component.feedbackSent.subscribe(() => { payloadCount += 1; });

    const up = fixture.nativeElement.querySelector('button[title="Love it"]') as HTMLButtonElement;
    up.click();
    up.click();

    expect(payloadCount).toBe(1);
  });

  it('returns reddit source badge class and swaps source type class', () => {
    expect(component.sourceBadgeClass()).toContain('bg-orange-900/70');

    fixture.componentRef.setInput('item', { ...ITEM, sourceType: 'brand' });
    fixture.detectChanges();
    expect(component.sourceBadgeClass()).toContain('bg-blue-900/70');
  });

  it('fallbacks image src on image error', () => {
    const event = new Event('error');
    const img = { src: '' } as HTMLImageElement;
    Object.defineProperty(event, 'target', { value: img });

    component.onImgError(event);

    expect(img.src).toContain('data:image/svg+xml');
  });
});
