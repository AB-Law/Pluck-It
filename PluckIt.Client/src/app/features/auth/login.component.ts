import { Component, inject, effect } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="relative min-h-screen overflow-hidden bg-background-dark text-chrome">
      <div class="absolute inset-0 opacity-30 pointer-events-none bg-[radial-gradient(circle_at_20%_20%,rgba(196,131,106,0.2),transparent_45%),radial-gradient(circle_at_85%_70%,rgba(184,123,104,0.18),transparent_40%)]"></div>
      <main class="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl flex-col justify-between px-6 py-10 md:px-10">
        <header class="flex items-center justify-between">
          <div class="flex items-baseline gap-2">
            <span class="h-2 w-2 rounded-full bg-primary"></span>
            <span class="text-lg font-medium">Pluck It</span>
            <span class="hidden md:inline text-sm italic text-slate-text">- a wardrobe journal</span>
          </div>
        </header>
        <section class="mx-auto w-full max-w-2xl text-center">
          <p class="mb-6 text-xs uppercase tracking-[0.3em] text-slate-text">Sign in - Members</p>
          <h1 class="mb-4 text-5xl font-normal tracking-tight md:text-7xl [font-family:'Cormorant_Garamond',serif]">
            Your wardrobe,
            <em class="text-primary"> reimagined.</em>
          </h1>
          <p class="mx-auto mb-10 max-w-xl text-sm text-slate-text md:text-base">
            A quiet, considered home for everything you own and everything you love.
            Sign in to continue curating.
          </p>
          <button
            type="button"
            class="mx-auto inline-flex items-center justify-center rounded-full border border-border-chrome bg-card-dark px-8 py-3 text-sm font-medium transition hover:-translate-y-0.5 hover:border-primary/50 hover:bg-bg-soft"
            (click)="loginWithGoogle()"
          >
            Continue with Google
          </button>
        </section>
        <footer class="flex items-center justify-between border-t border-border-subtle pt-5 text-xs uppercase tracking-[0.2em] text-slate-text">
          <div class="flex items-center gap-6">
            <a routerLink="/tos" class="hover:text-primary transition-colors">Terms</a>
            <a routerLink="/privacy" class="hover:text-primary transition-colors">Privacy</a>
          </div>
          <span class="hidden md:inline">Vol. 04 - Spring</span>
        </footer>
      </main>
    </div>
  `,
})
export class LoginComponent {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  constructor() {
    effect(() => {
      if (this.auth.user()) {
        this.router.navigate(['/']);
      }
    });
  }

  protected loginWithGoogle(): void {
    this.auth.login();
  }
}
