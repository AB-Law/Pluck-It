import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-closet',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="closet-container">
      <h2>Your Closet</h2>
      <p>Browse and manage your wardrobe items</p>
      <div class="items-grid">
        <div class="item-card">
          <div class="item-image">👕</div>
          <p>Nike Blue Shirt</p>
        </div>
        <div class="item-card">
          <div class="item-image">👖</div>
          <p>Denim Jeans</p>
        </div>
        <div class="item-card">
          <div class="item-image">👟</div>
          <p>Sneakers</p>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .closet-container {
      padding: 2rem;
    }
    
    .items-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 1.5rem;
      margin-top: 2rem;
    }
    
    .item-card {
      border: 1px solid #ccc;
      padding: 1rem;
      border-radius: 8px;
      text-align: center;
      cursor: pointer;
      transition: all 0.2s;
    }
    
    .item-card:hover {
      border-color: #999;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    
    .item-image {
      font-size: 3rem;
      margin-bottom: 0.5rem;
    }
  `]
})
export class ClosetComponent {}
