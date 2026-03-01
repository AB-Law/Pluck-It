import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-privacy',
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
        <span class="font-mono text-[11px] text-slate-500 uppercase tracking-widest">Privacy Policy</span>
      </header>

      <!-- Content -->
      <main class="flex-1 max-w-3xl mx-auto px-8 py-16 w-full">
        <h1 class="text-3xl font-black tracking-tight text-white mb-2">Privacy Policy</h1>
        <p class="font-mono text-[11px] text-primary tracking-[0.25em] mb-12 uppercase opacity-80">Last updated: March 2026</p>

        <div class="space-y-10 text-slate-400 leading-relaxed">

          <section>
            <h2 class="text-white font-bold text-lg mb-3">1. Information We Collect</h2>
            <p>When you sign in with Google, we receive your name, email address, and a unique Google user ID. We also store the clothing images and metadata you upload to build your digital wardrobe.</p>
          </section>

          <section>
            <h2 class="text-white font-bold text-lg mb-3">2. How We Use Your Information</h2>
            <p>We use your information solely to provide the Pluck-It service — storing your wardrobe, generating outfit suggestions, and identifying your account. We do not sell, rent, or share your personal data with third-party advertisers.</p>
          </section>

          <section>
            <h2 class="text-white font-bold text-lg mb-3">3. AI Processing</h2>
            <p>Images you upload are processed by our AI pipeline to extract clothing attributes (colour, category, style). This processing occurs within our Azure infrastructure. Images may be temporarily held in memory during processing and are stored in your private cloud storage container.</p>
          </section>

          <section>
            <h2 class="text-white font-bold text-lg mb-3">4. Data Storage</h2>
            <p>Your data is stored in Microsoft Azure (EU/US regions). We use industry-standard encryption at rest and in transit. Each user's data is isolated in per-user storage containers.</p>
          </section>

          <section>
            <h2 class="text-white font-bold text-lg mb-3">5. Data Retention</h2>
            <p>Your account data and uploaded images are retained as long as your account is active. You may request deletion of your account and all associated data at any time via the profile settings in the application.</p>
          </section>

          <section>
            <h2 class="text-white font-bold text-lg mb-3">6. Cookies &amp; Local Storage</h2>
            <p>We use browser local storage to persist your authentication session between visits. We do not use tracking cookies or third-party analytics cookies.</p>
          </section>

          <section>
            <h2 class="text-white font-bold text-lg mb-3">7. Third-Party Services</h2>
            <p>We use Google Identity Services for authentication. Google's own privacy policy governs the data Google collects during the sign-in flow. Our AI features are powered by Azure OpenAI, and processed data is not used to train public models.</p>
          </section>

          <section>
            <h2 class="text-white font-bold text-lg mb-3">8. Your Rights</h2>
            <p>You have the right to access, correct, or delete your personal data. To exercise these rights, use the account settings within the application or contact us directly.</p>
          </section>

          <section>
            <h2 class="text-white font-bold text-lg mb-3">9. Changes to This Policy</h2>
            <p>We may update this Privacy Policy periodically. We will notify you of significant changes by updating the "Last updated" date above. Continued use of the Service constitutes acceptance of the updated policy.</p>
          </section>

        </div>
      </main>

      <!-- Footer -->
      <footer class="border-t border-slate-800 px-8 py-6 flex items-center justify-between">
        <a routerLink="/login" class="font-mono text-[10px] text-slate-500 hover:text-primary uppercase tracking-[0.2em] transition-colors">← Back to Login</a>
        <a routerLink="/tos" class="font-mono text-[10px] text-slate-500 hover:text-primary uppercase tracking-[0.2em] transition-colors">Terms of Service</a>
      </footer>

    </div>
  `
})
export class PrivacyComponent {}
