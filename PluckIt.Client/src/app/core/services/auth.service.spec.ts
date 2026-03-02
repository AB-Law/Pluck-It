import { TestBed } from '@angular/core/testing';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [AuthService],
    });
    service = TestBed.inject(AuthService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('user signal is null before initialize()', () => {
    expect(service.user()).toBeNull();
  });

  it('initialize() sets dev user in non-production environment', async () => {
    // environment.production = false (uses the dev environment.ts)
    await service.initialize();
    const user = service.user();
    expect(user).not.toBeNull();
    expect(user?.userId).toBe('local-dev-user');
    expect(user?.name).toBe('Local Dev');
  });

  it('isAuthenticated() returns true after initialize() in dev mode', async () => {
    await service.initialize();
    expect(service.isAuthenticated()).toBe(true);
  });

  it('logout() clears the user signal', async () => {
    await service.initialize();
    expect(service.user()).not.toBeNull();
    service.logout();
    expect(service.user()).toBeNull();
    expect(service.isAuthenticated()).toBe(false);
  });
});
