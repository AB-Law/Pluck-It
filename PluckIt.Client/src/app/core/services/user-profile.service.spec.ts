import { TestBed } from '@angular/core/testing';
import {
  provideHttpClient,
  withInterceptorsFromDi,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { UserProfileService, UserProfile } from './user-profile.service';

const MOCK_PROFILE: UserProfile = {
  id: 'user-001',
  currencyCode: 'GBP',
  preferredSizeSystem: 'UK',
  stylePreferences: ['minimalist'],
  favoriteBrands: ['Zara'],
  preferredColours: ['white', 'navy'],
};

describe('UserProfileService', () => {
  let service: UserProfileService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        UserProfileService,
      ],
    });
    service = TestBed.inject(UserProfileService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('profile signal is null before load()', () => {
    expect(service.profile()).toBeNull();
  });

  it('load() populates the profile signal', () => {
    service.load().subscribe();
    const req = http.expectOne(r => r.url.includes('/api/profile') && r.method === 'GET');
    req.flush(MOCK_PROFILE);
    expect(service.profile()).toEqual(MOCK_PROFILE);
  });

  it('update() sends PUT and updates the signal', () => {
    service.update(MOCK_PROFILE).subscribe();
    const req = http.expectOne(r => r.url.includes('/api/profile') && r.method === 'PUT');
    expect(req.request.body).toEqual(MOCK_PROFILE);
    req.flush(null);
    expect(service.profile()).toEqual(MOCK_PROFILE);
  });

  it('getOrDefault() returns default when profile is null', () => {
    const defaults = service.getOrDefault();
    expect(defaults.currencyCode).toBe('USD');
    expect(defaults.stylePreferences).toEqual([]);
  });

  it('getOrDefault() returns loaded profile when available', () => {
    service['profile'].set(MOCK_PROFILE);
    expect(service.getOrDefault().currencyCode).toBe('GBP');
  });
});
