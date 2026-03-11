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
      start(controller) {
        for (const line of lines) {
          controller.enqueue(encoder.encode(line));
        }
        controller.close();
      },
    });
  };

  it('streams SSE token events and completes on done', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      body: streamFromLines([
        'data: {"type":"token","content":"hello"}\n\n',
        'data: {"type":"tool_use","name":"style_agent"}\n\n',
        'data: {"type":"done"}\n\n',
      ]),
    } as Response);

    const events: ChatEvent[] = [];
    await new Promise<void>((resolve, reject) => {
      service.streamMessage('show me style', [], ['item-1']).subscribe({
        next: (evt) => events.push(evt),
        error: err => reject(err),
        complete: () => resolve(),
      });
    });

    expect(events).toEqual([
      { type: 'token', content: 'hello' },
      { type: 'tool_use', name: 'style_agent' },
      { type: 'done' },
    ]);
  });

  it('errors when stream endpoint returns non-ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 503,
    } as Response);

    await expect(
      new Promise((_, reject) => {
        service.streamMessage('hey', []).subscribe({ error: reject });
      }),
    ).rejects.toThrow('Chat API error: HTTP 503');
  });

  it('propagates fetch failures from streamMessage', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

    await expect(
      new Promise((_, reject) => {
        service.streamMessage('test', []).subscribe({ error: reject });
      }),
    ).rejects.toThrow('network down');
  });

  it('loads memory payload', async () => {
    const payload = { summary: 'cached context', updatedAt: '2026-03-11T00:00:00Z' };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      json: vi.fn().mockResolvedValue(payload),
    } as unknown as Response);

    const data = await new Promise<any>((resolve) => {
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
      new Promise((_, reject) => {
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
