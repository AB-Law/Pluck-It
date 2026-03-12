import { Injectable } from '@angular/core';

export interface OfflineQueuedAction {
  id: string;
  type: string;
  payload: unknown;
  timestamp: number;
}

/**
 * In-memory queue for offline-intent actions.
 * Synchronisation/drain behavior is intentionally a no-op in this initial version.
 */
@Injectable({
  providedIn: 'root',
})
export class OfflineQueueService {
  private _queue: OfflineQueuedAction[] = [];

  /**
   * Enqueue an action to be processed once connectivity is restored.
   * Returns the action id for UI tracing.
   */
  enqueue(type: string, payload: unknown, timestamp: number = Date.now()): string {
    const id = this.createActionId();
    this._queue.push({ id, type, payload, timestamp });
    return id;
  }

  /**
   * Drain queued actions when connectivity returns.
   * Placeholder for future sync implementation: returns queued items without mutating state.
   */
  drain(): OfflineQueuedAction[] {
    return [...this._queue];
  }

  /**
   * Replaces the offline queue with a persisted snapshot.
   */
  persistOfflineUploads(actions: OfflineQueuedAction[]): void {
    this._queue = [...actions];
  }

  /**
   * Returns the current queue length.
   */
  count(): number {
    return this._queue.length;
  }

  /**
   * Convenience boolean for pending offline work.
   */
  hasPending(): boolean {
    return this.count() > 0;
  }

  /**
   * Clear the in-memory queue.
   */
  clear(): void {
    this._queue = [];
  }

  /**
   * Removes a single offline upload action from the queue.
   */
  removeOfflineUpload(actionId: string): boolean {
    const before = this._queue.length;
    this._queue = this._queue.filter(a => a.id !== actionId);
    return this._queue.length !== before;
  }

  private createActionId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `offline-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
