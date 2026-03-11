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
});
