import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { VaultInsightsService } from './vault-insights.service';

describe('VaultInsightsService', () => {
  let service: VaultInsightsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        VaultInsightsService,
      ],
    });
    service = TestBed.inject(VaultInsightsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('getInsights() calls /api/insights/vault with params', () => {
    service.getInsights(90, 100).subscribe();
    const req = http.expectOne(r => r.url.includes('/api/insights/vault') && r.method === 'GET');
    expect(req.request.params.get('windowDays')).toBe('90');
    expect(req.request.params.get('targetCpw')).toBe('100');
    req.flush({
      generatedAt: '2026-03-04T00:00:00Z',
      currency: 'USD',
      insufficientData: true,
      behavioralInsights: {},
      cpwIntel: [],
    });
  });
});

