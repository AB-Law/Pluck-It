import { TestBed } from '@angular/core/testing';
import { AuthService } from './auth.service';
import { ChatEvent, ChatService } from './chat.service';

const encoder = new TextEncoder();

describe('ChatService', () => {
  let service: ChatService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ChatService,
        { provide: AuthService, useValue: { getIdToken: vi.fn() } },
      ],
    });
    service = TestBed.inject(ChatService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const streamFromLines = (lines: string[]) => {
    return new ReadableStream({
      start(controller: ReadableStreamDefaultController<Uint8Array>) {
        for (const line of lines) {
          controller.enqueue(encoder.encode(line));
        }
        controller.close();
      },
    });
  };

  it('streams SSE token events and completes on done', async () => {
    let traceIdFromPayload: string | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      if (typeof init?.body === 'string') {
        traceIdFromPayload = JSON.parse(init.body).traceId;
      }
      return {
        ok: true,
        status: 200,
        body: streamFromLines([
          'data: {"type":"token","content":"hello"}\n\n',
          'data: {"type":"tool_use","name":"style_agent"}\n\n',
          'data: {"type":"done"}\n\n',
        ]),
      } as Response;
    });

    const events: ChatEvent[] = [];
    await new Promise<void>((resolve, reject: (reason?: unknown) => void) => {
      service.streamMessage('show me style', [], ['item-1']).subscribe({
        next: (evt) => events.push(evt),
        error: (err: unknown) => reject(err),
        complete: () => resolve(),
      });
    });

    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ type: 'token', content: 'hello' });
    expect(events[1]).toMatchObject({ type: 'tool_use', name: 'style_agent' });
    expect(events[2]).toMatchObject({ type: 'done' });
    expect(traceIdFromPayload).toBeTruthy();
    expect(events[0].traceId).toBe(traceIdFromPayload);
    expect(events[1].traceId).toBe(traceIdFromPayload);
    expect(events[2].traceId).toBe(traceIdFromPayload);
  });

  it('adds traceId client-side when server omits it', async () => {
    let traceIdFromPayload: string | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      if (typeof init?.body === 'string') {
        traceIdFromPayload = JSON.parse(init.body).traceId;
      }
      return {
        ok: true,
        status: 200,
        body: streamFromLines([
          'data: {"type":"token","content":"hello","runId":"run-1"}\n\n',
          'data: {"type":"done","runId":"run-1"}\n\n',
        ]),
      } as Response;
    });

    const events: ChatEvent[] = [];
    await new Promise<void>((resolve, reject: (reason?: unknown) => void) => {
      service.streamMessage('show me style', [], ['item-1']).subscribe({
        next: (evt) => events.push(evt),
        error: (err: unknown) => reject(err),
        complete: () => resolve(),
      });
    });

    expect(events).toHaveLength(2);
    expect(events.every(evt => evt.traceId && evt.traceId === traceIdFromPayload)).toBe(true);
  });

  it('errors when stream endpoint returns non-ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 503,
    } as Response);

    await expect(
      new Promise<void>((_, reject: (reason?: unknown) => void) => {
        service.streamMessage('hey', []).subscribe({ error: reject });
      }),
    ).rejects.toThrow('Chat API error: HTTP 503');
  });

  it('propagates fetch failures from streamMessage', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

    await expect(
      new Promise<void>((_, reject: (reason?: unknown) => void) => {
        service.streamMessage('test', []).subscribe({ error: reject });
      }),
    ).rejects.toThrow('network down');
  });

  it('loads memory payload', async () => {
    const payload = { summary: 'cached context', updatedAt: '2026-03-11T00:00:00Z' };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      json: vi.fn().mockResolvedValue(payload),
    } as unknown as Response);

    const data = await new Promise<Record<string, unknown>>((resolve) => {
      service.getMemory().subscribe((memory) => resolve(memory));
    });

    expect(data).toEqual(payload);
  });

  it('updates memory with payload', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(undefined),
    } as unknown as Response);

    const called = await new Promise<boolean>((resolve) => {
      service.updateMemory('new memory').subscribe({ next: () => resolve(true) });
    });

    expect(called).toBe(true);
  });

  it('errors when updateMemory receives non-ok status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 403 } as Response);

    await expect(
      new Promise<void>((_, reject: (reason?: unknown) => void) => {
        service.updateMemory('x').subscribe({ error: reject });
      }),
    ).rejects.toThrow('HTTP 403');
  });

  it('fetches latest digest via /api/digest/latest', async () => {
    const payload = { digest: { digest: true } };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      json: vi.fn().mockResolvedValue(payload),
    } as unknown as Response);

    const digest = await new Promise((resolve) => {
      service.getLatestDigest().subscribe(value => resolve(value));
    });

    expect(digest).toEqual(payload);
  });

  it('does not leak stream if unsubscribed before response resolves', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => undefined));
    let emitted = false;
    const sub = service.streamMessage('hello', []).subscribe({ next: () => { emitted = true; } });
    sub.unsubscribe();

    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/api/chat'), expect.objectContaining({
      method: 'POST',
    }));
    expect(sub.closed).toBe(true);
    expect(emitted).toBe(false);
  });
});
