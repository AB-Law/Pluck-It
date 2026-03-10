import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { QuizSession, QuizResponse, TasteProfile } from '../models/scraped-item.model';

@Injectable({ providedIn: 'root' })
export class TasteQuizService {
  private base = `${environment.chatApiUrl}/api`;

  constructor(private http: HttpClient) {}

  getOrCreateSession(): Observable<QuizSession> {
    return this.http.get<any>(`${this.base}/taste/quiz`).pipe(
      map(raw => this.normalizeSession(raw)),
    );
  }

  respond(sessionId: string, response: QuizResponse): Observable<void> {
    return this.http.post<void>(`${this.base}/taste/quiz/${sessionId}/respond`, response);
  }

  complete(sessionId: string): Observable<TasteProfile> {
    return this.http.post<any>(`${this.base}/taste/quiz/${sessionId}/complete`, {}).pipe(
      map(res => (res?.inferredTastes ?? res) as TasteProfile),
    );
  }

  private normalizeSession(raw: any): QuizSession {
    const phase = Number(raw?.phase) === 2 ? 2 : 1;
    const userId = String(raw?.userId ?? '');
    const rawId = String(raw?.id ?? '');
    const derivedSessionId =
      raw?.sessionId
        ? String(raw.sessionId)
        : (userId && rawId.startsWith(`${userId}-`) ? rawId.slice(userId.length + 1) : rawId);
    const cards = Array.isArray(raw?.cards) ? raw.cards : [];
    const imageItems = Array.isArray(raw?.imageItems) ? raw.imageItems : [];
    const items = phase === 2
      ? imageItems.map((i: any, idx: number) => ({
          id: String(i?.scrapedItemId ?? `img-${idx}`),
          imageUrl: i?.imageUrl ?? '',
          title: i?.title ?? 'Outfit',
          primaryMood: undefined,
          tags: Array.isArray(i?.tags) ? i.tags : [],
        }))
      : cards.map((c: any, idx: number) => ({
          id: String(c?.primaryMood ?? `mood-${idx}`),
          imageUrl: undefined,
          title: c?.name ?? c?.primaryMood ?? 'Style',
          primaryMood: c?.primaryMood ?? c?.name ?? undefined,
          tags: [
            ...(Array.isArray(c?.subMoods) ? c.subMoods : []),
            ...(Array.isArray(c?.keyPieces) ? c.keyPieces : []),
          ],
        }));

    return {
      id: derivedSessionId,
      userId,
      phase: phase as 1 | 2,
      items,
      isComplete: Boolean(raw?.isComplete),
      createdAt: String(raw?.createdAt ?? new Date().toISOString()),
    };
  }
}
