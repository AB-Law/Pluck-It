import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-stylist',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="stylist-container">
      <h2>AI Stylist</h2>
      <p>Get outfit recommendations</p>
      
      <div class="chat-box">
        <div class="messages">
          <div class="message stylist-message">
            <p>Tell me what kind of outfit you're looking for and I'll help you style it!</p>
          </div>
          <div class="message user-message" *ngIf="userMessage">
            <p>{{ userMessage }}</p>
          </div>
          <div class="message stylist-message" *ngIf="recommendation">
            <p>{{ recommendation }}</p>
          </div>
        </div>
      </div>
      
      <div class="input-area">
        <input 
          [(ngModel)]="inputText" 
          placeholder="Ask for outfit suggestions..."
          (keyup.enter)="send()"
        />
        <button (click)="send()" [disabled]="!inputText.trim()">Send</button>
      </div>
    </div>
  `,
  styles: [`
    .stylist-container {
      padding: 2rem;
      max-width: 600px;
      margin: 0 auto;
    }
    
    .chat-box {
      border: 1px solid #ddd;
      border-radius: 8px;
      padding: 1rem;
      margin: 2rem 0;
      height: 300px;
      overflow-y: auto;
      background: #f9f9f9;
    }
    
    .messages {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    
    .message {
      padding: 0.75rem 1rem;
      border-radius: 8px;
      max-width: 80%;
    }
    
    .user-message {
      background: #007bff;
      color: white;
      align-self: flex-end;
    }
    
    .stylist-message {
      background: #e9ecef;
      color: #333;
      align-self: flex-start;
    }
    
    .input-area {
      display: flex;
      gap: 0.5rem;
    }
    
    input {
      flex: 1;
      padding: 0.75rem;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 1rem;
    }
    
    button {
      padding: 0.75rem 1.5rem;
      background: #007bff;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 1rem;
    }
    
    button:hover:not(:disabled) {
      background: #0056b3;
    }
    
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  `]
})
export class StylistComponent {
  inputText = '';
  userMessage = '';
  recommendation = '';
  
  send(): void {
    const trimmed = this.inputText.trim();
    if (!trimmed) return;
    
    this.userMessage = trimmed;
    this.inputText = '';
    
    // Simulate a response
    setTimeout(() => {
      this.recommendation = 'Great choice! I recommend pairing that with some comfortable jeans and sneakers for a casual look.';
    }, 1000);
  }
}
