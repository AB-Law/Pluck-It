import {
  Component,
  ElementRef,
  OnInit,
  Output,
  EventEmitter,
  signal,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { StylistService, OutfitRecommendation } from '../../core/services/stylist.service';

interface ChatMessage {
  role: 'assistant' | 'user';
  text: string;
  time: string;
  outfits?: OutfitRecommendation[];
}

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
            <p class="text-slate-text text-xs font-mono">Online · v2.4</p>
          </div>
        </div>
        <button
          class="lg:hidden text-slate-text hover:text-white transition-colors p-1"
          (click)="closed.emit()"
          aria-label="Close panel"
        >
          <span class="material-symbols-outlined" style="font-size:20px">close</span>
        </button>
      </div>

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
                <div class="bg-[#223649] p-3 rounded-2xl rounded-tl-none text-sm text-slate-200 leading-relaxed border border-[#333]">
                  {{ msg.text }}
                </div>
                @if (msg.outfits && msg.outfits.length > 0) {
                  @for (outfit of msg.outfits; track outfit.id) {
                    <div class="mt-2 bg-card-dark rounded-lg border border-[#333] p-3">
                      <p class="text-xs font-bold text-white mb-1">{{ outfit.title }}</p>
                      <p class="text-[11px] text-slate-400 mb-2 leading-relaxed">{{ outfit.description }}</p>
                      <div class="flex justify-end">
                        <button class="text-[10px] bg-white text-black px-2 py-1 rounded font-bold hover:bg-slate-200 transition-colors">
                          SAVE
                        </button>
                      </div>
                    </div>
                  }
                }
              </div>
            </div>
          } @else {
            <div class="flex gap-3 flex-row-reverse">
              <div class="h-8 w-8 rounded-full bg-slate-700 flex items-center justify-center shrink-0">
                <span class="material-symbols-outlined text-slate-400" style="font-size:16px">person</span>
              </div>
              <div class="flex flex-col gap-1 items-end">
                <span class="text-[11px] text-slate-400 font-mono">{{ msg.time }}</span>
                <div class="bg-primary p-3 rounded-2xl rounded-tr-none text-sm text-white leading-relaxed">
                  {{ msg.text }}
                </div>
              </div>
            </div>
          }
        }

        @if (thinking()) {
          <div class="flex gap-3">
            <div class="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
              <span class="material-symbols-outlined text-primary" style="font-size:16px">smart_toy</span>
            </div>
            <div class="bg-[#223649] px-4 py-3 rounded-2xl rounded-tl-none border border-[#333] flex gap-1.5 items-center">
              <span class="w-1.5 h-1.5 rounded-full bg-slate-400 animate-blink"></span>
              <span class="w-1.5 h-1.5 rounded-full bg-slate-400 animate-blink" style="animation-delay:0.3s"></span>
              <span class="w-1.5 h-1.5 rounded-full bg-slate-400 animate-blink" style="animation-delay:0.6s"></span>
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
        <p class="text-[10px] text-slate-600 text-center mt-2">AI can make mistakes. Review generated outfits.</p>
      </div>
    </div>
  `,
})
export class StylistPanelComponent implements OnInit {
  @Output() closed = new EventEmitter<void>();
  @ViewChild('messageList') private messageList!: ElementRef<HTMLElement>;

  readonly messages = signal<ChatMessage[]>([]);
  readonly thinking  = signal(false);
  inputText = '';

  constructor(private stylist: StylistService) {}

  ngOnInit(): void {
    this.messages.set([{
      role: 'assistant',
      text: "Hi! I'm your AI Stylist. Tell me what you're going for — an occasion, a vibe, or a specific look — and I'll put together outfit ideas from your wardrobe.",
      time: this.now(),
    }]);
  }

  sendMessage(): void {
    const text = this.inputText.trim();
    if (!text || this.thinking()) return;

    this.inputText = '';
    this.messages.update(msgs => [...msgs, { role: 'user', text, time: this.now() }]);
    this.thinking.set(true);
    setTimeout(() => this.scrollToBottom());

    this.stylist.getRecommendations({ stylePrompt: text }).subscribe({
      next: outfits => {
        this.thinking.set(false);
        const responseText = outfits.length > 0
          ? `Here are ${outfits.length} outfit idea${outfits.length > 1 ? 's' : ''} from your wardrobe:`
          : "I couldn't find a strong combination in your wardrobe for that. Try uploading more items!";
        this.messages.update(msgs => [...msgs, {
          role: 'assistant',
          text: responseText,
          time: this.now(),
          outfits: outfits.length > 0 ? outfits : undefined,
        }]);
        setTimeout(() => this.scrollToBottom());
      },
      error: () => {
        this.thinking.set(false);
        this.messages.update(msgs => [...msgs, {
          role: 'assistant',
          text: 'Sorry, I had trouble reaching the styling service. Please try again.',
          time: this.now(),
        }]);
        setTimeout(() => this.scrollToBottom());
      },
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
