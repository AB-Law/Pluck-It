import { Injectable } from '@angular/core';
import {
  HttpInterceptor,
  HttpRequest,
  HttpHandler,
  HttpEvent,
} from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/**
 * Attaches withCredentials=true to every request targeting the API so that
 * the EasyAuth session cookie (AppServiceAuthSession) is sent cross-origin.
 * This is required for the Function App to receive the auth headers injected
 * by EasyAuth (x-ms-client-principal-id etc).
 */
@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  intercept(req: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    if (!environment.production) {
      return next.handle(req);
    }

    if (req.url.startsWith(environment.apiUrl)) {
      req = req.clone({ withCredentials: true });
    }

    return next.handle(req);
  }
}
