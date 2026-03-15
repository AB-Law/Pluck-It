import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import {
  ClothingItem,
  WardrobeQuery,
  WardrobePagedResponse,
  WardrobeDraftsResponse,
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
  private readonly http = inject(HttpClient);

  private readonly base = environment.apiUrl;
  private static readonly CACHE_TTL_MS = 30_000;
  private _cache: { key: string; result: WardrobePagedResponse; timestamp: number } | null = null;

  /**
   * Fetch a page of wardrobe items using full multidimensional filter + sort support.
   * Returns a paged envelope `{ items, nextContinuationToken }` instead of a bare array.
   */
  private getCached(cacheKey: string): WardrobePagedResponse | null {
    if (!this._cache) return null;
    const age = Date.now() - this._cache.timestamp;
    if (age >= WardrobeService.CACHE_TTL_MS || this._cache.key !== cacheKey) return null;
    return this._cache.result;
  }

  private buildParams(query?: WardrobeQuery): HttpParams {
    let qp = new HttpParams().set('pageSize', String(query?.pageSize ?? 24));
    if (query?.category) qp = qp.set('category', query.category);
    if (query?.brand) qp = qp.set('brand', query.brand);
    if (query?.condition) qp = qp.set('condition', query.condition);
    if (query?.tags?.length) qp = qp.set('tags', query.tags.join(','));
    if (query?.aestheticTags?.length) qp = qp.set('aestheticTags', query.aestheticTags.join(','));
    if (query?.priceMin != null) qp = qp.set('priceMin', String(query.priceMin));
    if (query?.priceMax != null) qp = qp.set('priceMax', String(query.priceMax));
    if (query?.includeWishlisted != null)
      qp = qp.set('includeWishlisted', String(query.includeWishlisted));
    if (query?.minWears != null) qp = qp.set('minWears', String(query.minWears));
    if (query?.maxWears != null) qp = qp.set('maxWears', String(query.maxWears));
    if (query?.sortField) qp = qp.set('sortField', query.sortField);
    if (query?.sortDir) qp = qp.set('sortDir', query.sortDir);
    if (query?.continuationToken) qp = qp.set('continuationToken', query.continuationToken);
    return qp;
  }

  getAll(query?: WardrobeQuery): Observable<WardrobePagedResponse> {
    const cacheKey = query?.continuationToken ? null : JSON.stringify(query ?? {});

    if (cacheKey) {
      const cached = this.getCached(cacheKey);
      if (cached) return of(cached);
    }

    const req$ = this.http.get<WardrobePagedResponse>(`${this.base}/api/wardrobe`, {
      params: this.buildParams(query),
    });

    if (!cacheKey) return req$;

    return req$.pipe(
      tap((res) => {
        this._cache = { key: cacheKey, result: res, timestamp: Date.now() };
      }),
    );
  }

  private invalidateCache(): void {
    this._cache = null;
  }

  getById(id: string): Observable<ClothingItem> {
    return this.http.get<ClothingItem>(`${this.base}/api/wardrobe/${id}`);
  }

  /**
   * Upload an image — background removal + AI extraction via the processing pipeline.
   * The server atomically writes a Processing draft in Cosmos before processing begins,
   * then updates to Ready (201) or Failed (422) on completion.
   */
  uploadForDraft(file: File): Observable<ClothingItem> {
    const form = new FormData();
    form.append('image', file, file.name);
    return this.http.post<ClothingItem>(`${this.base}/api/wardrobe/upload`, form);
  }

  /** Upload an image as a wishlist item (skips BiRefNet, tagged by AI, not added to vault). */
  uploadForDraftWishlisted(file: File): Observable<ClothingItem> {
    const form = new FormData();
    form.append('image', file, file.name);
    form.append('is_wishlisted', 'true');
    return this.http.post<ClothingItem>(`${this.base}/api/wardrobe/upload`, form);
  }

  /** Fetch all pending/ready/failed draft items (persisted across sessions). */
  getDrafts(): Observable<WardrobeDraftsResponse> {
    return this.http.get<WardrobeDraftsResponse>(`${this.base}/api/wardrobe/drafts`);
  }

  /**
   * Accept a Ready draft: removes draft metadata, sets dateAdded, returns finalized item.
   * Returns 409 if the draft is not in Ready state.
   */
  acceptDraft(id: string): Observable<ClothingItem> {
    return this.http
      .patch<ClothingItem>(`${this.base}/api/wardrobe/drafts/${id}/accept`, {})
      .pipe(tap(() => this.invalidateCache()));
  }

  /**
   * Retry processing for a Failed draft using the stored raw image blob.
   * Returns 409 if the draft is not in Failed state.
   */
  retryDraft(id: string): Observable<ClothingItem> {
    return this.http.post<ClothingItem>(`${this.base}/api/wardrobe/drafts/${id}/retry`, {});
  }

  /**
   * Dismiss (hard-delete) a draft — removes from Cosmos and deletes associated blobs.
   * Uses the same DELETE endpoint as regular items.
   */
  dismissDraft(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/api/wardrobe/${id}`);
  }

  /** Save a user-confirmed item to Cosmos */
  save(item: ClothingItem): Observable<ClothingItem> {
    return this.http
      .post<ClothingItem>(`${this.base}/api/wardrobe`, item)
      .pipe(tap(() => this.invalidateCache()));
  }

  /** Update an existing item */
  update(item: ClothingItem): Observable<void> {
    return this.http
      .put<void>(`${this.base}/api/wardrobe/${item.id}`, item)
      .pipe(tap(() => this.invalidateCache()));
  }

  /** Hard-delete an item from Cosmos (blob handled server-side) */
  delete(id: string): Observable<void> {
    return this.http
      .delete<void>(`${this.base}/api/wardrobe/${id}`)
      .pipe(tap(() => this.invalidateCache()));
  }

  /** Increment WearCount by 1 and return the updated item */
  logWear(id: string, payload?: WearLogPayload): Observable<ClothingItem> {
    return this.http
      .patch<ClothingItem>(`${this.base}/api/wardrobe/${id}/wear`, payload ?? null)
      .pipe(tap(() => this.invalidateCache()));
  }

  getWearHistory(id: string, from?: string, to?: string): Observable<WearHistoryResponse> {
    let qp = new HttpParams();
    if (from) qp = qp.set('from', from);
    if (to) qp = qp.set('to', to);
    return this.http.get<WearHistoryResponse>(`${this.base}/api/wardrobe/${id}/wear-history`, {
      params: qp,
    });
  }

  recordStylingActivity(payload: StylingActivityRequest): Observable<StylingActivityResponse> {
    return this.http.post<StylingActivityResponse>(
      `${this.base}/api/wardrobe/styling-activity`,
      payload,
    );
  }

  getWearSuggestions(): Observable<WearSuggestionsResponse> {
    return this.http.get<WearSuggestionsResponse>(`${this.base}/api/wardrobe/suggestions/wear`);
  }

  updateWearSuggestionStatus(
    suggestionId: string,
    payload: UpdateWearSuggestionStatusRequest,
  ): Observable<UpdateWearSuggestionStatusResponse> {
    return this.http.patch<UpdateWearSuggestionStatusResponse>(
      `${this.base}/api/wardrobe/suggestions/wear/${suggestionId}`,
      payload,
    );
  }
}
