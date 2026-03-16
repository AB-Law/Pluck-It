import { Component, inject, effect } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [RouterLink],
  template: `
    <!-- Full-screen wrapper -->
    <div class="relative min-h-screen flex flex-col items-center justify-center overflow-hidden bg-black font-display text-slate-100">

      <!-- ── Animated background ──────────────────────────────── -->
      <div class="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <div class="absolute inset-0 flicker-overlay z-10"></div>
        <div class="grid grid-cols-4 gap-12 p-24 opacity-20 animate-flicker">
          <div class="h-80 flex items-center justify-center rotate-12 transition-transform duration-1000">
            <span class="text-9xl text-slate-400/30">◉</span>
          </div>
          <div class="h-80 flex items-center justify-center -rotate-12 translate-y-32">
            <span class="text-9xl text-slate-400/30">◈</span>
          </div>
          <div class="h-80 flex items-center justify-center rotate-45 translate-x-10">
            <span class="text-9xl text-slate-400/30">✦</span>
          </div>
          <div class="h-80 flex items-center justify-center -rotate-6 translate-y-16">
            <span class="text-9xl text-slate-400/30">⬟</span>
          </div>
          <div class="h-80 flex items-center justify-center -rotate-45 -translate-y-20">
            <span class="text-9xl text-slate-400/30">✶</span>
          </div>
          <div class="h-80 flex items-center justify-center rotate-12 translate-y-40">
            <span class="text-9xl text-slate-400/30">◊</span>
          </div>
          <div class="h-80 flex items-center justify-center -rotate-12">
            <span class="text-9xl text-slate-400/30">◉</span>
          </div>
          <div class="h-80 flex items-center justify-center rotate-6 translate-y-10">
            <span class="text-9xl text-slate-400/30">◈</span>
          </div>
        </div>
      </div>

      <!-- ── Terminal window ──────────────────────────────────── -->
      <main class="relative z-20 w-[90%] h-[85vh] flex flex-col">
        <div class="flex-1 terminal-glow bg-slate-950/80 backdrop-blur-2xl border border-slate-800/60 rounded-xl overflow-hidden flex flex-col">

          <!-- Title bar -->
          <div class="h-10 bg-slate-900/80 border-b border-slate-800 flex items-center px-6 gap-2 shrink-0">
            <div class="flex gap-2">
              <div class="size-3 rounded-full bg-red-500/50"></div>
              <div class="size-3 rounded-full bg-amber-500/50"></div>
              <div class="size-3 rounded-full bg-emerald-500/50"></div>
            </div>
            <div class="ml-6 flex items-center gap-3">
              <span class="text-slate-500 text-sm">▦</span>
              <span class="text-[10px] font-mono text-slate-500 uppercase tracking-widest">PLUCK_IT_SECURE_AUTH_ENVIRONMENT_v4.2</span>
            </div>
            <div class="ml-auto">
              <span class="text-[10px] font-mono text-slate-600">ID: ARCHIVE_ALPHA_09</span>
            </div>
          </div>

          <!-- Body -->
          <div class="flex-1 p-12 flex flex-col items-center justify-center relative overflow-y-auto">
            <div class="w-full max-w-2xl flex flex-col items-center">

              <!-- Logo -->
              <div class="flex items-center gap-4 mb-3">
                <span class="text-primary" style="font-size:3rem">◉</span>
                <h1 class="text-4xl font-black tracking-tighter text-white">Pluck-It</h1>
              </div>

              <h2 class="font-mono text-[11px] text-primary tracking-[0.3em] mb-12 opacity-80 uppercase">
                Authenticate to Access Your Archive
              </h2>

              <!-- Boot log -->
              <div class="w-full bg-black/40 border border-slate-800/80 rounded-lg p-6 mb-10 text-left font-mono text-sm text-slate-400 space-y-2">
                <p class="log-line flex items-start" style="animation-delay: 0.3s">
                  <span class="text-primary/60 mr-3 shrink-0">[BOOT]</span>
                  <span>Initializing Pluck-It OS core modules...
                    <span class="log-word text-emerald-500" style="animation-delay: 0.9s">DONE</span>
                  </span>
                </p>
                <p class="log-line flex items-start" style="animation-delay: 1.3s">
                  <span class="text-primary/60 mr-3 shrink-0">[VISION]</span>
                  <span>Loading AI Vision v4.0.12 (Wardrobe Perception Engine)...
                    <span class="log-word text-emerald-500" style="animation-delay: 1.9s">READY</span>
                  </span>
                </p>
                <p class="log-line flex items-start" style="animation-delay: 2.4s">
                  <span class="text-primary/60 mr-3 shrink-0">[AUTH]</span>
                  <span class="text-white">Awaiting user credential handshake...</span>
                  <span class="log-line w-2.5 h-5 bg-primary ml-2 inline-block animate-pulse" style="animation-delay: 2.4s"></span>
                </p>
              </div>

              <!-- GIS Sign-in button -->
              <div class="log-line w-full max-w-sm flex justify-center" style="animation-delay: 3.1s">
                <button
                  type="button"
                  class="w-full inline-flex items-center justify-center gap-3 rounded-md border border-slate-800 bg-slate-900/80 px-6 py-4 text-sm font-mono tracking-[0.2em] uppercase text-white transition hover:bg-primary hover:text-black hover:border-primary/80"
                  (click)="loginWithGoogle()"
                >
                  Continue with Google
                </button>
              </div>

              <p class="log-line mt-12 text-slate-600 text-[10px] font-mono tracking-widest uppercase" style="animation-delay: 3.1s">
                Protocol: AES-256-GCM Hardware-Accelerated
              </p>
            </div>
          </div>

          <!-- Footer -->
          <div class="h-16 border-t border-slate-800/80 bg-black/20 px-8 flex items-center justify-between shrink-0">
            <div class="flex items-center gap-8">
              <a routerLink="/tos"     class="font-mono text-[10px] text-slate-500 hover:text-primary uppercase tracking-[0.2em] transition-colors">Terms of Service</a>
              <a routerLink="/privacy" class="font-mono text-[10px] text-slate-500 hover:text-primary uppercase tracking-[0.2em] transition-colors">Privacy</a>
            </div>
            <div class="flex items-center gap-6">
              <div class="font-mono text-[9px] text-slate-600 tracking-widest hidden sm:block">
                LATENCY: 14ms | UPLINK: STABLE
              </div>
              <div class="flex items-center gap-3 bg-slate-900/60 px-5 py-2 rounded border border-slate-800">
                <span class="flex size-2 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)] animate-pulse"></span>
                <span class="font-mono text-[10px] text-emerald-500 uppercase font-bold tracking-[0.2em]">System Status: Online</span>
              </div>
            </div>
          </div>

        </div>
      </main>

      <!-- Scanline overlay -->
      <div class="scanline-bar"></div>
    </div>
  `,
  styles: [`
    @keyframes flicker {
      0%, 19.999%, 22%, 62.999%, 64%, 64.999%, 70%, 100% { opacity: 0.1; }
      20%, 21.999%, 63%, 63.999%, 65%, 69.999% { opacity: 0.04; }
    }
    .animate-flicker { animation: flicker 4s infinite; }

    .terminal-glow { box-shadow: 0 0 60px -15px rgba(37, 141, 244, 0.25); }

    .flicker-overlay {
      background-image: radial-gradient(circle at center, transparent 0%, rgba(0,0,0,0.9) 100%);
    }

    .scanline-bar {
      width: 100%;
      height: 2px;
      background: rgba(37, 141, 244, 0.03);
      position: fixed;
      bottom: 0;
      left: 0;
      pointer-events: none;
      z-index: 50;
    }

    @keyframes terminalReveal {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .log-line {
      opacity: 0;
      animation: terminalReveal 0.4s ease-out forwards;
    }

    @keyframes wordReveal {
      from { opacity: 0; }
      to   { opacity: 1; }
    }

    .log-word {
      opacity: 0;
      animation: wordReveal 0.3s ease-out forwards;
    }
  `]
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
    void this.auth.login();
  }
}
