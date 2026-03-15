import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { StylistService } from './stylist.service';

describe('StylistService', () => {
  let service: StylistService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [StylistService],
    });
    service = TestBed.inject(StylistService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('posts recommendation requests and returns parsed list', () => {
    const expected = [{ id: 'outfit-1', title: 'Summer', description: 'Chill fit', clothingItemIds: ['i1', 'i2'] }];
    let payload: { id: string; title: string; description: string; clothingItemIds: string[] }[] | null = null;

    service.getRecommendations({
      stylePrompt: 'minimal',
      occasion: 'casual',
      preferredColors: ['black'],
      excludedColors: ['yellow'],
    }).subscribe((res) => {
      payload = res;
    });

    const req = http.expectOne((request) =>
      request.method === 'POST' && request.url.includes('/api/stylist/recommendations'),
    );
    expect(req.request.body).toEqual({
      stylePrompt: 'minimal',
      occasion: 'casual',
      preferredColors: ['black'],
      excludedColors: ['yellow'],
    });
    req.flush(expected);

    expect(payload).toEqual(expected);
  });
});
