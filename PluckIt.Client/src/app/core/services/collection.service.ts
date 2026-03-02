import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Collection, CreateCollectionRequest } from '../models/collection.model';

@Injectable({ providedIn: 'root' })
export class CollectionService {
  private base = environment.apiUrl;

  /** Reactive list of all collections (owned + joined) for the current user. */
  readonly collections = signal<Collection[]>([]);

  constructor(private http: HttpClient) {}

  /** Load all owned + joined collections and refresh the signal. */
  loadAll(): Observable<Collection[]> {
    return this.http.get<Collection[]>(`${this.base}/api/collections`).pipe(
      tap(list => this.collections.set(list))
    );
  }

  /** Fetch a single collection by ID. */
  getById(id: string): Observable<Collection> {
    return this.http.get<Collection>(`${this.base}/api/collections/${id}`);
  }

  /** Create a new collection. */
  create(req: CreateCollectionRequest): Observable<Collection> {
    return this.http.post<Collection>(`${this.base}/api/collections`, req).pipe(
      tap(created => this.collections.update(list => [created, ...list]))
    );
  }

  /** Update name / description / visibility of an owned collection. */
  update(id: string, patch: Partial<Pick<Collection, 'name' | 'description' | 'isPublic'>>): Observable<void> {
    return this.http.put<void>(`${this.base}/api/collections/${id}`, patch).pipe(
      tap(() => this.collections.update(list =>
        list.map(c => c.id === id ? { ...c, ...patch } : c)))
    );
  }

  /** Delete an owned collection. */
  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/api/collections/${id}`).pipe(
      tap(() => this.collections.update(list => list.filter(c => c.id !== id)))
    );
  }

  /** Join a public collection via share link. */
  join(id: string): Observable<void> {
    return this.http.post<void>(`${this.base}/api/collections/${id}/join`, null);
  }

  /** Leave a collection. */
  leave(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/api/collections/${id}/leave`).pipe(
      tap(() => this.collections.update(list => list.filter(c => c.id !== id)))
    );
  }

  /** Add a clothing item to a collection. */
  addItem(collectionId: string, itemId: string): Observable<void> {
    return this.http.post<void>(`${this.base}/api/collections/${collectionId}/items`, { itemId }).pipe(
      tap(() => this.collections.update(list =>
        list.map(c => c.id === collectionId
          ? { ...c, clothingItemIds: [...c.clothingItemIds, itemId] }
          : c)))
    );
  }

  /** Remove a clothing item from a collection. */
  removeItem(collectionId: string, itemId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/api/collections/${collectionId}/items/${itemId}`).pipe(
      tap(() => this.collections.update(list =>
        list.map(c => c.id === collectionId
          ? { ...c, clothingItemIds: c.clothingItemIds.filter(i => i !== itemId) }
          : c)))
    );
  }
}
