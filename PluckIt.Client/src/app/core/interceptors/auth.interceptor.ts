import { Injectable } from '@angular/core';
import {
  HttpInterceptor,
  HttpRequest,
  HttpHandler,
  HttpEvent,
} from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { environment } from '../../../environments/environment';

/**
 * Attaches the EasyAuth session token as X-ZUMO-AUTH on every request
 * directed at the API. Only active in production — in development the
 * backend falls back to Local:DevUserId without requiring a token.
 */
@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  constructor(private auth: AuthService) {}

  intercept(req: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    if (!environment.production) {
      return next.handle(req);
    }

    const token = this.auth.getToken();
    if (token && req.url.startsWith(environment.apiUrl)) {
      req = req.clone({
        setHeaders: { 'X-ZUMO-AUTH': token },
        withCredentials: true,
      });
    }

    return next.handle(req);
  }
}
