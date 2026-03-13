import { Injectable } from '@angular/core';

export interface OfflineQueuedAction {
  id: string;
  type: string;
  payload: unknown;
  timestamp: number;
}

const OFFLINE_DB_NAME = 'pluckit-offline-queue';
const OFFLINE_DB_VERSION = 1;
const OFFLINE_DB_STORE = 'actions';
const OFFLINE_QUEUE_FALLBACK_KEY = 'pluckit_offline_queue_fallback_v1';

/**
 * Persistent queue for offline-intent actions.
 * Uses IndexedDB for durable storage with localStorage fallback for
 * non-upload actions.
 */
@Injectable({
  providedIn: 'root',
})
export class OfflineQueueService {
  private _queue: OfflineQueuedAction[] = [];
  private _db?: IDBDatabase;
  private _dbOpen?: Promise<IDBDatabase | null>;
  private _bootstrapping: Promise<void> | null = null;

  constructor() {
  }

  /**
   * Ensure persistent hydration is finished before using the queue.
   */
  initialize(): Promise<void> {
    this._bootstrapping ??= this._hydrate().catch((error: unknown) => {
      globalThis.console?.warn('[offline-queue] failed to hydrate', error);
    });
    return this._bootstrapping;
  }

  /**
   * Enqueue an action to be processed once connectivity is restored.
   * Returns the action id for UI tracing.
   */
  enqueue(type: string, payload: unknown, timestamp: number = Date.now()): string {
    const id = this.createActionId();
    this._queue.push({ id, type, payload, timestamp });
    void this._persist();
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
    void this._persist();
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
    void this._clearPersisted();
  }

  /**
   * Removes a single offline action from the queue.
   */
  removeOfflineUpload(actionId: string): boolean {
    const before = this._queue.length;
    this._queue = this._queue.filter((a) => a.id !== actionId);
    if (this._queue.length !== before) {
      void this._persist();
      return true;
    }
    return false;
  }

  private async _hydrate(): Promise<void> {
    const hydrated: OfflineQueuedAction[] = [];
    const indexedDbActions = await this._loadIndexedDbActions();
    const fallbackActions = this._loadFallbackActions();
    for (const action of [...indexedDbActions, ...fallbackActions]) {
      const normalized = this._normalizeAction(action);
      if (normalized) {
        hydrated.push(normalized);
      }
    }
    this._queue = this._dedupeActions(hydrated);
  }

  private _dedupeActions(actions: OfflineQueuedAction[]): OfflineQueuedAction[] {
    const map = new Map<string, OfflineQueuedAction>();
    for (const action of actions) {
      const existing = map.get(action.id);
      if (!existing || action.timestamp > existing.timestamp) {
        map.set(action.id, action);
      }
    }
    return [...map.values()].sort((a, b) => a.timestamp - b.timestamp);
  }

  private _normalizeAction(raw: unknown): OfflineQueuedAction | null {
    if (!raw || typeof raw !== 'object') return null;
    const candidate = raw as Partial<OfflineQueuedAction>;
    if (typeof candidate.id !== 'string' || typeof candidate.type !== 'string') return null;
    if (typeof candidate.timestamp !== 'number') return null;
    return {
      id: candidate.id,
      type: candidate.type,
      payload: candidate.payload,
      timestamp: candidate.timestamp,
    };
  }

  private _requiresIndexedDb(action: OfflineQueuedAction): boolean {
    if (!action.payload || typeof action.payload !== 'object') {
      return false;
    }

    const payload = action.payload as { blob?: unknown; file?: unknown };
    return (
      (globalThis.Blob !== undefined && (payload.blob instanceof Blob || payload.file instanceof Blob))
      || (globalThis.File !== undefined && (payload.blob instanceof File || payload.file instanceof File))
    );
  }

  private _requiresFallback(action: OfflineQueuedAction): boolean {
    return !this._requiresIndexedDb(action);
  }

