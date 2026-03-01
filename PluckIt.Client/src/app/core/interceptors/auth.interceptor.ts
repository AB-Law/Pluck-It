import { Injectable, inject } from '@angular/core';
import {
  HttpInterceptor,
  HttpRequest,
  HttpHandler,
  HttpEvent,
} from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../services/auth.service';

/**
 * Attaches an `Authorization: Bearer <Google ID token>` header to every
 * request targeting the API.  Triggers a silent GIS re-auth before the token
 * expires so the header is always fresh.
 */
@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  private readonly auth = inject(AuthService);

  intercept(req: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    if (!environment.production) {
      return next.handle(req);
    }

    if (req.url.startsWith(environment.apiUrl)) {
      this.auth.ensureFreshToken();
      const token = this.auth.getIdToken();
      if (token) {
        req = req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
      }
    }

    return next.handle(req);
  }
}
