import { Injectable, signal } from '@angular/core';
import { environment } from '../../../environments/environment';

export interface AuthUser {
  name: string;
  email: string;
  userId: string;
}

// Minimal shape of the GIS credential response
interface GisCredentialResponse {
  credential: string;
}

// Fields we need from the Google ID token payload
interface GoogleIdTokenPayload {
  sub: string;
  email: string;
  name?: string;
  exp: number;
}

function parseJwtPayload(token: string): GoogleIdTokenPayload {
  const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  const json = decodeURIComponent(
    atob(base64)
      .split('')
      .map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
      .join('')
  );
  return JSON.parse(json) as GoogleIdTokenPayload;
}

const STORAGE_KEY = 'pluckit_auth';

interface StoredAuth {
  idToken: string;
  exp: number;
  user: AuthUser;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private _user = signal<AuthUser | null>(null);
  private _idToken = signal<string | null>(null);
  private _tokenExp = signal<number>(0);

  readonly user = this._user.asReadonly();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private get gis(): any { return (window as any)['google']?.accounts?.id; }

  async initialize(): Promise<void> {
    if (!environment.production) {
      this._user.set({ name: 'Local Dev', email: 'dev@local.test', userId: 'local-dev-user' });
      return;
    }

    // Restore persisted session first so the guard doesn't redirect on refresh.
    if (this.restoreFromStorage()) {
      // Still initialize GIS in the background so ensureFreshToken() can work.
      this.waitForGIS().then(() => {
        this.gis?.initialize({
          client_id: environment.googleClientId,
          callback: (response: GisCredentialResponse) => this.handleCredentialResponse(response),
          auto_select: true,
          cancel_on_tap_outside: false,
        });
      });
      return;
    }

    await this.waitForGIS();

    // Give GIS up to 2 s to silently re-authenticate a returning user before
    // Angular finishes bootstrapping.  If no active Google session exists, we
    // resolve immediately and the guard redirects the user to /login.
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => { if (!settled) { settled = true; resolve(); } };

      this.gis.initialize({
        client_id: environment.googleClientId,
        callback: (response: GisCredentialResponse) => {
          this.handleCredentialResponse(response);
          done();
        },
        auto_select: true,
        cancel_on_tap_outside: false,
      });

      // prompt() drives the silent re-auth / One Tap flow.
      // The moment notification tells us when GIS gives up.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.gis.prompt((notification: any) => {
        if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
          done();
        }
      });

      setTimeout(done, 2000); // safety: never block startup indefinitely
    });
  }

  /**
   * Attempts to restore auth state from localStorage.
   * Returns true if a valid, non-expired token was found.
   */
  private restoreFromStorage(): boolean {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const stored: StoredAuth = JSON.parse(raw);
      const now = Math.floor(Date.now() / 1000);
      if (stored.exp - now < 60) {
        localStorage.removeItem(STORAGE_KEY);
        return false;
      }
      this._idToken.set(stored.idToken);
      this._tokenExp.set(stored.exp);
      this._user.set(stored.user);
      return true;
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      return false;
    }
  }

  private handleCredentialResponse(response: GisCredentialResponse): void {
    const payload = parseJwtPayload(response.credential);
    const user: AuthUser = {
      name: payload.name ?? payload.email,
      email: payload.email,
      userId: payload.sub,
    };
    this._idToken.set(response.credential);
    this._tokenExp.set(payload.exp);
    this._user.set(user);
    // Persist so the session survives a page refresh.
    const stored: StoredAuth = { idToken: response.credential, exp: payload.exp, user };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  }

  /** Returns the raw Google ID token to be sent as a Bearer token. */
  getIdToken(): string | null {
    return this._idToken();
  }

  /**
   * Triggers a silent GIS re-auth if the stored token expires within 60 s.
   * GIS fires the credential callback if the browser session is still live,
   * updating the stored token transparently.
   */
  ensureFreshToken(): void {
    const now = Math.floor(Date.now() / 1000);
    if (this.isAuthenticated() && this._tokenExp() - now < 60) {
      this.gis?.prompt();
    }
  }

  /** Renders the official "Sign in with Google" button into the given element. */
  renderButton(element: HTMLElement): void {
    this.gis?.renderButton(element, {
      theme: 'outline',
      size: 'large',
      width: element.offsetWidth || 300,
    });
  }

  isAuthenticated(): boolean {
    return this._user() !== null;
  }

  login(): void {
    this.gis?.prompt();
  }

  logout(): void {
    this.gis?.disableAutoSelect();
    this._user.set(null);
    this._idToken.set(null);
    this._tokenExp.set(0);
    localStorage.removeItem(STORAGE_KEY);
  }

  private waitForGIS(): Promise<void> {
    return new Promise<void>((resolve) => {
      const poll = () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((window as any)['google']?.accounts?.id) {
          resolve();
        } else {
          setTimeout(poll, 50);
        }
      };
      poll();
    });
  }
}
