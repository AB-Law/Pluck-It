import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { QuizSession, QuizResponse, TasteProfile } from '../models/scraped-item.model';

@Injectable({ providedIn: 'root' })
export class TasteQuizService {
  private readonly http = inject(HttpClient);

  private readonly base = `${environment.chatApiUrl}/api`;

  getOrCreateSession(): Observable<QuizSession> {
    return this.http
      .get<unknown>(`${this.base}/taste/quiz`)
      .pipe(map((raw) => this.normalizeSession(raw)));
  }

  respond(sessionId: string, response: QuizResponse): Observable<void> {
    return this.http.post<void>(`${this.base}/taste/quiz/${sessionId}/respond`, response);
  }

  complete(sessionId: string): Observable<TasteProfile> {
    return this.http.post<unknown>(`${this.base}/taste/quiz/${sessionId}/complete`, {}).pipe(
      map((res) => {
        const response = this.toRecord(res);
        const inferred = this.toRecord(response.inferredTastes);
        if (this.isTasteProfile(inferred)) {
          return inferred;
        }

        return this.toTasteProfile(response);
      }),
    );
  }

  private normalizeSession(raw: unknown): QuizSession {
    const payload = this.toRecord(raw);
    const phase = Number(payload.phase) === 2 ? 2 : 1;
    const userId = this.toString(payload.userId);
    const rawId = this.toString(payload.id);
    let derivedSessionId = rawId;
    if (payload.sessionId != null) {
      derivedSessionId = this.toString(payload.sessionId);
    } else if (userId && rawId.startsWith(`${userId}-`)) {
      derivedSessionId = rawId.slice(userId.length + 1);
    }
    const cards = this.toRecordArray(payload.cards);
    const imageItems = this.toRecordArray(payload.imageItems);
    const items =
      phase === 2
        ? imageItems.map((item, idx: number) => ({
            id: this.toString(item.scrapedItemId, `img-${idx}`),
            imageUrl: this.toOptionalString(item.imageUrl),
            title: this.toString(item.title, 'Outfit'),
            primaryMood: undefined,
            tags: this.toStringArray(item.tags),
          }))
        : cards.map((card: Record<string, unknown>, idx: number) => ({
            id: this.toString(card.primaryMood, `mood-${idx}`),
            imageUrl: undefined,
            title: this.toString(card.name, this.toString(card.primaryMood, 'Style')),
            primaryMood: this.toOptionalString(card.primaryMood) ?? this.toOptionalString(card.name),
            tags: [
              ...this.toStringArray(card.subMoods),
              ...this.toStringArray(card.keyPieces),
            ],
          }));

    return {
      id: derivedSessionId,
      userId,
      phase,
      items,
      isComplete: this.toBoolean(payload.isComplete),
      createdAt: this.toString(payload.createdAt, new Date().toISOString()),
    };
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value);
  }

  private toRecord(value: unknown): Record<string, unknown> {
    return this.isRecord(value) ? value : {};
  }

  private toRecordArray(value: unknown): Array<Record<string, unknown>> {
    return this.isRecordArray(value) ? value : [];
  }

  private isRecordArray(value: unknown): value is Array<Record<string, unknown>> {
    return Array.isArray(value) && value.every((entry) => this.isRecord(entry));
  }

  private toString(value: unknown, fallback = ''): string {
    return typeof value === 'string' ? value : fallback;
  }

  private toOptionalString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
  }

  private toStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((entry): entry is string => typeof entry === 'string');
  }

  private toBoolean(value: unknown): boolean {
    if (typeof value === 'boolean') {
      return value;
    }
    return Boolean(value);
  }

  private toTasteProfile(value: Record<string, unknown>): TasteProfile {
    return {
      styleKeywords: this.toStringArray(value.styleKeywords),
      brands: this.toStringArray(value.brands),
      inferredFrom: this.toTasteFrom(value.inferredFrom),
    };
  }

  private isTasteProfile(value: Record<string, unknown>): value is TasteProfile {
    return value !== undefined && Array.isArray(value.styleKeywords) && Array.isArray(value.brands);
  }

  private toTasteFrom(value: unknown): 'mood_cards' | 'images' {
    return value === 'images' ? 'images' : 'mood_cards';
  }
}
