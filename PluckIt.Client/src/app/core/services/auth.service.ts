import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface AuthUser {
  name: string;
  email: string;
  userId: string;
}

interface EasyAuthClaim {
  typ: string;
  val: string;
}

// EasyAuth v2 (auth_settings_v2) response shape from /.auth/me
interface EasyAuthV2Response {
  clientPrincipal: {
    identityProvider: string;
    userId: string;
    userDetails: string;
    userRoles: string[];
    claims?: EasyAuthClaim[];
  } | null;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private _user = signal<AuthUser | null>(null);

  readonly user = this._user.asReadonly();

  constructor(private http: HttpClient) {}

  async initialize(): Promise<void> {
    if (!environment.production) {
      this._user.set({ name: 'Local Dev', email: 'dev@local.test', userId: 'local-dev-user' });
      return;
    }

    try {
      const resp = await firstValueFrom(
        this.http.get<EasyAuthV2Response>(`${environment.apiUrl}/.auth/me`, {
          withCredentials: true,
        })
      );

      const principal = resp?.clientPrincipal;
      if (principal) {
        const nameClaim = principal.claims?.find(
          c => c.typ === 'name' || c.typ === 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'
        );
        this._user.set({
          name: nameClaim?.val ?? principal.userDetails,
          email: principal.userDetails,
          userId: principal.userId,
        });
      }
    } catch {
      // Not authenticated — guard will redirect to login
    }
  }

  isAuthenticated(): boolean {
    return this._user() !== null;
  }

  login(): void {
    const redirectUri = encodeURIComponent(window.location.href);
    window.location.href = `${environment.apiUrl}/.auth/login/google?post_login_redirect_uri=${redirectUri}`;
  }

  logout(): void {
    this._user.set(null);
    const redirectUri = encodeURIComponent(window.location.origin);
    window.location.href = `${environment.apiUrl}/.auth/logout?post_logout_redirect_uri=${redirectUri}`;
  }
}
