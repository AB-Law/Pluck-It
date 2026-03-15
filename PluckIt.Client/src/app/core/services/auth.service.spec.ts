import { TestBed } from '@angular/core/testing';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';
import { WritableSignal } from '@angular/core';

describe('AuthService', () => {
  let service: AuthService;
  const originalProduction = environment.production;
  type AuthServiceInternals = AuthService & {
    _user: WritableSignal<{ name: string; email: string; userId: string } | null>;
    _idToken: WritableSignal<string | null>;
    _tokenExp: WritableSignal<number>;
    waitForGIS: () => Promise<void>;
    handleCredentialResponse: (response: { credential: string }) => void;
  };
  const asInternal = (): AuthServiceInternals => service as unknown as AuthServiceInternals;

  const makeToken = (payload: Record<string, unknown>): string => {
    const base = {
      sub: 'u-1',
      email: 'a@b.com',
      name: 'Tester',
      exp: Math.floor(Date.now() / 1000) + 120,
      ...payload,
    };
    const body = btoa(JSON.stringify(base))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
    return `eyJhbGciOiJIUzI1NiJ9.${body}.signature`;
  };

  beforeEach(() => {
    environment.production = false;
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

  it('getIdToken returns null initially', () => {
    expect(service.getIdToken()).toBeNull();
  });

  it('ensureFreshToken does not call GIS prompt when token is fresh', () => {
    const prompt = vi.fn();
    const google = { accounts: { id: { prompt, disableAutoSelect: vi.fn(), renderButton: vi.fn() } } };
    Object.defineProperty(window, 'google', { value: google, configurable: true });

    asInternal()._user.set({ name: 'Tester', email: 'a@b.com', userId: 'u-1' });
    asInternal()._idToken.set('tkn');
    asInternal()._tokenExp.set(Math.floor(Date.now() / 1000) + 1000);

    service.ensureFreshToken();
    expect(prompt).not.toHaveBeenCalled();
  });

  it('ensureFreshToken calls prompt when token is near expiry', () => {
    const prompt = vi.fn();
    const google = { accounts: { id: { prompt, disableAutoSelect: vi.fn(), renderButton: vi.fn() } } };
    Object.defineProperty(window, 'google', { value: google, configurable: true });

    asInternal()._user.set({ name: 'Tester', email: 'a@b.com', userId: 'u-1' });
    asInternal()._tokenExp.set(Math.floor(Date.now() / 1000) + 10);
    service.ensureFreshToken();

    expect(prompt).toHaveBeenCalled();
  });

  it('initialize() restores a valid production session from localStorage', async () => {
    environment.production = true;
    const initializeSpy = vi.fn();
    const google = { accounts: { id: { initialize: initializeSpy, prompt: vi.fn(), disableAutoSelect: vi.fn(), renderButton: vi.fn() } } };
    Object.defineProperty(window, 'google', { value: google, configurable: true });

    const token = makeToken({ exp: Math.floor(Date.now() / 1000) + 600, userId: 'u-99' });
    localStorage.setItem('pluckit_auth', JSON.stringify({ idToken: token, exp: Math.floor(Date.now() / 1000) + 600, user: { name: 'Stored User', email: 'stored@a.com', userId: 'u-99' } }));
    await service.initialize();

    expect(service.user()?.userId).toBe('u-99');
    expect(service.getIdToken()).toBe(token);
    expect(initializeSpy).toHaveBeenCalled();
  });

  it('parseJwtPayload is used when processing credential response', () => {
    const token = makeToken({ name: 'Callback User', email: 'cb@a.com', sub: 'u-cb', exp: Math.floor(Date.now() / 1000) + 600 });
    service['handleCredentialResponse']({ credential: token });
    expect(service.user()?.name).toBe('Callback User');
    expect(service.getIdToken()).toBe(token);
  });

  it('renderButton forwards call to GIS', () => {
    const renderButton = vi.fn();
    Object.defineProperty(window, 'google', {
      value: { accounts: { id: { renderButton, prompt: vi.fn(), disableAutoSelect: vi.fn() } } },
      configurable: true,
    });
    const element = document.createElement('div');
    element.getBoundingClientRect = vi.fn().mockReturnValue({ width: 320 } as DOMRect);
    service.renderButton(element);
    expect(renderButton).toHaveBeenCalledWith(element, expect.anything());
  });

  it('logout() disables GIS auto-select and clears auth state', () => {
    const disableAutoSelect = vi.fn();
    Object.defineProperty(window, 'google', {
      value: { accounts: { id: { disableAutoSelect, initialize: vi.fn(), prompt: vi.fn(), renderButton: vi.fn() } } },
      configurable: true,
    });
    asInternal()._user.set({ name: 'Tester', email: 'a@b.com', userId: 'u-1' });
    asInternal()._idToken.set('token');

    service.logout();

    expect(disableAutoSelect).toHaveBeenCalled();
    expect(service.user()).toBeNull();
    expect(service.isAuthenticated()).toBe(false);
    expect(service.getIdToken()).toBeNull();
  });

  afterEach(() => {
    environment.production = originalProduction;
    vi.restoreAllMocks();
  });

  it('logout() clears localStorage auth payload', () => {
    const setItem = vi.spyOn(Storage.prototype, 'removeItem');
    localStorage.setItem(
      'pluckit_auth',
      JSON.stringify({ idToken: 'x', exp: Math.floor(Date.now() / 1000) + 3600, user: { name: 'Tester', email: 'x@y.com', userId: 'u-1' } }),
    );

    service.logout();

    expect(setItem).toHaveBeenCalledWith('pluckit_auth');
  });

  it('logout() clears the user signal', async () => {
    await service.initialize();
    expect(service.user()).not.toBeNull();
    service.logout();
    expect(service.user()).toBeNull();
    expect(service.isAuthenticated()).toBe(false);
  });

  it('initialize() handles invalid stored auth payload and continues auth bootstrap', async () => {
    environment.production = true;
    const initialize = vi.fn();
    const prompt = vi.fn((callback: (notification: { isNotDisplayed: () => boolean; isSkippedMoment: () => boolean }) => void) => {
      callback({ isNotDisplayed: () => true, isSkippedMoment: () => false });
    });
    vi.spyOn(asInternal(), 'waitForGIS').mockResolvedValue(undefined);
    Object.defineProperty(window, 'google', {
      value: { accounts: { id: { initialize, prompt, disableAutoSelect: vi.fn(), renderButton: vi.fn() } } },
      configurable: true,
    });

    localStorage.setItem('pluckit_auth', 'not-json');
    const removeItemSpy = vi.spyOn(Storage.prototype, 'removeItem');

    await service.initialize();

    expect(removeItemSpy).toHaveBeenCalledWith('pluckit_auth');
    expect(initialize).toHaveBeenCalled();
    expect(prompt).toHaveBeenCalled();
  });

  it('login() forwards to GIS prompt when available', () => {
    const prompt = vi.fn();
    Object.defineProperty(window, 'google', {
      value: { accounts: { id: { prompt, disableAutoSelect: vi.fn(), initialize: vi.fn(), renderButton: vi.fn() } } },
      configurable: true,
    });

    service.login();
    expect(prompt).toHaveBeenCalled();
  });
});
