import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptorsFromDi, HTTP_INTERCEPTORS } from '@angular/common/http';

import { routes } from './app.routes';
import { AuthService } from './core/services/auth.service';
import { AuthInterceptor } from './core/interceptors/auth.interceptor';
import { OfflineQueueService } from './core/services/offline-queue.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withInterceptorsFromDi()),
    {
      provide: HTTP_INTERCEPTORS,
      useClass: AuthInterceptor,
      multi: true,
    },
    provideAppInitializer(() => inject(AuthService).initialize()),
    provideAppInitializer(() => inject(OfflineQueueService).initialize()),
  ]
};
