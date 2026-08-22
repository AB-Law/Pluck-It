import { Injectable, signal } from '@angular/core';

export type AppTheme = 'light' | 'dark';
type ThemePreference = AppTheme | 'system';

/**
 * Centralized light/dark theme manager with persisted user override.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private static readonly STORAGE_KEY = 'pluckit-theme-preference';
  private readonly mediaQuery =
    globalThis.matchMedia?.('(prefers-color-scheme: dark)') ?? null;
  private readonly preference = signal<ThemePreference>('system');
  readonly theme = signal<AppTheme>('dark');

  initialize(): void {
    const stored = this.readStoredPreference();
    this.preference.set(stored);
    this.applyTheme(this.resolveTheme(stored));
    this.bindSystemPreferenceListener();
  }

  setTheme(theme: AppTheme): void {
    this.preference.set(theme);
    this.persistPreference(theme);
    this.applyTheme(theme);
  }

  toggleTheme(): void {
    this.setTheme(this.theme() === 'dark' ? 'light' : 'dark');
  }

  private resolveTheme(preference: ThemePreference): AppTheme {
    if (preference !== 'system') {
      return preference;
    }
    return this.mediaQuery?.matches ? 'dark' : 'light';
  }

  private applyTheme(theme: AppTheme): void {
    this.theme.set(theme);
    const root = globalThis.document?.documentElement;
    if (!root) {
      return;
    }
    root.dataset['theme'] = theme;
    root.classList.toggle('dark', theme === 'dark');
  }

  private readStoredPreference(): ThemePreference {
    const value = globalThis.localStorage?.getItem(ThemeService.STORAGE_KEY);
    if (value === 'light' || value === 'dark' || value === 'system') {
      return value;
    }
    return 'system';
  }

  private persistPreference(preference: ThemePreference): void {
    globalThis.localStorage?.setItem(ThemeService.STORAGE_KEY, preference);
  }

  private bindSystemPreferenceListener(): void {
    if (!this.mediaQuery) {
      return;
    }
    this.mediaQuery.addEventListener('change', (event) => {
      if (this.preference() !== 'system') {
        return;
      }
      this.applyTheme(event.matches ? 'dark' : 'light');
    });
  }
}
