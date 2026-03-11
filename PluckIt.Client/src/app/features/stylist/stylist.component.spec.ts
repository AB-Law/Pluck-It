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
});
