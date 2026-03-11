import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import {
  DiscoverFeedResponse,
  DiscoverFeedQuery,
  ScraperSource,
} from '../models/scraped-item.model';

@Injectable({ providedIn: 'root' })
export class DiscoverService {
  private readonly base = `${environment.chatApiUrl}/api`;

  constructor(private readonly http: HttpClient) { }

  getFeed(query: DiscoverFeedQuery = {}): Observable<DiscoverFeedResponse> {
    let params = new HttpParams();
    if (query.sortBy) params = params.set('sortBy', query.sortBy);
    if (query.pageSize) params = params.set('pageSize', query.pageSize.toString());
    if (query.continuationToken) params = params.set('continuationToken', query.continuationToken);
    if (query.tags?.length) params = params.set('tags', query.tags.join(','));
    if (query.sourceIds?.length) params = params.set('sourceIds', query.sourceIds.join(','));
    if (query.timeRange) params = params.set('timeRange', query.timeRange);
    return this.http.get<DiscoverFeedResponse>(`${this.base}/scraper/items`, { params });
  }

  getSources(): Observable<ScraperSource[]> {
    return this.http
      .get<{ sources: ScraperSource[] }>(`${this.base}/scraper/sources`)
      .pipe(map(r => r.sources ?? []));
  }

  suggestSource(name: string, url: string, sourceType: string): Observable<ScraperSource> {
    return this.http.post<ScraperSource>(`${this.base}/scraper/sources`, { name, url, sourceType });
  }

  subscribe(sourceId: string): Observable<void> {
    return this.http.post<void>(`${this.base}/scraper/subscribe/${sourceId}`, {});
  }

  unsubscribe(sourceId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/scraper/subscribe/${sourceId}`);
  }

  sendFeedback(itemId: string, signal: 'up' | 'down', galleryImageIndex?: number): Observable<{ scoreSignal: number }> {
    const payload: { signal: 'up' | 'down'; galleryImageIndex?: number } = { signal };
    if (galleryImageIndex !== null && galleryImageIndex !== undefined) {
      payload.galleryImageIndex = galleryImageIndex;
    }
    return this.http.post<{ scoreSignal: number }>(
      `${this.base}/scraper/items/${itemId}/feedback`,
      payload,
    );
  }

  acquireLease(sourceId: string): Observable<{ status: string; expiresAt: string }> {
    return this.http.post<{ status: string; expiresAt: string }>(`${this.base}/scraper/lease/${sourceId}`, {});
  }

  ingestReddit(sourceId: string, posts: any[]): Observable<{ count: number; status: string }> {
    return this.http.post<{ count: number; status: string }>(`${this.base}/scraper/ingest/reddit`, {
      source_id: sourceId,
      posts,
    });
  }
}
