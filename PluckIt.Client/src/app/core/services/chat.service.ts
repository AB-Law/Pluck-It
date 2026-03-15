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
import { Observable, Subscriber } from 'rxjs';
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

interface ChatTraceFields {
  traceId?: string;
  runId?: string;
  model?: string;
  toolLatencyMs?: number;
  tokenCount?: number;
}

// Union type for all SSE event shapes
export type ChatEvent =
  | ({ type: 'token'; content: string } & ChatTraceFields)
  | ({ type: 'tool_use'; name: string } & ChatTraceFields)
  | ({ type: 'tool_result'; name: string; summary: string } & ChatTraceFields)
  | ({ type: 'memory_update'; updated: boolean } & ChatTraceFields)
  | ({ type: 'error'; content: string } & ChatTraceFields)
  | ({ type: 'done' } & ChatTraceFields);

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
      const headers = this.buildHeaders(true);
      const traceId = this.createTraceId();
      const body = this.buildBody(message, history, selectedIds, traceId);

      let cancelled = false;

      fetch(`${this.base}/api/chat`, { method: 'POST', headers, body })
        .then(async response => {
          if (!response.ok) {
            this.emitError(observer, response.status);
            return;
          }
          if (!response.body) {
            observer.complete();
            return;
          }
          await this.readSseStream(
            response.body.getReader(),
            observer,
            () => cancelled,
            traceId,
          );
        })
        .catch(err => observer.error(err));

      // Teardown: mark cancelled so the loop exits on next iteration
      return () => { cancelled = true; };
    });
  }

  private buildHeaders(includeContentType = true): Record<string, string> {
    const token = environment.production ? this.auth.getIdToken() : null;
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (includeContentType) headers['Content-Type'] = 'application/json';
    return headers;
  }

  private buildBody(
    message: string,
    history: ChatMessage[],
    selectedIds: string[] | undefined,
    traceId: string,
  ): string {
    return JSON.stringify({
      message,
      recentMessages: history,
      selectedItemIds: selectedIds ?? null,
      traceId,
    });
  }

  private emitError(observer: Subscriber<ChatEvent>, status: number): void {
    observer.error(new Error(`Chat API error: HTTP ${status}`));
  }

  private parseSseLine(rawLine: string): ChatEvent | null {
    const line = rawLine.trim();
    if (!line.startsWith('data: ')) return null;
    const payload = line.slice(6).trim();
    if (!payload) return null;
    try {
      return JSON.parse(payload) as ChatEvent;
    } catch {
      return null;
    }
  }

  private async readSseStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    observer: Subscriber<ChatEvent>,
    isCancelled: () => boolean,
    traceId: string,
  ): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = '';

    while (!isCancelled()) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      buffer += decoder.decode(value, { stream: true });
      const parsed = this.consumeSseBuffer(buffer, observer, traceId);
      if (parsed.done) {
        observer.complete();
        return;
      }
      buffer = parsed.nextBuffer;
    }
    observer.complete();
  }

  private consumeSseBuffer(
    inputBuffer: string,
    observer: Subscriber<ChatEvent>,
    traceId: string,
  ): { done: boolean; nextBuffer: string } {
    const parts = inputBuffer.split('\n\n');
    const nextBuffer = parts.pop() ?? '';
    for (const part of parts) {
      const event = this.parseSseLine(part);
      if (!event) continue;
      if (!event.traceId) {
        event.traceId = traceId;
      }
      observer.next(event);
      if (event.type === 'done') return { done: true, nextBuffer };
    }
    return { done: false, nextBuffer };
  }

  private createTraceId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `trace-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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
  getLatestDigest(): Observable<{ digest: unknown }> {
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
