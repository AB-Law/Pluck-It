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

interface EasyAuthProvider {
  provider_name: string;
  user_id: string;
  user_claims: EasyAuthClaim[];
  authentication_token?: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private _user = signal<AuthUser | null>(null);
  private _token = signal<string | null>(null);

  readonly user = this._user.asReadonly();

  constructor(private http: HttpClient) {}

  /**
   * Called by APP_INITIALIZER before the app renders.
   * In development, injects a mock user so the backend Local:DevUserId fallback is used.
   * In production, calls /.auth/me with credentials to get the EasyAuth session.
   */
  async initialize(): Promise<void> {
    if (!environment.production) {
      this._user.set({ name: 'Local Dev', email: 'dev@local.test', userId: 'local-dev-user' });
      return;
    }

    try {
      const providers = await firstValueFrom(
        this.http.get<EasyAuthProvider[]>(`${environment.apiUrl}/.auth/me`, {
          withCredentials: true,
        })
      );

      const provider = providers?.[0];
      if (provider) {
        const nameClaim = provider.user_claims.find(
          c => c.typ === 'name' || c.typ === 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'
        );
        this._user.set({
          name: nameClaim?.val ?? provider.user_id,
          email: provider.user_id,
          userId: provider.user_id,
        });
        if (provider.authentication_token) {
          this._token.set(provider.authentication_token);
        }
      }
    } catch {
      // Not authenticated — guard will redirect to login
    }
  }

  isAuthenticated(): boolean {
    return this._user() !== null;
  }

  getToken(): string | null {
    return this._token();
  }

  login(): void {
    const redirectUri = encodeURIComponent(window.location.href);
    window.location.href = `${environment.apiUrl}/.auth/login/google?post_login_redirect_uri=${redirectUri}`;
  }

  logout(): void {
    this._user.set(null);
    this._token.set(null);
    const redirectUri = encodeURIComponent(window.location.origin);
    window.location.href = `${environment.apiUrl}/.auth/logout?post_logout_redirect_uri=${redirectUri}`;
  }
}
