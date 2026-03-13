import { TestBed } from '@angular/core/testing';
import { OfflineQueueService } from './offline-queue.service';

describe('OfflineQueueService', () => {
  let service: OfflineQueueService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [OfflineQueueService],
    });
    service = TestBed.inject(OfflineQueueService);
  });
  beforeEach(() => {
    if (globalThis.localStorage) {
      globalThis.localStorage.clear();
    }
  });

  beforeEach(async () => {
    await service.initialize();
    service.clear();
  });

  it('enqueues actions with id, type, payload, and timestamp', () => {
    const id = service.enqueue('wardrobe/upload', { file: 'shirt.jpg' }, 1700000000000);
    const queued = service.drain();

    expect(service.count()).toBe(1);
    expect(service.hasPending()).toBe(true);
    expect(queued[0]).toEqual({
      id,
      type: 'wardrobe/upload',
      payload: { file: 'shirt.jpg' },
      timestamp: 1700000000000,
    });
  });

  it('does not mutate queue on drain', () => {
    service.enqueue('stylist/send', { text: 'hello' });
    const first = service.drain();
    const second = service.drain();

    expect(service.count()).toBe(1);
    expect(first).toEqual(second);
  });

  it('clears queued actions', () => {
    service.enqueue('profile/save', { currencyCode: 'USD' });
    expect(service.count()).toBe(1);
    service.clear();
    expect(service.hasPending()).toBe(false);
    expect(service.count()).toBe(0);
    expect(service.drain()).toEqual([]);
  });

  it('persists offline uploads from external updates', () => {
    const now = 1700000000000;
    service.persistOfflineUploads([
      { id: '1', type: 'wardrobe/upload', payload: { fileName: 'shirt.jpg' }, timestamp: now },
    ]);

    expect(service.count()).toBe(1);
    expect(service.drain()).toEqual([
      { id: '1', type: 'wardrobe/upload', payload: { fileName: 'shirt.jpg' }, timestamp: now },
    ]);
  });

  it('falls back to localStorage for non-upload actions', async () => {
    const queueKey = 'pluckit_offline_queue_fallback_v1';
    const supportsIndexedDb = vi.spyOn(OfflineQueueService.prototype as any, '_supportsIndexedDb').mockReturnValue(false);
    const fallbackOnly = new OfflineQueueService();
    await fallbackOnly.initialize();
    fallbackOnly.enqueue('profile/save', { user: 'abc' }, 1700000000000);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(globalThis.localStorage?.getItem(queueKey)).not.toBeNull();
    expect(fallbackOnly.drain()).toHaveLength(1);
    supportsIndexedDb.mockRestore();
  });

  it('restores queue state from localStorage', async () => {
    const now = 1700000000000;
    globalThis.localStorage?.setItem('pluckit_offline_queue_fallback_v1', JSON.stringify([
      { id: 'q1', type: 'profile/save', payload: { user: 'abc' }, timestamp: now },
    ]));
    const supportsIndexedDb = vi.spyOn(OfflineQueueService.prototype as any, '_supportsIndexedDb').mockReturnValue(false);
    const rehydrated = new OfflineQueueService();
    await rehydrated.initialize();
    expect(rehydrated.drain()).toEqual([
      { id: 'q1', type: 'profile/save', payload: { user: 'abc' }, timestamp: now },
    ]);
    supportsIndexedDb.mockRestore();
  });

  it('removes offline upload actions by id', () => {
    const first = service.enqueue('wardrobe/upload', { fileName: 'shirt.jpg' });
    const second = service.enqueue('stylist/send', { message: 'hello' });
    service.removeOfflineUpload(second);

    expect(service.hasPending()).toBe(true);
    expect(service.count()).toBe(1);
    expect(service.drain()).toEqual([
      expect.objectContaining({ id: first, type: 'wardrobe/upload' }),
    ]);
  });
});