  private async _persist(): Promise<void> {
    await this.initialize();
    const storedInIndexedDb = await this._saveToIndexedDb();
    const fallbackActions = this._queue.filter((action) => this._requiresFallback(action));

    if (storedInIndexedDb || fallbackActions.length === 0) {
      this._clearFallback();
      return;
    }

    this._saveToFallbackStorage(fallbackActions);
  }

  private async _saveToIndexedDb(): Promise<boolean> {
    const db = await this._getDb();
    if (!db) {
      return false;
    }

    return new Promise<boolean>((resolve) => {
      try {
        const tx = db.transaction(OFFLINE_DB_STORE, 'readwrite');
        const store = tx.objectStore(OFFLINE_DB_STORE);
        const clearReq = store.clear();
        clearReq.onerror = () => resolve(false);
        clearReq.onsuccess = () => {
          for (const action of this._queue) {
            store.put(action);
          }
        };
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  }

  private async _loadIndexedDbActions(): Promise<OfflineQueuedAction[]> {
    const db = await this._getDb();
    if (!db) {
      return [];
    }

    return new Promise<OfflineQueuedAction[]>((resolve) => {
      try {
        const tx = db.transaction(OFFLINE_DB_STORE, 'readonly');
        const store = tx.objectStore(OFFLINE_DB_STORE);
        const request = store.getAll();
        request.onsuccess = () => {
          const values = request.result;
          if (!Array.isArray(values)) {
            resolve([]);
            return;
          }
          const actions = values
            .map((value) => this._normalizeAction(value))
            .filter((value): value is OfflineQueuedAction => value !== null);
          resolve(actions);
        };
        request.onerror = () => resolve([]);
        tx.onerror = () => resolve([]);
        tx.onabort = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
  }

  private _loadFallbackActions(): OfflineQueuedAction[] {
    if (!this._supportsLocalStorage()) {
      return [];
    }
    try {
      const raw = globalThis.localStorage.getItem(OFFLINE_QUEUE_FALLBACK_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((value) => this._normalizeAction(value))
        .filter((value): value is OfflineQueuedAction => value !== null);
    } catch {
      this._clearFallback();
      return [];
    }
  }

  private _saveToFallbackStorage(actions: OfflineQueuedAction[]): void {
    if (!this._supportsLocalStorage()) {
      return;
    }
    try {
      globalThis.localStorage.setItem(
        OFFLINE_QUEUE_FALLBACK_KEY,
        JSON.stringify(actions),
      );
    } catch {
      globalThis.console?.warn('[offline-queue] failed to persist fallback queue');
    }
  }

  private _clearFallback(): void {
    if (!this._supportsLocalStorage()) return;
    try {
      globalThis.localStorage.removeItem(OFFLINE_QUEUE_FALLBACK_KEY);
    } catch {
      // ignore storage write failures
    }
  }

  private async _clearPersisted(): Promise<void> {
    const db = await this._getDb();
    if (db) {
      await new Promise<void>((resolve) => {
        const tx = db.transaction(OFFLINE_DB_STORE, 'readwrite');
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
        tx.oncomplete = () => resolve();
        tx.objectStore(OFFLINE_DB_STORE).clear();
      });
    }
    this._clearFallback();
  }

  private _supportsLocalStorage(): boolean {
    try {
      return globalThis?.localStorage !== undefined;
    } catch {
      return false;
    }
  }

  private _supportsIndexedDb(): boolean {
    try {
      return globalThis?.indexedDB != null;
    } catch {
      return false;
    }
  }

  private async _getDb(): Promise<IDBDatabase | null> {
    if (!this._supportsIndexedDb()) {
      return null;
    }
    if (this._db) {
      return this._db;
    }
    this._dbOpen ??= new Promise<IDBDatabase | null>((resolve) => {
      const request = globalThis.indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(OFFLINE_DB_STORE)) {
          db.createObjectStore(OFFLINE_DB_STORE, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => {
        this._db ??= request.result;
        resolve(request.result);
      };
      request.onerror = () => resolve(null);
    });
    return this._dbOpen;
  }

  private createActionId(): string {
    if (
      typeof globalThis.crypto?.randomUUID === 'function'
    ) {
      return globalThis.crypto.randomUUID();
    }
    return `offline-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
