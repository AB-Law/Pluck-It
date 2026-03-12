import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { MobileNavState } from './mobile-nav.state';

@Component({
  selector: 'app-mobile-bottom-nav',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <nav
      class="fixed inset-x-0 bottom-0 z-40 border-t border-border-subtle bg-black/95 backdrop-blur-xl md:hidden safe-area-shell"
      aria-label="Primary mobile navigation"
    >
      <ul class="grid grid-cols-6">
        <li>
          <a
            routerLink="/"
            routerLinkActive="text-primary"
            [routerLinkActiveOptions]="{ exact: true }"
            class="touch-target mx-auto flex h-14 min-h-0 w-full flex-col items-center justify-center gap-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-300 leading-none text-center transition-colors"
          >
            <span class="material-symbols-outlined inline-flex h-5 w-5 items-center justify-center" style="font-size:20px">checkroom</span>
            Wardrobe
          </a>
        </li>

        <li>
          <a
            routerLink="/vault"
            routerLinkActive="text-primary"
            class="touch-target mx-auto flex h-14 min-h-0 w-full flex-col items-center justify-center gap-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-300 leading-none text-center transition-colors"
          >
            <span class="material-symbols-outlined inline-flex h-5 w-5 items-center justify-center" style="font-size:20px">inventory_2</span>
            Vault
          </a>
        </li>

        <li>
          <a
            routerLink="/collections"
            routerLinkActive="text-primary"
            class="touch-target mx-auto flex h-14 min-h-0 w-full flex-col items-center justify-center gap-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-300 leading-none text-center transition-colors"
          >
            <span class="material-symbols-outlined inline-flex h-5 w-5 items-center justify-center" style="font-size:20px">folder_special</span>
            Collections
          </a>
        </li>

        <li>
          <a
            routerLink="/discover"
            routerLinkActive="text-primary"
            class="touch-target mx-auto flex h-14 min-h-0 w-full flex-col items-center justify-center gap-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-300 leading-none text-center transition-colors"
          >
            <span class="material-symbols-outlined inline-flex h-5 w-5 items-center justify-center" style="font-size:20px">explore</span>
            Discover
          </a>
        </li>

        <li>
          <button
            type="button"
            class="touch-target mx-auto flex h-14 min-h-0 w-full flex-col items-center justify-center gap-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-300 leading-none text-center transition-colors"
            (click)="goToStylist()"
            aria-label="Open Stylist"
          >
            <span class="material-symbols-outlined inline-flex h-5 w-5 items-center justify-center" style="font-size:20px">smart_toy</span>
            Stylist
          </button>
        </li>

        <li>
          <button
            type="button"
            class="touch-target mx-auto flex h-14 min-h-0 w-full flex-col items-center justify-center gap-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-300 leading-none text-center transition-colors"
            (click)="openProfile()"
            aria-label="Open profile and settings"
          >
            <span class="material-symbols-outlined inline-flex h-5 w-5 items-center justify-center" style="font-size:20px">person</span>
            Profile
          </button>
        </li>
      </ul>
    </nav>
  `,
})
export class MobileBottomNavComponent {
  private readonly navState = inject(MobileNavState);
  private readonly router = inject(Router);

  protected goToStylist(): void {
    this.navState.closePanel();
    this.router.navigate(['/'], {
      queryParams: { mobilePanel: 'stylist' },
      queryParamsHandling: 'merge',
    });
  }

  protected openProfile(): void {
    this.navState.openProfile();
  }
}
