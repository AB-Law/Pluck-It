import { Component, signal } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from '@angular/router';
import { AuthService } from './core/services/auth.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly title = signal('PluckIt - Digital Wardrobe');

  constructor(
    protected auth: AuthService,
    protected router: Router,
  ) {}

  get isLoginPage(): boolean {
    return this.router.url === '/login';
  }
}