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
  const base64 = token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/');
  const json = decodeURIComponent(
    atob(base64)
      .split('')
      .map(c => '%' + c.codePointAt(0)!.toString(16).padStart(2, '0'))
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

const GOOGLE_IDENTITY_SCRIPT_URL = 'https://accounts.google.com/gsi/client';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly _user = signal<AuthUser | null>(null);
  private readonly _idToken = signal<string | null>(null);
  private readonly _tokenExp = signal<number>(0);
  private _googleClientLoad?: Promise<boolean>;
  private _googleClientInitialized = false;

  readonly user = this._user.asReadonly();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private get gis(): any { return (globalThis as any)['google']?.accounts?.id; }

  async initialize(): Promise<void> {
    if (!environment.production) {
      this._user.set({ name: 'Local Dev', email: 'dev@local.test', userId: 'local-dev-user' });
      return;
    }

    // Restore persisted session first so the guard doesn't redirect on refresh.
    if (this.restoreFromStorage()) {
      // Still initialize GIS in the background so ensureFreshToken() can work.
      // This must be non-blocking; loading GIS here is only needed for users
      // who already have a saved session.
      void this.bootstrapGoogleIdentity();
      return;
    }
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
      void this.bootstrapGoogleIdentity().then(() => this.gis?.prompt());
    }
  }

  isAuthenticated(): boolean {
    return this._user() !== null;
  }

  login(): void {
    void this.bootstrapGoogleIdentity().then(() => this.gis?.prompt());
  }

  logout(): void {
    this.gis?.disableAutoSelect();
    this._user.set(null);
    this._idToken.set(null);
    this._tokenExp.set(0);
    localStorage.removeItem(STORAGE_KEY);
  }

  private async bootstrapGoogleIdentity(): Promise<boolean> {
    const ready = await this.ensureGoogleClientScript();
    if (!ready || !this.gis) {
      return false;
    }

    if (this._googleClientInitialized) {
      return true;
    }

    this._googleClientInitialized = true;
    this.gis.initialize({
      client_id: environment.googleClientId,
      callback: (response: GisCredentialResponse) => this.handleCredentialResponse(response),
      auto_select: true,
      cancel_on_tap_outside: false,
    });

    return true;
  }

  private ensureGoogleClientScript(): Promise<boolean> {
    if (typeof globalThis === 'undefined' || typeof document === 'undefined') {
      return Promise.resolve(false);
    }

    if ((globalThis as any)['google']?.accounts?.id) {
      return Promise.resolve(true);
    }

    if (!this._googleClientLoad) {
      const existingScript = document.querySelector<HTMLScriptElement>(`script[src="${GOOGLE_IDENTITY_SCRIPT_URL}"]`);
      if (!existingScript) {
        const script = document.createElement('script');
        script.src = GOOGLE_IDENTITY_SCRIPT_URL;
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }
      const waitForLoad = this.waitForGoogleIdentityScript(2500);
      this._googleClientLoad = waitForLoad.then((ready) => {
        if (!ready) {
          this._googleClientLoad = undefined;
        }
        return ready;
      });
    }
    return this._googleClientLoad;
  }

  private waitForGoogleIdentityScript(timeoutMs = 3000, intervalMs = 50): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    return new Promise<boolean>((resolve) => {
      const poll = () => {
        if ((globalThis as any)['google']?.accounts?.id) {
          resolve(true);
          return;
        }
        if (Date.now() >= deadline) {
          resolve(false);
          return;
        }
        setTimeout(poll, intervalMs);
      };
      poll();
    });
  }

}
