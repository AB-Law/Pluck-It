import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  ClothingItem,
  WardrobeQuery,
  WardrobePagedResponse,
  WearLogPayload,
  WearHistoryResponse,
  StylingActivityRequest,
  StylingActivityResponse,
  WearSuggestionsResponse,
  UpdateWearSuggestionStatusRequest,
  UpdateWearSuggestionStatusResponse,
} from '../models/clothing-item.model';

@Injectable({ providedIn: 'root' })
export class WardrobeService {
  private base = environment.apiUrl;

  constructor(private http: HttpClient) {}

  /**
   * Fetch a page of wardrobe items using full multidimensional filter + sort support.
   * Returns a paged envelope `{ items, nextContinuationToken }` instead of a bare array.
   */
  getAll(query?: WardrobeQuery): Observable<WardrobePagedResponse> {
    let qp = new HttpParams()
      .set('pageSize', String(query?.pageSize ?? 24));

    if (query?.category)            qp = qp.set('category',          query.category);
    if (query?.brand)               qp = qp.set('brand',             query.brand);
    if (query?.condition)           qp = qp.set('condition',         query.condition);
    if (query?.tags?.length)        qp = qp.set('tags',              query.tags.join(','));
    if (query?.aestheticTags?.length)
                                    qp = qp.set('aestheticTags',     query.aestheticTags!.join(','));
    if (query?.priceMin  != null)   qp = qp.set('priceMin',          String(query.priceMin));
    if (query?.priceMax  != null)   qp = qp.set('priceMax',          String(query.priceMax));
    if (query?.minWears  != null)   qp = qp.set('minWears',          String(query.minWears));
    if (query?.maxWears  != null)   qp = qp.set('maxWears',          String(query.maxWears));
    if (query?.sortField)           qp = qp.set('sortField',         query.sortField);
    if (query?.sortDir)             qp = qp.set('sortDir',           query.sortDir);
    if (query?.continuationToken)   qp = qp.set('continuationToken', query.continuationToken);

    return this.http.get<WardrobePagedResponse>(`${this.base}/api/wardrobe`, { params: qp });
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
  logWear(id: string, payload?: WearLogPayload): Observable<ClothingItem> {
    return this.http.patch<ClothingItem>(`${this.base}/api/wardrobe/${id}/wear`, payload ?? null);
  }

  getWearHistory(id: string, from?: string, to?: string): Observable<WearHistoryResponse> {
    let qp = new HttpParams();
    if (from) qp = qp.set('from', from);
    if (to) qp = qp.set('to', to);
    return this.http.get<WearHistoryResponse>(`${this.base}/api/wardrobe/${id}/wear-history`, { params: qp });
  }

  recordStylingActivity(payload: StylingActivityRequest): Observable<StylingActivityResponse> {
    return this.http.post<StylingActivityResponse>(`${this.base}/api/wardrobe/styling-activity`, payload);
  }

  getWearSuggestions(): Observable<WearSuggestionsResponse> {
    return this.http.get<WearSuggestionsResponse>(`${this.base}/api/wardrobe/wear-suggestions`);
  }

  updateWearSuggestionStatus(
    suggestionId: string,
    payload: UpdateWearSuggestionStatusRequest,
  ): Observable<UpdateWearSuggestionStatusResponse> {
    return this.http.patch<UpdateWearSuggestionStatusResponse>(
      `${this.base}/api/wardrobe/wear-suggestions/${suggestionId}`,
      payload,
    );
  }
}
