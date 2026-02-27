import { Component } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import { WardrobeService, OutfitRecommendation, StylistRequest } from '../../core/wardrobe.service';

interface ChatMessage {
  from: 'user' | 'stylist';
  text: string;
}

@Component({
  selector: 'app-stylist-chat',
  standalone: true,
  imports: [NgFor, NgIf],
  templateUrl: './stylist-chat.component.html',
})
export class StylistChatComponent {
  input = '';
  loading = false;
  messages: ChatMessage[] = [
    {
      from: 'stylist',
      text: 'Tell me what kind of outfit you want and I’ll build it from your wardrobe.',
    },
  ];
  recommendations: OutfitRecommendation[] = [];

  constructor(private readonly wardrobeService: WardrobeService) {}

  send(): void {
    const trimmed = this.input.trim();
    if (!trimmed || this.loading) {
      return;
    }

    this.messages.push({ from: 'user', text: trimmed });
    this.loading = true;

    const request: StylistRequest = {
      stylePrompt: trimmed,
    };

    this.wardrobeService.getRecommendations(request).subscribe({
      next: (recs) => {
        this.recommendations = recs;
        if (!recs.length) {
          this.messages.push({
            from: 'stylist',
            text: "I couldn't create any outfits from your wardrobe yet. Try adding a few more pieces.",
          });
        } else {
          this.messages.push({
            from: 'stylist',
            text: 'Here are a few ways to combine what you own right now.',
          });
        }
      },
      error: () => {
        this.messages.push({
          from: 'stylist',
          text: 'Something went wrong while generating outfits. Please try again in a moment.',
        });
      },
      complete: () => {
        this.loading = false;
        this.input = '';
      },
    });
  }
}

