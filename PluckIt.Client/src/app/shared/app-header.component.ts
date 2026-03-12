import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
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
    <header class="flex items-center justify-between border-b border-border-subtle bg-black px-6 py-4 shrink-0 z-50">
      <div class="flex items-center gap-8">
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
          <h2 class="text-white text-xl font-bold tracking-tight">Pluck-It</h2>
        </a>

        <label *ngIf="showSearch" class="hidden md:flex flex-col min-w-[280px]">
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

      <div class="flex items-center gap-3">
        <a
          *ngIf="showBackShortcut"
          routerLink="/"
          class="p-2 rounded-lg bg-card-dark text-slate-text hover:text-white hover:bg-[#333] transition-colors"
          title="{{ backShortcutLabel }}"
          aria-label="{{ backShortcutLabel }}"
        >
          <span class="material-symbols-outlined" style="font-size:20px">home</span>
        </a>

        <a
          routerLink="/vault"
          class="p-2 rounded-lg text-sm border transition-colors"
          [ngClass]="navButtonClass('vault')"
          title="Digital Vault"
          aria-label="Go to your digital vault"
        >
          <span class="material-symbols-outlined" style="font-size:20px">inventory_2</span>
        </a>

        <a
          routerLink="/collections"
          class="p-2 rounded-lg text-sm border transition-colors"
          [ngClass]="navButtonClass('collections')"
          title="My Collections"
          aria-label="Go to your collections"
        >
          <span class="material-symbols-outlined" style="font-size:20px">folder_special</span>
        </a>

        <a
          routerLink="/discover"
          class="p-2 rounded-lg text-sm border transition-colors"
          [ngClass]="navButtonClass('discover')"
          title="Discover"
          aria-label="Open discover feed"
        >
          <span class="material-symbols-outlined" style="font-size:20px">explore</span>
        </a>

        @if (showUpload) {
          <button
            class="p-2 rounded-lg bg-card-dark text-slate-text hover:text-white hover:bg-[#333] transition-colors"
            title="Upload item"
            aria-label="Upload item"
            (click)="uploadRequested.emit()"
            type="button"
          >
            <span class="material-symbols-outlined" style="font-size:18px">upload_file</span>
          </button>
        }

        @if (showDigest) {
          <button
            class="p-2 rounded-lg bg-card-dark text-slate-text hover:text-white hover:bg-[#333] transition-colors"
            title="Open weekly digest"
            aria-label="Open weekly digest"
            (click)="digestRequested.emit()"
            type="button"
          >
            <span class="material-symbols-outlined" style="font-size:20px">tips_and_updates</span>
          </button>
        }

        <button
          class="p-2 rounded-lg bg-card-dark text-slate-text hover:text-white hover:bg-[#333] transition-colors"
          title="Open notifications"
          aria-label="Open notifications"
          (click)="notificationsRequested.emit()"
          type="button"
        >
          <span class="material-symbols-outlined" style="font-size:20px">notifications</span>
        </button>

        <button
          class="p-2 rounded-lg bg-card-dark text-slate-text hover:text-white hover:bg-[#333] transition-colors"
          title="Open settings"
          aria-label="Open settings"
          (click)="settingsRequested.emit()"
          type="button"
        >
          <span class="material-symbols-outlined" style="font-size:20px">settings</span>
        </button>
      </div>
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

  @Output() searchValueChange = new EventEmitter<string>();
  @Output() uploadRequested = new EventEmitter<void>();
  @Output() digestRequested = new EventEmitter<void>();
  @Output() notificationsRequested = new EventEmitter<void>();
  @Output() settingsRequested = new EventEmitter<void>();

  /**
   * Shared helper to keep the active route's nav icon visually highlighted.
   */
  protected navButtonClass(section: 'vault' | 'collections' | 'discover'): string {
    const isActive = this.section === section;
    return isActive
      ? 'bg-primary/10 text-primary border-primary/30'
      : 'border-[#333] bg-card-dark text-slate-text hover:text-white hover:bg-[#333] border';
  }
}
