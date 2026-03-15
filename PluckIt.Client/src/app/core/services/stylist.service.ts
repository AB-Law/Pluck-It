import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface StylistRequest {
  stylePrompt?: string;
  occasion?: string;
  preferredColors?: string[];
  excludedColors?: string[];
}

export interface OutfitRecommendation {
  id: string;
  title: string;
  description: string;
  clothingItemIds: string[];
}

@Injectable({ providedIn: 'root' })
export class StylistService {
  private readonly http = inject(HttpClient);

  private readonly base = environment.apiUrl;

  getRecommendations(request: StylistRequest): Observable<OutfitRecommendation[]> {
    return this.http.post<OutfitRecommendation[]>(
      `${this.base}/api/stylist/recommendations`,
      request,
    );
  }
}
