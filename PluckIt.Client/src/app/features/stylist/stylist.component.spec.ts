import { ComponentFixture, TestBed } from '@angular/core/testing';
import { StylistPanelComponent } from './stylist.component';
import { ChatService } from '../../core/services/chat.service';
import { of, throwError } from 'rxjs';


class MockChatService {
  getMemory = vi.fn().mockReturnValue(of({ summary: 'test memory' }));
  updateMemory = vi.fn().mockReturnValue(of({}));
  streamMessage = vi.fn().mockReturnValue(of({ type: 'done' }));
}

describe('StylistPanelComponent', () => {
  let component: StylistPanelComponent;
  let fixture: ComponentFixture<StylistPanelComponent>;
  let chatService: MockChatService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StylistPanelComponent],
      providers: [
        { provide: ChatService, useClass: MockChatService }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(StylistPanelComponent);
    component = fixture.componentInstance;
    chatService = TestBed.inject(ChatService) as any;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load memory on init', () => {
    expect(chatService.getMemory).toHaveBeenCalled();
    expect(component.memoryDraft).toBe('test memory');
  });

  it('should send a message and update messages', () => {
    component.inputText = 'Hello';
    component.sendMessage();
    expect(component.messages().some(m => m.text === 'Hello')).toBeTruthy();
    expect(component.thinking()).toBeFalsy();
  });

  it('should handle memory save', () => {
    component.memoryDraft = 'new memory';
    component.saveMemory();
    expect(chatService.updateMemory).toHaveBeenCalledWith('new memory');
  });

  it('should handle stream error', async () => {
    chatService.streamMessage.mockReturnValueOnce(throwError(() => new Error('fail')));
    component.inputText = 'fail';
    component.sendMessage();
    await new Promise(r => setTimeout(r, 100));
    expect(component.thinking()).toBeFalsy();
    expect(component.messages().some(m => m.text.includes('trouble'))).toBeTruthy();
  });

  it('should not send empty messages', () => {
    component.inputText = '   ';
    component.sendMessage();
    expect(chatService.streamMessage).not.toHaveBeenCalled();
  });

  it('queues offline style requests and shows warning message', () => {
    vi.spyOn(component['networkService'], 'isCurrentlyOnline').mockReturnValue(false);
    const enqueueSpy = vi.spyOn(component['offlineQueue'], 'enqueue');
    component.inputText = 'Offline outfit request';
    component.sendMessage();

    expect(chatService.streamMessage).not.toHaveBeenCalled();
    expect(enqueueSpy).toHaveBeenCalledWith(
      'stylist/send',
      expect.objectContaining({ text: 'Offline outfit request' }),
    );
    expect(component.messages().some(message => message.text.includes('queued'))).toBe(true);
  });

  it('should render streaming content and tool status events', () => {
    chatService.streamMessage.mockReturnValueOnce(
      of(
        { type: 'tool_use', name: 'search_wardrobe' },
        { type: 'token', content: 'Hi there' },
        { type: 'done' },
      ),
    );
    component.inputText = 'What should I wear?';
    component.sendMessage();

    expect(chatService.streamMessage).toHaveBeenCalledWith(
      'What should I wear?',
      [],
      undefined,
    );
    expect(component.currentTool()).toBeNull();
    expect(component.messages().some(m => m.text.includes('Hi there'))).toBeTruthy();
  });

  it('does not enable debug mode without query flag', () => {
    expect(component['debugEnabled']()).toBe(false);
  });

  it('should show saving state and clear it after memory save', () => {
    component.memoryDraft = 'new memory';
    expect(component.savingMemory()).toBe(false);
    component.saveMemory();
    expect(component.savingMemory()).toBe(false);
    expect(chatService.updateMemory).toHaveBeenCalledWith('new memory');
  });

  it('should handle memory save failures', () => {
    chatService.updateMemory.mockReturnValueOnce(throwError(() => new Error('bad')));
    component.memoryDraft = 'another memory';
    component.saveMemory();
    expect(component.savingMemory()).toBe(false);
  });

  it('shows debug diagnostics when debug=1 query param is present', () => {
    const previousUrl = globalThis.location.href;
    globalThis.history.pushState({}, '', '/?debug=1');
    const debugFixture = TestBed.createComponent(StylistPanelComponent);
    const debugComponent = debugFixture.componentInstance as unknown as StylistPanelComponent;
    debugFixture.detectChanges();

    chatService.streamMessage.mockReturnValueOnce(
      of(
        { type: 'token', content: 'Hi there', traceId: 'trace-1', runId: 'run-1', model: 'gpt-4', tokenCount: 7 },
        { type: 'tool_use', name: 'search_wardrobe', traceId: 'trace-1', runId: 'run-1' },
        { type: 'tool_result', name: 'search_wardrobe', summary: 'found', traceId: 'trace-1', runId: 'run-1', toolLatencyMs: 42 },
        { type: 'done', traceId: 'trace-1', runId: 'run-1' },
      ),
    );
    debugComponent.inputText = 'Need an outfit';
    debugComponent.sendMessage();
    debugFixture.detectChanges();
    expect((debugComponent as any).debugEnabled()).toBe(true);

    expect(debugFixture.nativeElement.textContent).toContain('traceId: trace-1');
    expect(debugFixture.nativeElement.textContent).toContain('runId: run-1');
    expect((debugComponent as any).debugModel()).toBe('gpt-4');
    expect((debugComponent as any).debugToolLatencyMs()).toBe(42);
    expect((debugComponent as any).debugTokenCount()).toBe(7);
    globalThis.history.replaceState({}, '', previousUrl);
  });

  it('opens and closes the memory panel', () => {
    const root = fixture.nativeElement as HTMLElement;
    const openBtn = root.querySelector<HTMLButtonElement>('button[title="View conversation memory"]');
    if (openBtn === null) {
      throw new Error('View conversation memory button should exist');
    }
    openBtn.click();
    fixture.detectChanges();

    expect(component.memoryOpen()).toBe(true);
    expect(root.textContent).toContain('Conversation Memory (editable)');

    const closeBtn = Array.from(root.querySelectorAll('button')).find(btn => btn.textContent?.trim() === 'Close');
    closeBtn?.click();
    fixture.detectChanges();
    expect(component.memoryOpen()).toBe(false);
  });

  it('emits panel close and renders selected-item banner text', () => {
    const closeSpy = vi.fn();
    component.closed.subscribe(closeSpy);

    const root = fixture.nativeElement as HTMLElement;
    const panelClose = root.querySelector<HTMLButtonElement>('[aria-label="Close panel"]');
    if (panelClose === null) {
      throw new Error('Panel close button should exist');
    }
    panelClose.click();
    expect(closeSpy).toHaveBeenCalledTimes(1);

    component.selectedItemIds.set(['item-a']);
    fixture.detectChanges();
    expect(root.textContent).toContain('1 item selected for styling');

    component.selectedItemIds.set(['item-a', 'item-b']);
    fixture.detectChanges();
    expect(root.textContent).toContain('2 items selected for styling');
  });

  it('renders assistant and user message variants', () => {
    component.messages.set([
      { role: 'assistant', text: 'Hello Stylist', time: '09:00' },
      { role: 'user', text: 'Plan outfit?', time: '09:01' },
      { role: 'assistant', text: 'Here is one', time: '09:02', streaming: true },
    ]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Hello Stylist');
    expect(fixture.nativeElement.textContent).toContain('Plan outfit?');
  });

  it('shows tool labels and clears thinking via tool lifecycle events', () => {
    component.thinking.set(true);
    (component as any).handleEvent({ type: 'tool_use', name: 'search_wardrobe' }, '');
    expect(component.currentTool()).toBe('search_wardrobe');
    expect(component.toolLabel()).toContain('Searching wardrobe');

    (component as any).handleEvent(
      { type: 'tool_result', name: 'search_wardrobe', summary: '2 matches' },
      '',
    );
    expect(component.currentTool()).toBeNull();
  });

  it('shows discovery label for search_scraped_items', () => {
    component.thinking.set(true);
    (component as any).handleEvent({ type: 'tool_use', name: 'search_scraped_items' }, '');
    expect(component.currentTool()).toBe('search_scraped_items');
    expect(component.toolLabel()).toContain('Discovering items');
  });

  it('finalises stream on done and captures chat history', () => {
    (component as any).handleEvent({ type: 'token', content: 'hello' }, 'How do I dress?');
    (component as any).handleEvent({ type: 'done' }, 'How do I dress?');

    expect(component.thinking()).toBe(false);
    expect(component.messages().some(m => m.text.includes('hello'))).toBe(true);
    expect((component as any).chatHistory).toEqual([
      { role: 'user', content: 'How do I dress?' },
      { role: 'assistant', content: 'hello' },
    ]);
  });

  it('adds assistant error bubble when stream fails without streaming bubble', () => {
    (component as any).handleEvent({ type: 'error', content: 'service down' }, 'weather');
    expect(component.thinking()).toBe(false);
    expect(component.messages().some(m => m.text === 'service down')).toBe(true);
  });

  it('does not send while thinking is active', () => {
    component.thinking.set(true);
    component.inputText = 'Tell me an outfit';
    component.sendMessage();
    expect(chatService.streamMessage).not.toHaveBeenCalled();
  });
});
