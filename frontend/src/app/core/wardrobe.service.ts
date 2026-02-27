import { Injectable, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ClothingItem {
  id: string;
  imageUrl: string;
  tags: string[];
  brand?: string | null;
  category?: string | null;
  dateAdded: string;
}

export interface StylistRequest {
  stylePrompt?: string | null;
  occasion?: string | null;
  preferredColors?: string[];
  excludedColors?: string[];
}

export interface OutfitRecommendation {
  id: string;
  title: string;
  description: string;
  clothingItemIds: string[];
}

@Injectable({
  providedIn: 'root',
})
export class WardrobeService {
  private readonly apiBase = '/api';

  wardrobe = signal<ClothingItem[]>([]);

  constructor(private readonly http: HttpClient) {}

  loadWardrobe(category?: string, tags?: string[]): void {
    let params = new HttpParams().set('page', 0).set('pageSize', 100);
    if (category) {
      params = params.set('category', category);
    }
    if (tags && tags.length) {
      for (const tag of tags) {
        params = params.append('tags', tag);
      }
    }

    this.http
      .get<ClothingItem[]>(`${this.apiBase}/wardrobe`, { params })
      .subscribe((items) => this.wardrobe.set(items));
  }

  getRecommendations(request: StylistRequest): Observable<OutfitRecommendation[]> {
    return this.http.post<OutfitRecommendation[]>(`${this.apiBase}/stylist/recommendations`, request);
  }
}

