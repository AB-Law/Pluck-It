import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-tos',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="min-h-screen bg-black text-slate-100 font-display flex flex-col">

      <!-- Header -->
      <header class="border-b border-slate-800 bg-slate-950/80 px-8 py-4 flex items-center gap-4">
        <a routerLink="/login" class="flex items-center gap-3 text-white hover:text-primary transition-colors">
          <span class="material-symbols-outlined text-primary" style="font-size:1.75rem; font-variation-settings:'FILL' 1">checkroom</span>
          <span class="text-lg font-bold tracking-tight">Pluck-It</span>
        </a>
        <span class="text-slate-700">/</span>
        <span class="font-mono text-[11px] text-slate-500 uppercase tracking-widest">Terms of Service</span>
      </header>

      <!-- Content -->
      <main class="flex-1 max-w-3xl mx-auto px-8 py-16 w-full">
        <h1 class="text-3xl font-black tracking-tight text-white mb-2">Terms of Service</h1>
        <p class="font-mono text-[11px] text-primary tracking-[0.25em] mb-12 uppercase opacity-80">Last updated: March 2026</p>

        <div class="space-y-10 text-slate-400 leading-relaxed">

          <section>
            <h2 class="text-white font-bold text-lg mb-3">1. Acceptance of Terms</h2>
            <p>By accessing or using Pluck-It ("the Service"), you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use the Service.</p>
          </section>

          <section>
            <h2 class="text-white font-bold text-lg mb-3">2. Description of Service</h2>
            <p>Pluck-It is a digital wardrobe application that allows you to catalogue clothing items and receive AI-powered outfit suggestions. The Service requires a Google account for authentication.</p>
          </section>

          <section>
            <h2 class="text-white font-bold text-lg mb-3">3. User Accounts</h2>
            <p>You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. You agree to notify us immediately of any unauthorized use of your account.</p>
          </section>

          <section>
            <h2 class="text-white font-bold text-lg mb-3">4. User Content</h2>
            <p>You retain ownership of all images and content you upload to the Service. By uploading content, you grant Pluck-It a limited license to store and process that content solely to provide the Service to you. We do not sell your content to third parties.</p>
          </section>

          <section>
            <h2 class="text-white font-bold text-lg mb-3">5. Acceptable Use</h2>
            <p>You agree not to misuse the Service, including attempting to reverse-engineer, disrupt, or gain unauthorized access to any part of the platform.</p>
          </section>

          <section>
            <h2 class="text-white font-bold text-lg mb-3">6. Termination</h2>
            <p>We reserve the right to suspend or terminate your access to the Service at our discretion, with or without notice, if we believe you have violated these Terms.</p>
          </section>

          <section>
            <h2 class="text-white font-bold text-lg mb-3">7. Disclaimer of Warranties</h2>
            <p>The Service is provided "as is" without warranties of any kind. We do not guarantee that the Service will be uninterrupted, error-free, or that AI-generated suggestions will be accurate or suitable for your needs.</p>
          </section>

          <section>
            <h2 class="text-white font-bold text-lg mb-3">8. Changes to Terms</h2>
            <p>We may update these Terms from time to time. Continued use of the Service after changes constitutes acceptance of the updated Terms.</p>
          </section>

          <section>
            <h2 class="text-white font-bold text-lg mb-3">9. Contact</h2>
            <p>Questions about these Terms? Reach out via the feedback option in the application.</p>
          </section>
        </div>
      </main>

      <!-- Footer -->
      <footer class="border-t border-slate-800 px-8 py-6 flex items-center justify-between">
        <a routerLink="/login" class="font-mono text-[10px] text-slate-500 hover:text-primary uppercase tracking-[0.2em] transition-colors">← Back to Login</a>
        <a routerLink="/privacy" class="font-mono text-[10px] text-slate-500 hover:text-primary uppercase tracking-[0.2em] transition-colors">Privacy Policy</a>
      </footer>

    </div>
  `
})
export class TosComponent {}
