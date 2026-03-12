import { Component } from '@angular/core';
import { OfflineBannerComponent } from './shared/offline-banner.component';
import { MobileShellComponent } from './shared/layout/mobile-shell.component';

@Component({
  selector: 'app-root',
  imports: [OfflineBannerComponent, MobileShellComponent],
  templateUrl: './app.html'
})
export class App {}
