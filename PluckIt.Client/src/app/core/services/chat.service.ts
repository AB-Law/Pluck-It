/**
 * ChatService — connects to the Python Processor's SSE streaming chat endpoint.
 *
 * Uses the native `fetch` API with a `ReadableStream` reader instead of Angular's
 * `HttpClient`, which doesn't natively handle Server-Sent Events. The observable
 * wraps the async fetch lifecycle so it plays nicely with Angular's change detection.
 *
 * SSE event types emitted by the server:
 *   {"type": "token",       "content": "..."}       — LLM token chunk
 *   {"type": "tool_use",    "name": "..."}           — tool being called
 *   {"type": "tool_result", "name": "...", "summary": "..."} — tool returned
 *   {"type": "memory_update", "updated": boolean}   — memory summary updated
 *   {"type": "error",       "content": "..."}        — agent error
 *   {"type": "done"}                                 — stream finished
 */

import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ConversationMemory {
  summary: string;
  updatedAt: string | null;
}

// Union type for all SSE event shapes
export type ChatEvent =
  | { type: 'token'; content: string }
  | { type: 'tool_use'; name: string }
  | { type: 'tool_result'; name: string; summary: string }
  | { type: 'memory_update'; updated: boolean }
  | { type: 'error'; content: string }
  | { type: 'done' };

@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly auth = inject(AuthService);
  private readonly base = environment.chatApiUrl;

  /**
   * Stream a chat message to the stylist agent.
   * Emits ChatEvent objects as the agent responds token by token.
   *
   * @param message       The user's current message
   * @param history       Last N messages for context (alternating user/assistant)
   * @param selectedIds   Optional wardrobe item IDs selected via the styling board
   */
  streamMessage(
    message: string,
    history: ChatMessage[],
    selectedIds?: string[],
  ): Observable<ChatEvent> {
    return new Observable<ChatEvent>(observer => {
      const token = environment.production ? this.auth.getIdToken() : null;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const body = JSON.stringify({
        message,
        recentMessages: history,
        selectedItemIds: selectedIds ?? null,
      });

      let cancelled = false;

      fetch(`${this.base}/api/chat`, { method: 'POST', headers, body })
        .then(async response => {
          if (!response.ok) {
            observer.error(new Error(`Chat API error: HTTP ${response.status}`));
            return;
          }

          const reader = response.body!.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          while (!cancelled) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // SSE events are separated by double newlines
            const parts = buffer.split('\n\n');
            buffer = parts.pop() ?? '';

            for (const part of parts) {
              const line = part.trim();
              if (!line.startsWith('data: ')) continue;
              const raw = line.slice(6).trim();
              if (!raw) continue;
              try {
                const event = JSON.parse(raw) as ChatEvent;
                observer.next(event);
                if (event.type === 'done') {
                  observer.complete();
                  return;
                }
              } catch {
                // Malformed event — skip
              }
            }
          }
          observer.complete();
        })
        .catch(err => observer.error(err));

      // Teardown: mark cancelled so the loop exits on next iteration
      return () => { cancelled = true; };
    });
  }

  /** Retrieve the user's conversation memory summary. */
  getMemory(): Observable<ConversationMemory> {
    const token = environment.production ? this.auth.getIdToken() : null;
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    return new Observable(observer => {
      fetch(`${this.base}/api/chat/memory`, { headers })
        .then(r => r.json())
        .then(data => { observer.next(data); observer.complete(); })
        .catch(err => observer.error(err));
    });
  }

  /** Update the user's conversation memory summary. */
  updateMemory(summary: string): Observable<void> {
    const token = environment.production ? this.auth.getIdToken() : null;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    return new Observable(observer => {
      fetch(`${this.base}/api/chat/memory`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ summary }),
      })
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); })
        .then(() => { observer.next(); observer.complete(); })
        .catch(err => observer.error(err));
    });
  }

  /** Get the latest wardrobe digest suggestions. */
  getLatestDigest(): Observable<{ digest: unknown | null }> {
    const token = environment.production ? this.auth.getIdToken() : null;
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    return new Observable(observer => {
      fetch(`${this.base}/api/digest/latest`, { headers })
        .then(r => r.json())
        .then(data => { observer.next(data); observer.complete(); })
        .catch(err => observer.error(err));
    });
  }
}
