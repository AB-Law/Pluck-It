import { Injectable, signal } from '@angular/core';

export type MobileShellPanel = 'none' | 'profile' | 'digest';

/**
 * Shared state for shell-level mobile overlays (profile/digest modals).
 *
 * The state is intentionally small and intentionally isolated from feature routes
 * so the shell can open overlays from navigation actions without duplicating logic.
 */
@Injectable({ providedIn: 'root' })
export class MobileNavState {
  private readonly _activePanel = signal<MobileShellPanel>('none');

  /**
   * Current shell overlay selection.
   */
  readonly activePanel = this._activePanel.asReadonly();

  /**
   * Open the profile/settings overlay.
   */
  openProfile(): void {
    this._activePanel.set('profile');
  }

  /**
   * Open the weekly digest overlay.
   */
  openDigest(): void {
    this._activePanel.set('digest');
  }

  /**
   * Close any shell overlay.
   */
  closePanel(): void {
    this._activePanel.set('none');
  }
}
