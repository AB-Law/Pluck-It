import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ThemeService } from './theme.service';

/**
 * Shared authenticated-app header used across main application routes.
 *
 * Provides a consistent logo, search input, primary navigation, and
 * common icon actions with tooltip/assistive text so users can discover
 * the purpose of each control at a glance.
 */
@Component({
  selector: 'app-shared-header',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <header
      class="flex flex-wrap items-center justify-between gap-2 border-b border-app-soft bg-background-dark/90 backdrop-blur-sm px-4 py-3 md:px-6 md:py-4 shrink-0 z-50"
    >
      <div class="flex items-center gap-3 min-w-0">
        <a
          routerLink="/"
          class="flex items-center gap-3 text-chrome"
          title="Open your dashboard"
          aria-label="Open your dashboard"
        >
          <span class="inline-flex h-2 w-2 rounded-full bg-primary"></span>
          <h2 class="text-chrome text-base md:text-xl font-medium tracking-tight">Pluck It</h2>
          <span class="hidden lg:inline text-xs text-app-soft italic">- a wardrobe journal</span>
        </a>

        <label class="hidden md:flex flex-col min-w-[260px] lg:min-w-[320px]">
          <div
            class="flex w-full items-center rounded-lg bg-card-dark border border-border-chrome focus-within:border-primary/60 transition-colors"
          >
            <div class="flex items-center justify-center pl-3 text-slate-text">
              <span class="material-symbols-outlined" style="font-size:20px">search</span>
            </div>
            <input
              class="w-full bg-transparent border-none text-sm text-chrome placeholder-slate-text outline-none py-2.5 px-3"
              [ngModel]="searchValue"
              (ngModelChange)="searchValueChange.emit($event)"
              [placeholder]="searchPlaceholder"
              [title]="searchPlaceholder"
              [attr.aria-label]="searchPlaceholder"
            />
          </div>
        </label>
      </div>

      <div class="flex items-center gap-2">
        @if (showSearch) {
          <button
            type="button"
            class="md:hidden h-10 w-10 flex items-center justify-center rounded-lg bg-card-dark text-slate-text hover:text-chrome hover:bg-bg-soft touch-target"
            title="Search"
            aria-label="Open search"
            (click)="toggleSearch()"
          >
            <span class="material-symbols-outlined" style="font-size:20px">search</span>
          </button>
        }

        @if (showUpload) {
          <div class="relative group">
            <button
              type="button"
              class="h-10 w-10 rounded-lg bg-card-dark text-slate-text hover:text-chrome hover:bg-bg-soft flex items-center justify-center touch-target"
              title="Upload item"
              aria-label="Upload item"
              (click)="uploadRequested.emit()"
            >
              <span class="material-symbols-outlined" style="font-size:18px">upload_file</span>
            </button>
            <span
              data-nav-tooltip
              class="pointer-events-none absolute left-1/2 top-full z-20 mt-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-card-dark px-2 py-1 text-xs text-chrome opacity-0 shadow-soft transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
            >
              Upload
            </span>
          </div>
        }

        @if (showFilterShortcut) {
          <button
            type="button"
            class="lg:hidden h-10 w-10 rounded-lg bg-card-dark text-slate-text hover:text-chrome hover:bg-bg-soft flex items-center justify-center touch-target"
            title="Open filters"
            aria-label="Open filters"
            (click)="filtersRequested.emit()"
          >
            <span class="material-symbols-outlined" style="font-size:20px">tune</span>
          </button>
        }

        @if (showStylistShortcut) {
          <div class="relative group">
            <button
              type="button"
              class="h-10 w-10 rounded-lg bg-card-dark text-slate-text hover:text-chrome hover:bg-bg-soft flex items-center justify-center touch-target"
              title="Open stylist chat"
              aria-label="Open stylist chat"
              (click)="stylistRequested.emit()"
            >
              <span class="material-symbols-outlined" style="font-size:20px">smart_toy</span>
            </button>
            <span
              data-nav-tooltip
              class="pointer-events-none absolute left-1/2 top-full z-20 mt-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-card-dark px-2 py-1 text-xs text-chrome opacity-0 shadow-soft transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
            >
              Stylist
            </span>
          </div>
        }

        @if (showBackShortcut) {
          <a
            routerLink="/"
            class="hidden md:flex h-10 w-10 items-center justify-center rounded-lg bg-card-dark text-slate-text hover:text-chrome hover:bg-bg-soft transition-colors touch-target"
            title="{{ backShortcutLabel }}"
            aria-label="{{ backShortcutLabel }}"
          >
            <span class="material-symbols-outlined" style="font-size:20px">home</span>
          </a>
        }

        <div class="relative group hidden md:block">
          <a
            routerLink="/vault"
            class="flex h-10 w-10 items-center justify-center rounded-lg text-sm border transition-colors touch-target"
            [ngClass]="navButtonClass('vault')"
            title="Digital Vault"
            aria-label="Go to your digital vault"
          >
            <span class="material-symbols-outlined" style="font-size:20px">inventory_2</span>
          </a>
          <span
            data-nav-tooltip
            class="pointer-events-none absolute left-1/2 top-full z-20 mt-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-card-dark px-2 py-1 text-xs text-chrome opacity-0 shadow-soft transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
          >
            Vault
          </span>
        </div>

        <div class="relative group hidden md:block">
          <a
            routerLink="/collections"
            class="flex h-10 w-10 items-center justify-center rounded-lg text-sm border transition-colors touch-target"
            [ngClass]="navButtonClass('collections')"
            title="My Collections"
            aria-label="Go to your collections"
          >
            <span class="material-symbols-outlined" style="font-size:20px">folder_special</span>
          </a>
          <span
            data-nav-tooltip
            class="pointer-events-none absolute left-1/2 top-full z-20 mt-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-card-dark px-2 py-1 text-xs text-chrome opacity-0 shadow-soft transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
          >
            Collections
          </span>
        </div>

        <div class="relative group hidden md:block">
          <a
            routerLink="/discover"
            class="flex h-10 w-10 items-center justify-center rounded-lg text-sm border transition-colors touch-target"
            [ngClass]="navButtonClass('discover')"
            title="Discover"
            aria-label="Open discover feed"
          >
            <span class="material-symbols-outlined" style="font-size:20px">explore</span>
          </a>
          <span
            data-nav-tooltip
            class="pointer-events-none absolute left-1/2 top-full z-20 mt-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-card-dark px-2 py-1 text-xs text-chrome opacity-0 shadow-soft transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
          >
            Discover
          </span>
        </div>

        @if (showDigest) {
          <div class="relative group">
            <button
              class="h-10 w-10 rounded-lg bg-card-dark text-slate-text hover:text-chrome hover:bg-bg-soft flex items-center justify-center touch-target"
              title="Open weekly digest"
              aria-label="Open weekly digest"
              (click)="digestRequested.emit()"
            >
              <span class="material-symbols-outlined" style="font-size:20px">tips_and_updates</span>
            </button>
            <span
              data-nav-tooltip
              class="pointer-events-none absolute left-1/2 top-full z-20 mt-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-card-dark px-2 py-1 text-xs text-chrome opacity-0 shadow-soft transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
            >
              Weekly digest
            </span>
          </div>
        }

        <div class="relative group hidden md:block">
          <button
              class="h-10 w-10 rounded-lg bg-card-dark text-slate-text hover:text-chrome hover:bg-bg-soft flex items-center justify-center touch-target"
            title="Open notifications"
            aria-label="Open notifications"
            (click)="notificationsRequested.emit()"
            type="button"
          >
            <span class="material-symbols-outlined" style="font-size:20px">notifications</span>
          </button>
          <span
            data-nav-tooltip
            class="pointer-events-none absolute left-1/2 top-full z-20 mt-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-card-dark px-2 py-1 text-xs text-chrome opacity-0 shadow-soft transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
          >
            Notifications
          </span>
        </div>

        <div class="relative group">
          <button
              class="h-10 w-10 rounded-lg bg-card-dark text-slate-text hover:text-chrome hover:bg-bg-soft flex items-center justify-center touch-target"
            title="Open settings"
            aria-label="Open settings"
            (click)="settingsRequested.emit()"
            type="button"
          >
            <span class="material-symbols-outlined" style="font-size:20px">settings</span>
          </button>
          <span
            data-nav-tooltip
            class="pointer-events-none absolute left-1/2 top-full z-20 mt-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-card-dark px-2 py-1 text-xs text-chrome opacity-0 shadow-soft transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
          >
            Settings
          </span>
        </div>

        <button
          class="h-10 w-10 rounded-lg bg-card-dark text-slate-text hover:text-chrome hover:bg-bg-soft flex items-center justify-center touch-target"
          [title]="themeToggleLabel()"
          [attr.aria-label]="themeToggleLabel()"
          (click)="toggleTheme()"
          type="button"
        >
          <span class="material-symbols-outlined" style="font-size:20px">{{
            themeService.theme() === 'dark' ? 'light_mode' : 'dark_mode'
          }}</span>
        </button>
      </div>

      @if (searchOpen()) {
        <label class="w-full md:hidden">
          <div
            class="mt-2 flex w-full items-center rounded-lg bg-card-dark border border-border-chrome focus-within:border-primary/60 transition-colors"
          >
            <div class="flex items-center justify-center pl-3 text-slate-text">
              <span class="material-symbols-outlined" style="font-size:20px">search</span>
            </div>
            <input
              class="w-full bg-transparent border-none text-sm text-chrome placeholder-slate-text outline-none py-2.5 px-3"
              [ngModel]="searchValue"
              (ngModelChange)="searchValueChange.emit($event)"
              [placeholder]="searchPlaceholder"
              [title]="searchPlaceholder"
              [attr.aria-label]="searchPlaceholder"
              (keydown.escape)="toggleSearch()"
            />
            <button
              type="button"
              class="pr-3 h-10 w-10 text-slate-400 hover:text-chrome touch-target flex items-center justify-center"
              (click)="toggleSearch()"
              aria-label="Close search"
            >
              <span class="material-symbols-outlined" style="font-size:18px">close</span>
            </button>
          </div>
        </label>
      }
    </header>
  `,
})
export class AppHeaderComponent {
  protected readonly themeService = inject(ThemeService);
  @Input() section: 'dashboard' | 'vault' | 'collections' | 'discover' = 'dashboard';
  @Input() showSearch = false;
  @Input() searchValue = '';
  @Input() searchPlaceholder = 'Search by brand, color, tag…';

  @Input() showBackShortcut = false;
  @Input() backShortcutLabel = 'Back to Wardrobe';

  @Input() showUpload = false;
  @Input() showDigest = false;
  @Input() showStylistShortcut = false;
  @Input() showFilterShortcut = false;

  @Output() searchValueChange = new EventEmitter<string>();
  @Output() uploadRequested = new EventEmitter<void>();
  /** Backward-compatible event alias for older lowercase templates. */
  @Output() readonly uploadrequest = this.uploadRequested;
  @Output() digestRequested = new EventEmitter<void>();
  @Output() notificationsRequested = new EventEmitter<void>();
  @Output() settingsRequested = new EventEmitter<void>();
  @Output() stylistRequested = new EventEmitter<void>();
  @Output() filtersRequested = new EventEmitter<void>();

  protected readonly searchOpen = signal(false);

  /**
   * Shared helper to keep the active route's nav icon visually highlighted.
   */
  protected navButtonClass(section: 'vault' | 'collections' | 'discover'): string {
    const isActive = this.section === section;
    return isActive
      ? 'bg-primary/10 text-primary border-primary/40'
      : 'border-border-chrome bg-card-dark text-slate-text hover:text-chrome hover:bg-bg-soft border';
  }

  protected toggleSearch(): void {
    this.searchOpen.update((open) => !open);
  }

  protected toggleTheme(): void {
    this.themeService.toggleTheme();
  }

  protected themeToggleLabel(): string {
    return this.themeService.theme() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  }
}
