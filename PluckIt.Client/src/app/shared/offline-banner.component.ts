import { Component, inject } from '@angular/core';
import { NetworkService } from '../core/services/network.service';

@Component({
  selector: 'app-offline-banner',
  standalone: true,
  template: `
    @if (networkService.isOnline() === false) {
      <div
        class="sticky top-0 z-50 bg-amber-500/20 border-b border-amber-500/70 ios-safe-top ios-safe-bottom text-[11px] uppercase tracking-wide text-amber-100 px-3 py-2 font-mono text-center"
        data-test="offline-banner"
      >
        <p class="leading-tight">
          You are offline. Some actions are limited. Showing cached/last sync content.
        </p>
      </div>
    }
  `,
})
export class OfflineBannerComponent {
  protected networkService = inject(NetworkService);
}
