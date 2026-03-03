import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface UserProfile {
  id?: string;
  heightCm?: number | null;
  weightKg?: number | null;
  chestCm?: number | null;
  waistCm?: number | null;
  hipsCm?: number | null;
  inseamCm?: number | null;
  currencyCode: string;
  preferredSizeSystem: string;
  // Style identity — used by the AI stylist agent
  stylePreferences: string[];
  favoriteBrands: string[];
  preferredColours: string[];
  locationCity?: string | null;
  // Personalization graph fields (AI-inferred, never user-declared except recommendationOptIn)
  recommendationOptIn?: boolean;
  styleConfidenceProfile?: number | null;  // 0–1, AI-inferred
  climateZone?: string | null;             // e.g. "temperate", "tropical"
}

const DEFAULT_PROFILE: UserProfile = {
  currencyCode: 'USD',
  preferredSizeSystem: 'US',
  stylePreferences: [],
  favoriteBrands: [],
  preferredColours: [],
};

@Injectable({ providedIn: 'root' })
export class UserProfileService {
  private base = environment.apiUrl;

  /** Reactive profile signal — null until loaded. */
  readonly profile = signal<UserProfile | null>(null);

  constructor(private http: HttpClient) {}

  load(): Observable<UserProfile> {
    return this.http.get<UserProfile>(`${this.base}/api/profile`).pipe(
      tap(p => this.profile.set(p))
    );
  }

  update(profile: UserProfile): Observable<void> {
    return this.http.put<void>(`${this.base}/api/profile`, profile).pipe(
      tap(() => this.profile.set(profile))
    );
  }

  /** Returns the current profile or sensible defaults if not yet loaded. */
  getOrDefault(): UserProfile {
    return this.profile() ?? DEFAULT_PROFILE;
  }
}
