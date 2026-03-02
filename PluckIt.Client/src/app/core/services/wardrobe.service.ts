import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ClothingItem } from '../models/clothing-item.model';

@Injectable({ providedIn: 'root' })
export class WardrobeService {
  private base = environment.apiUrl;

  constructor(private http: HttpClient) {}

  getAll(params?: { category?: string; page?: number; pageSize?: number }): Observable<ClothingItem[]> {
    let qp = new HttpParams()
      .set('page', String(params?.page ?? 0))
      .set('pageSize', String(params?.pageSize ?? 24));
    if (params?.category) qp = qp.set('category', params.category);
    return this.http.get<ClothingItem[]>(`${this.base}/api/wardrobe`, { params: qp });
  }

  getById(id: string): Observable<ClothingItem> {
    return this.http.get<ClothingItem>(`${this.base}/api/wardrobe/${id}`);
  }

  /** Upload an image → background removal + AI extraction → returns a draft (not saved yet) */
  uploadForDraft(file: File): Observable<ClothingItem> {
    const form = new FormData();
    form.append('image', file, file.name);
    return this.http.post<ClothingItem>(`${this.base}/api/wardrobe/upload`, form);
  }

  /** Save a user-confirmed item to Cosmos */
  save(item: ClothingItem): Observable<ClothingItem> {
    return this.http.post<ClothingItem>(`${this.base}/api/wardrobe`, item);
  }

  /** Update an existing item */
  update(item: ClothingItem): Observable<void> {
    return this.http.put<void>(`${this.base}/api/wardrobe/${item.id}`, item);
  }

  /** Hard-delete an item from Cosmos (blob handled server-side) */
  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/api/wardrobe/${id}`);
  }

  /** Increment WearCount by 1 and return the updated item */
  logWear(id: string): Observable<ClothingItem> {
    return this.http.patch<ClothingItem>(`${this.base}/api/wardrobe/${id}/wear`, null);
  }
}
