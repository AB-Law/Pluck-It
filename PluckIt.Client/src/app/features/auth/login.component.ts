import { Component, AfterViewInit, ElementRef, ViewChild, inject, effect } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  template: `
    <div class="login-page">
      <div class="login-card">
        <div class="logo">
          <span class="logo-icon">👗</span>
          <h1>PluckIt</h1>
        </div>

        <p class="tagline">Your Personal Digital Wardrobe</p>

        <div class="divider"></div>

        <p class="prompt">Sign in to access your closet and get AI-powered outfit suggestions.</p>

        <!-- GIS renders the official "Sign in with Google" button here -->
        <div #gisBtnContainer class="gis-btn-container"></div>
      </div>
    </div>
  `,
  styles: [`
    .login-page {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 1rem;
    }

    .login-card {
      background: white;
      border-radius: 16px;
      padding: 3rem 2.5rem;
      width: 100%;
      max-width: 400px;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
    }

    .logo {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.75rem;
      margin-bottom: 0.5rem;
    }

    .logo-icon {
      font-size: 2.5rem;
    }

    .logo h1 {
      margin: 0;
      font-size: 2.25rem;
      font-weight: 700;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .tagline {
      color: #888;
      font-size: 0.95rem;
      margin: 0 0 1.5rem;
    }

    .divider {
      height: 1px;
      background: #eee;
      margin: 0 0 1.5rem;
    }

    .prompt {
      color: #555;
      font-size: 0.9rem;
      line-height: 1.6;
      margin: 0 0 2rem;
    }

    .gis-btn-container {
      display: flex;
      justify-content: center;
      width: 100%;
      min-height: 44px;
    }
  `]
})
export class LoginComponent implements AfterViewInit {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  @ViewChild('gisBtnContainer') private gisBtnContainer!: ElementRef<HTMLDivElement>;

  constructor() {
    // Navigate away as soon as GIS callback sets the user signal.
    effect(() => {
      if (this.auth.user()) {
        this.router.navigate(['/']);
      }
    });
  }

  ngAfterViewInit(): void {
    this.auth.renderButton(this.gisBtnContainer.nativeElement);
  }
}
