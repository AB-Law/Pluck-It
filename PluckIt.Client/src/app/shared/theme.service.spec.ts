import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  const setMatchMedia = (matches: boolean) => {
    Object.defineProperty(globalThis, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches,
        addEventListener: vi.fn(),
      }),
    });
  };

  beforeEach(() => {
    const storage = {
      store: new Map<string, string>(),
      getItem(key: string) {
        return this.store.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        this.store.set(key, value);
      },
      removeItem(key: string) {
        this.store.delete(key);
      },
      clear() {
        this.store.clear();
      },
    };
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: storage,
    });
    document.documentElement.dataset['theme'] = '';
    document.documentElement.classList.remove('dark');
  });

  it('uses system preference on first load and applies dark class', () => {
    setMatchMedia(true);
    const service = TestBed.runInInjectionContext(() => new ThemeService());
    service.initialize();

    expect(service.theme()).toBe('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('applies persisted manual preference over system preference', () => {
    setMatchMedia(true);
    localStorage.setItem('pluckit-theme-preference', 'light');
    const service = TestBed.runInInjectionContext(() => new ThemeService());
    service.initialize();

    expect(service.theme()).toBe('light');
    expect(document.documentElement.dataset['theme']).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('toggles and persists user override', () => {
    setMatchMedia(false);
    const service = TestBed.runInInjectionContext(() => new ThemeService());
    service.initialize();
    service.toggleTheme();

    expect(service.theme()).toBe('dark');
    expect(localStorage.getItem('pluckit-theme-preference')).toBe('dark');
  });
});
