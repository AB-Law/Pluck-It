import { Injectable, signal } from '@angular/core';

/**
 * Tracks network reachability for offline-aware UI behavior.
 */
@Injectable({
  providedIn: 'root',
})
export class NetworkService {
  /** Reactive online/offline state derived from browser connectivity events. */
  readonly isOnline = signal(true);

  constructor() {
    const initialOnline = globalThis.window?.navigator?.onLine ?? true;
    this.isOnline.set(initialOnline);

    if (globalThis.window !== undefined) {
      globalThis.window.addEventListener('online', () => {
        this.isOnline.set(true);
      });
      globalThis.window.addEventListener('offline', () => {
        this.isOnline.set(false);
      });
    }
  }

  /**
   * Returns current network state as a plain boolean.
   */
  isCurrentlyOnline(): boolean {
    return this.isOnline();
  }
}
