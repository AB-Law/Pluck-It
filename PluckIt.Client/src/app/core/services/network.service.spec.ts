import { TestBed } from '@angular/core/testing';
import { NetworkService } from './network.service';

describe('NetworkService', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [NetworkService],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes with the browser online state', () => {
    vi.spyOn(globalThis.navigator, 'onLine', 'get').mockReturnValue(false);
    const localService = TestBed.inject(NetworkService);
    expect(localService.isOnline()).toBe(false);
    expect(localService.isCurrentlyOnline()).toBe(false);
  });

  it('tracks online/offline browser events', () => {
    vi.spyOn(globalThis.navigator, 'onLine', 'get').mockReturnValue(true);
    const localService = TestBed.inject(NetworkService);
    expect(localService.isOnline()).toBe(true);

    globalThis.window.dispatchEvent(new Event('offline'));
    expect(localService.isOnline()).toBe(false);

    globalThis.window.dispatchEvent(new Event('online'));
    expect(localService.isOnline()).toBe(true);
    expect(localService.isCurrentlyOnline()).toBe(true);
  });
});
