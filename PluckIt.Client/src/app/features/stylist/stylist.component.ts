import {
  Component,
  ElementRef,
  OnInit,
  OnDestroy,
  Output,
  Input,
  EventEmitter,
  signal,
  computed,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ChatService, ChatMessage, ChatEvent } from '../../core/services/chat.service';

interface DisplayMessage {
  role: 'assistant' | 'user';
  text: string;
  time: string;
  streaming?: boolean;
}

const TOOL_LABELS: Record<string, string> = {
  search_wardrobe:      'Searching wardrobe…',
  search_scraped_items:  'Discovering items…',
  get_wardrobe_summary: 'Reading wardrobe…',
  get_weather:          'Checking weather…',
  get_user_profile:     'Loading your profile…',
  analyze_wardrobe_gaps:'Analysing gaps…',
};

@Component({
  selector: 'app-stylist-panel',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="flex flex-col h-full bg-background-dark">

      <!-- Panel header -->
      <div class="h-16 flex items-center justify-between px-6 border-b border-border-subtle shrink-0">
        <div class="flex items-center gap-3">
          <div class="relative">
            <div class="h-2.5 w-2.5 rounded-full bg-green-500 absolute -right-0.5 -bottom-0.5 border border-background-dark animate-blink"></div>
            <span class="material-symbols-outlined text-primary" style="font-size:22px">smart_toy</span>
          </div>
          <div>
            <h3 class="text-white font-semibold text-sm">AI Stylist</h3>
            <p class="text-slate-text text-xs font-mono">Online · v3.0</p>
          </div>
        </div>
        <div class="flex items-center gap-1">
          <!-- Memory button -->
          <button
            class="text-slate-text hover:text-white transition-colors p-1.5 rounded"
            (click)="memoryOpen.set(!memoryOpen())"
            title="View conversation memory"
          >
            <span class="material-symbols-outlined" style="font-size:18px">memory</span>
          </button>
          <button
            class="lg:hidden text-slate-text hover:text-white transition-colors p-1"
            (click)="closed.emit()"
            aria-label="Close panel"
          >
            <span class="material-symbols-outlined" style="font-size:20px">close</span>
          </button>
        </div>
      </div>

      <!-- Memory panel (slide-down) -->
      @if (memoryOpen()) {
        <div class="border-b border-border-subtle bg-[#0d1117] px-4 py-3 shrink-0">
          <p class="text-[10px] text-slate-500 font-mono uppercase tracking-widest mb-2">Conversation Memory (editable)</p>
          <textarea
            class="w-full bg-[#111] border border-[#333] text-slate-300 text-xs font-mono p-2 resize-none focus:outline-none focus:border-primary rounded"
            rows="4"
            [(ngModel)]="memoryDraft"
            placeholder="Nothing memorised yet. The more you chat, the smarter your stylist gets."
          ></textarea>
          <div class="flex gap-2 mt-1.5">
            <button
              class="text-[10px] text-primary hover:text-blue-400 font-mono uppercase"
              (click)="saveMemory()"
              [disabled]="savingMemory()"
            >{{ savingMemory() ? 'Saving…' : 'Save' }}</button>
            <button
              class="text-[10px] text-slate-500 hover:text-white font-mono uppercase"
              (click)="memoryOpen.set(false)"
            >Close</button>
          </div>
        </div>
      }

      <!-- Selected items context banner -->
      @if (selectedItemIds() && selectedItemIds()!.length > 0) {
        <div class="flex items-center gap-2 px-4 py-2 bg-primary/10 border-b border-primary/30 shrink-0">
          <span class="material-symbols-outlined text-primary" style="font-size:16px">dashboard_customize</span>
          <span class="text-xs text-primary font-mono">{{ selectedItemIds()!.length }} item{{ selectedItemIds()!.length > 1 ? 's' : '' }} selected for styling</span>
          <button class="ml-auto text-slate-500 hover:text-white" (click)="clearSelected.emit()">
            <span class="material-symbols-outlined" style="font-size:14px">close</span>
          </button>
        </div>
      }

      <!-- Messages -->
      <div #messageList class="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">

        @for (msg of messages(); track $index) {
          @if (msg.role === 'assistant') {
            <div class="flex gap-3">
              <div class="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                <span class="material-symbols-outlined text-primary" style="font-size:16px">smart_toy</span>
              </div>
              <div class="flex flex-col gap-1 min-w-0">
                <span class="text-[11px] text-slate-400 font-mono">{{ msg.time }}</span>
                <div class="bg-[#223649] p-3 rounded-2xl rounded-tl-none text-sm text-slate-200 leading-relaxed border border-[#333] whitespace-pre-wrap">{{ msg.text }}<span
                  [class]="msg.streaming ? 'inline-block w-0.5 h-3.5 bg-slate-400 animate-blink align-middle ml-0.5' : 'hidden'"
                ></span></div>
              </div>
            </div>
          } @else {
            <div class="flex gap-3 flex-row-reverse">
              <div class="h-8 w-8 rounded-full bg-slate-700 flex items-center justify-center shrink-0">
                <span class="material-symbols-outlined text-slate-400" style="font-size:16px">person</span>
              </div>
              <div class="flex flex-col gap-1 items-end min-w-0 max-w-[82%]">
                <span class="text-[11px] text-slate-400 font-mono">{{ msg.time }}</span>
                <div class="bg-gradient-to-br from-[#2563eb] to-[#1d4ed8] border border-blue-300/25 shadow-[0_8px_24px_rgba(37,99,235,0.35)] p-3 rounded-2xl rounded-tr-none text-sm text-white leading-relaxed whitespace-pre-wrap">
                  {{ msg.text }}
                </div>
              </div>
            </div>
          }
        }

        <!-- Thinking / tool-call status -->
        @if (thinking()) {
          <div class="flex gap-3">
            <div class="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
              <span class="material-symbols-outlined text-primary" style="font-size:16px">smart_toy</span>
            </div>
            <div class="flex flex-col gap-2">
              @if (!currentTool() && !streamingActive()) {
                <div class="bg-[#223649] px-4 py-3 rounded-2xl rounded-tl-none border border-[#333] flex gap-1.5 items-center">
                  <span class="w-1.5 h-1.5 rounded-full bg-slate-400 animate-blink"></span>
                  <span class="w-1.5 h-1.5 rounded-full bg-slate-400 animate-blink" style="animation-delay:0.3s"></span>
                  <span class="w-1.5 h-1.5 rounded-full bg-slate-400 animate-blink" style="animation-delay:0.6s"></span>
                </div>
              }
              @if (currentTool()) {
                <div class="flex items-center gap-1.5 text-[11px] text-slate-400 font-mono">
                  <span class="material-symbols-outlined animate-spin text-primary" style="font-size:13px">progress_activity</span>
                  {{ toolLabel() }}
                </div>
              }
            </div>
          </div>
        }
      </div>

      <!-- Input bar -->
      <div class="p-4 border-t border-border-subtle bg-card-dark shrink-0">
        <div class="relative">
          <input
            class="w-full bg-[#111] border border-[#333] text-white rounded-lg pl-4 pr-12 py-3 text-sm focus:ring-1 focus:ring-primary focus:border-primary placeholder-slate-500 outline-none transition-colors"
            placeholder="Ask your stylist…"
            type="text"
            [(ngModel)]="inputText"
            (keydown.enter)="sendMessage()"
            [disabled]="thinking()"
          />
          <button
            class="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 bg-primary rounded-md text-white hover:bg-blue-500 transition-colors disabled:opacity-40"
            (click)="sendMessage()"
            [disabled]="!inputText.trim() || thinking()"
          >
            <span class="material-symbols-outlined" style="font-size:18px">arrow_upward</span>
          </button>
        </div>
        <p class="text-[10px] text-slate-600 text-center mt-2">AI can make mistakes. Review all outfit suggestions.</p>
      </div>
    </div>
  `,
})
export class StylistPanelComponent implements OnInit, OnDestroy {
  @Output() closed        = new EventEmitter<void>();
  @Output() clearSelected = new EventEmitter<void>();

  /** Wardrobe item IDs pre-selected from the styling board. */
  @Input() selectedItemIds = signal<string[] | null>(null);

  @ViewChild('messageList') private readonly messageList!: ElementRef<HTMLElement>;

  readonly messages       = signal<DisplayMessage[]>([]);
  readonly thinking       = signal(false);
  readonly currentTool    = signal<string | null>(null);
  readonly memoryOpen     = signal(false);
  readonly savingMemory   = signal(false);
  /** True once the streaming bubble has been created (first token received). */
  readonly streamingActive = computed(() => this.messages().some(m => m.streaming));

  readonly toolLabel = computed(() => {
    const t = this.currentTool();
    return t ? (TOOL_LABELS[t] ?? `${t}…`) : '';
  });

  inputText  = '';
  memoryDraft = '';

  private chatHistory: ChatMessage[] = [];
  private streamSub?: Subscription;
  private streamingIndex = -1;

  constructor(private readonly chat: ChatService) {}

  ngOnInit(): void {
    this.messages.set([{
      role: 'assistant',
      text: "Hi! I'm your AI Stylist. Tell me what you're going for — an occasion, a vibe, or specific pieces — and I'll build looks from your wardrobe.",
      time: this.now(),
    }]);

    // Load memory for the editor
    this.chat.getMemory().subscribe({
      next: m => { this.memoryDraft = m.summary; },
      error: () => {},
    });
  }

  ngOnDestroy(): void {
    this.streamSub?.unsubscribe();
  }

  sendMessage(): void {
    const text = this.inputText.trim();
    if (!text || this.thinking()) return;

    this.inputText = '';
    this.messages.update(msgs => [...msgs, { role: 'user', text, time: this.now() }]);
    this.thinking.set(true);
    this.currentTool.set(null);
    this.streamingIndex = -1; // will be set on first token
    setTimeout(() => this.scrollToBottom());

    this.streamSub = this.chat.streamMessage(text, this.chatHistory, this.selectedItemIds() ?? undefined)
      .subscribe({
        next: (event: ChatEvent) => this.handleEvent(event, text),
        error: () => {
          this.finaliseStream('Sorry, I had trouble reaching the styling service. Please try again.');
        },
        complete: () => {
          this.thinking.set(false);
          this.currentTool.set(null);
        },
      });
  }

  private handleEvent(event: ChatEvent, userText: string): void {
    switch (event.type) {
      case 'token':
        // Create the streaming bubble on the very first token (not before)
        if (this.streamingIndex < 0) {
          this.messages.update(msgs => [...msgs, { role: 'assistant', text: '', time: this.now(), streaming: true }]);
          this.streamingIndex = this.messages().length - 1;
        }
        this.messages.update(msgs => {
          const copy = [...msgs];
          if (this.streamingIndex >= 0 && copy[this.streamingIndex]) {
            copy[this.streamingIndex] = { ...copy[this.streamingIndex], text: copy[this.streamingIndex].text + event.content };
          }
          return copy;
        });
        this.currentTool.set(null);
        setTimeout(() => this.scrollToBottom());
        break;

      case 'tool_use':
        this.currentTool.set(event.name);
        break;

      case 'tool_result':
        this.currentTool.set(null);
        break;

      case 'done': {
        // Capture index BEFORE finaliseStream() resets it to -1
        const doneIndex = this.streamingIndex;
        this.finaliseStream(null);
        // Record completed exchange in chat history for future context
        const finalMsg = this.messages()[doneIndex];
        if (finalMsg) {
          this.chatHistory = [
            ...this.chatHistory.slice(-14), // keep last 7 exchanges (14 messages)
            { role: 'user', content: userText },
            { role: 'assistant', content: finalMsg.text },
          ];
        }
        break;
      }

      case 'error':
        this.finaliseStream(event.content);
        break;
    }
  }

  private finaliseStream(errorText: string | null): void {
    this.thinking.set(false);
    this.currentTool.set(null);
    this.messages.update(msgs => {
      const copy = [...msgs];
      if (this.streamingIndex >= 0 && copy[this.streamingIndex]) {
        copy[this.streamingIndex] = {
          ...copy[this.streamingIndex],
          streaming: false,
          text: (errorText ?? copy[this.streamingIndex].text) || '…',
        };
      } else if (errorText) {
        copy.push({ role: 'assistant', text: errorText, time: this.now() });
      }
      return copy;
    });
    this.streamingIndex = -1;
    setTimeout(() => this.scrollToBottom());
  }

  saveMemory(): void {
    this.savingMemory.set(true);
    this.chat.updateMemory(this.memoryDraft).subscribe({
      next: () => { this.savingMemory.set(false); this.memoryOpen.set(false); },
      error: () => { this.savingMemory.set(false); },
    });
  }

  private scrollToBottom(): void {
    if (this.messageList) {
      this.messageList.nativeElement.scrollTop = this.messageList.nativeElement.scrollHeight;
    }
  }

  private now(): string {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
}

