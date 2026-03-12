import { Component, DestroyRef, OnInit, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRouteSnapshot, NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs/operators';
import { ProfilePanelComponent } from '../../features/profile/profile-panel.component';
import { DigestPanelComponent } from '../../features/digest/digest-panel.component';
import { MobileBottomNavComponent } from './mobile-bottom-nav.component';
import { MobileNavState } from './mobile-nav.state';

interface MobileBodyLockSnapshot {
  bodyOverflow: string;
  bodyPosition: string;
  bodyTop: string;
  bodyLeft: string;
  bodyWidth: string;
  bodyTouchAction: string;
  rootOverflow: string;
  rootTouchAction: string;
  scrollY: number;
}

@Component({
  selector: 'app-mobile-shell',
  standalone: true,
  imports: [RouterOutlet, MobileBottomNavComponent, ProfilePanelComponent, DigestPanelComponent],
  template: `
    <div class="relative h-[100dvh] min-h-[100dvh] bg-black text-slate-100 ios-safe-top ios-safe-bottom">
      <div class="pb-0 md:pb-0">
        <router-outlet />
      </div>

      @if (showShell()) {
        <app-mobile-bottom-nav />
      }

      @if (mobileState.activePanel() === 'profile') {
        <app-profile-panel (closed)="mobileState.closePanel()" />
      }
      @if (mobileState.activePanel() === 'digest') {
        <app-digest-panel (closed)="mobileState.closePanel()" />
      }
    </div>
  `,
})
export class MobileShellComponent implements OnInit {
  protected readonly mobileState = inject(MobileNavState);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private bodyLockSnapshot: MobileBodyLockSnapshot | null = null;

  protected readonly showShell = signal(true);

  ngOnInit(): void {
    this.updateShellVisibility();

    this.router.events
      .pipe(
        filter(event => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.updateShellVisibility());
  }

  protected readonly hasMobileOverlay = computed(() =>
    this.mobileState.activePanel() !== 'none' && this.showShell(),
  );

  private setBodyScrollLock(locked: boolean): void {
    if (typeof document === 'undefined') {
      return;
    }

    const doc = document;
    const body = doc.body;
    const root = doc.documentElement;
    const isWindow = globalThis.window !== undefined;

    if (locked) {
      if (this.bodyLockSnapshot) {
        return;
      }

      const scrollY = isWindow ? globalThis.window.scrollY : 0;
      this.bodyLockSnapshot = {
        bodyOverflow: body.style.overflow,
        bodyPosition: body.style.position,
        bodyTop: body.style.top,
        bodyLeft: body.style.left,
        bodyWidth: body.style.width,
        bodyTouchAction: body.style.touchAction,
        rootOverflow: root.style.overflow,
        rootTouchAction: root.style.touchAction,
        scrollY,
      };

      body.style.overflow = 'hidden';
      root.style.overflow = 'hidden';
      body.style.position = 'fixed';
      body.style.top = `-${scrollY}px`;
      body.style.left = '0';
      body.style.width = '100%';
      body.style.touchAction = 'none';
      root.style.touchAction = 'none';
      return;
    }

    if (!this.bodyLockSnapshot) {
      body.style.overflow = '';
      root.style.overflow = '';
      body.style.position = '';
      body.style.top = '';
      body.style.left = '';
      body.style.width = '';
      body.style.touchAction = '';
      root.style.touchAction = '';
      return;
    }

    const snapshot = this.bodyLockSnapshot;
    this.bodyLockSnapshot = null;

    body.style.overflow = snapshot.bodyOverflow;
    root.style.overflow = snapshot.rootOverflow;
    body.style.position = snapshot.bodyPosition;
    body.style.top = snapshot.bodyTop;
    body.style.left = snapshot.bodyLeft;
    body.style.width = snapshot.bodyWidth;
    body.style.touchAction = snapshot.bodyTouchAction;
    root.style.touchAction = snapshot.rootTouchAction;

    if (globalThis.window !== undefined) {
      globalThis.window.scrollTo(0, snapshot.scrollY);
    }
  }

  private updateShellVisibility(): void {
    const root = this.router.routerState.snapshot.root;
    const allowShell = this.shouldShowShell(root);
    this.showShell.set(allowShell);

    if (!allowShell) {
      this.mobileState.closePanel();
    }
  }

  private shouldShowShell(route: ActivatedRouteSnapshot): boolean {
    let current: ActivatedRouteSnapshot | null = route;
    while (current?.firstChild) {
      current = current.firstChild;
    }
    return current?.data?.['mobileShell'] !== false;
  }

  constructor() {
    effect(() => {
      this.setBodyScrollLock(this.hasMobileOverlay());
    });

    this.destroyRef.onDestroy(() => {
      this.mobileState.closePanel();
      this.setBodyScrollLock(false);
    });
  }
}
