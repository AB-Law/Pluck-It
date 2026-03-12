import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

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
    <header class="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle bg-black px-4 py-3 md:px-6 md:py-4 shrink-0 z-50">
      <div class="flex items-center gap-3 min-w-0">
        <a
          routerLink="/"
          class="flex items-center gap-3 text-white"
          title="Open your dashboard"
          aria-label="Open your dashboard"
        >
          <span
            class="material-symbols-outlined text-primary"
            style="font-size:30px"
          >
            checkroom
          </span>
          <h2 class="text-white text-base md:text-xl font-bold tracking-tight">Pluck-It</h2>
        </a>

        <label class="hidden md:flex flex-col min-w-[260px] lg:min-w-[320px]">
          <div class="flex w-full items-center rounded-lg bg-card-dark border border-[#333] focus-within:border-primary/60 transition-colors">
            <div class="flex items-center justify-center pl-3 text-slate-text">
              <span class="material-symbols-outlined" style="font-size:20px">search</span>
            </div>
            <input
              class="w-full bg-transparent border-none text-sm text-white placeholder-slate-text outline-none py-2.5 px-3 font-mono"
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
            class="md:hidden h-10 w-10 flex items-center justify-center rounded-lg bg-card-dark text-slate-text hover:text-white hover:bg-[#333] touch-target"
            title="Search"
            aria-label="Open search"
            (click)="toggleSearch()"
          >
            <span class="material-symbols-outlined" style="font-size:20px">search</span>
          </button>
        }

        @if (showUpload) {
          <button
            type="button"
            class="h-10 w-10 rounded-lg bg-card-dark text-slate-text hover:text-white hover:bg-[#333] flex items-center justify-center touch-target"
            title="Upload item"
            aria-label="Upload item"
            (click)="uploadRequested.emit()"
          >
            <span class="material-symbols-outlined" style="font-size:18px">upload_file</span>
          </button>
        }

        @if (showFilterShortcut) {
          <button
            type="button"
            class="lg:hidden h-10 w-10 rounded-lg bg-card-dark text-slate-text hover:text-white hover:bg-[#333] flex items-center justify-center touch-target"
            title="Open filters"
            aria-label="Open filters"
            (click)="filtersRequested.emit()"
          >
            <span class="material-symbols-outlined" style="font-size:20px">tune</span>
          </button>
        }

        @if (showStylistShortcut) {
          <button
            type="button"
            class="h-10 w-10 rounded-lg bg-card-dark text-slate-text hover:text-white hover:bg-[#333] flex items-center justify-center touch-target"
            title="Open stylist chat"
            aria-label="Open stylist chat"
            (click)="stylistRequested.emit()"
          >
            <span class="material-symbols-outlined" style="font-size:20px">smart_toy</span>
          </button>
        }

        <a
          *ngIf="showBackShortcut"
          routerLink="/"
          class="hidden md:flex h-10 w-10 items-center justify-center rounded-lg bg-card-dark text-slate-text hover:text-white hover:bg-[#333] transition-colors touch-target"
          title="{{ backShortcutLabel }}"
          aria-label="{{ backShortcutLabel }}"
        >
          <span class="material-symbols-outlined" style="font-size:20px">home</span>
        </a>

        <a
          routerLink="/vault"
          class="hidden md:flex h-10 w-10 items-center justify-center rounded-lg text-sm border transition-colors touch-target"
          [ngClass]="navButtonClass('vault')"
          title="Digital Vault"
          aria-label="Go to your digital vault"
        >
          <span class="material-symbols-outlined" style="font-size:20px">inventory_2</span>
        </a>

        <a
          routerLink="/collections"
          class="hidden md:flex h-10 w-10 items-center justify-center rounded-lg text-sm border transition-colors touch-target"
          [ngClass]="navButtonClass('collections')"
          title="My Collections"
          aria-label="Go to your collections"
        >
          <span class="material-symbols-outlined" style="font-size:20px">folder_special</span>
        </a>

        <a
          routerLink="/discover"
          class="hidden md:flex h-10 w-10 items-center justify-center rounded-lg text-sm border transition-colors touch-target"
          [ngClass]="navButtonClass('discover')"
          title="Discover"
          aria-label="Open discover feed"
        >
          <span class="material-symbols-outlined" style="font-size:20px">explore</span>
        </a>

        @if (showDigest) {
          <button
            class="h-10 w-10 rounded-lg bg-card-dark text-slate-text hover:text-white hover:bg-[#333] flex items-center justify-center touch-target"
            title="Open weekly digest"
            aria-label="Open weekly digest"
            (click)="digestRequested.emit()"
          >
            <span class="material-symbols-outlined" style="font-size:20px">tips_and_updates</span>
          </button>
        }

        <button
          class="h-10 w-10 rounded-lg bg-card-dark text-slate-text hover:text-white hover:bg-[#333] hidden md:flex items-center justify-center touch-target"
          title="Open notifications"
          aria-label="Open notifications"
          (click)="notificationsRequested.emit()"
          type="button"
        >
          <span class="material-symbols-outlined" style="font-size:20px">notifications</span>
        </button>

        <button
          class="h-10 w-10 rounded-lg bg-card-dark text-slate-text hover:text-white hover:bg-[#333] flex items-center justify-center touch-target"
          title="Open settings"
          aria-label="Open settings"
          (click)="settingsRequested.emit()"
          type="button"
        >
          <span class="material-symbols-outlined" style="font-size:20px">settings</span>
        </button>
      </div>

      @if (searchOpen()) {
        <label class="w-full md:hidden">
          <div class="mt-2 flex w-full items-center rounded-lg bg-card-dark border border-[#333] focus-within:border-primary/60 transition-colors">
            <div class="flex items-center justify-center pl-3 text-slate-text">
              <span class="material-symbols-outlined" style="font-size:20px">search</span>
            </div>
            <input
              class="w-full bg-transparent border-none text-sm text-white placeholder-slate-text outline-none py-2.5 px-3 font-mono"
              [ngModel]="searchValue"
              (ngModelChange)="searchValueChange.emit($event)"
              [placeholder]="searchPlaceholder"
              [title]="searchPlaceholder"
              [attr.aria-label]="searchPlaceholder"
              (keydown.escape)="toggleSearch()"
            />
            <button
              type="button"
              class="pr-3 h-10 w-10 text-slate-400 hover:text-white touch-target flex items-center justify-center"
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
  @Output('uploadrequest') readonly uploadrequest = this.uploadRequested;
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
      ? 'bg-primary/10 text-primary border-primary/30'
      : 'border-[#333] bg-card-dark text-slate-text hover:text-white hover:bg-[#333] border';
  }

  protected toggleSearch(): void {
    this.searchOpen.update(open => !open);
  }
}
