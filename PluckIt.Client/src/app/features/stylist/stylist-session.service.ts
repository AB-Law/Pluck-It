import { Injectable, signal } from '@angular/core';
import { ChatMessage } from '../../core/services/chat.service';

/** UI message record rendered in the stylist panel conversation. */
export interface StylistDisplayMessage {
  role: 'assistant' | 'user';
  text: string;
  time: string;
  streaming?: boolean;
}

@Injectable({ providedIn: 'root' })
export class StylistSessionService {
  readonly messages = signal<StylistDisplayMessage[]>([]);
  readonly chatHistory = signal<ChatMessage[]>([]);

  /** Seeds the welcome message once per app session. */
  ensureGreeting(timeLabel: string): void {
    if (this.messages().length > 0) {
      return;
    }
    this.messages.set([
      {
        role: 'assistant',
        text: "Hi! I'm your AI Stylist. Tell me what you're going for - an occasion, a vibe, or specific pieces - and I'll build looks from your wardrobe.",
        time: timeLabel,
      },
    ]);
  }
}
