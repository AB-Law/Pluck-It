import { Component, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';
import { WardrobeComponent } from '../closet/closet.component';
import { StylistPanelComponent } from '../stylist/stylist.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [FormsModule, WardrobeComponent, StylistPanelComponent],
  template: `
    <div class="flex flex-col h-screen bg-background-dark text-chrome overflow-hidden font-display">

      <!-- ─── Header ──────────────────────────────────────────────── -->
      <header class="flex items-center justify-between border-b border-border-subtle bg-black px-6 py-4 shrink-0 z-50">
        <div class="flex items-center gap-8">
          <!-- Logo -->
          <div class="flex items-center gap-3 text-white">
            <span class="material-symbols-outlined text-primary" style="font-size:30px">checkroom</span>
            <h2 class="text-white text-xl font-bold tracking-tight">Pluck-It</h2>
          </div>

          <!-- Search -->
          <label class="hidden md:flex flex-col min-w-[280px]">
            <div class="flex w-full items-center rounded-lg bg-card-dark border border-[#333] focus-within:border-primary/60 transition-colors">
              <div class="flex items-center justify-center pl-3 text-slate-text">
                <span class="material-symbols-outlined" style="font-size:20px">search</span>
              </div>
              <input
                class="w-full bg-transparent border-none text-sm text-white placeholder-slate-text outline-none py-2.5 px-3 font-mono"
                placeholder="Search by brand, color, tag…"
                [(ngModel)]="searchQuery"
              />
            </div>
          </label>
        </div>

        <div class="flex items-center gap-3">
          <!-- Upload button -->
          <button
            class="flex items-center gap-2 bg-primary hover:bg-blue-500 transition-colors text-white px-4 py-2 rounded-lg text-sm font-semibold"
            (click)="wardrobeRef.triggerUpload()"
          >
            <span class="material-symbols-outlined" style="font-size:18px">upload_file</span>
            <span class="hidden sm:inline">Upload</span>
          </button>

          <button class="p-2 rounded-lg bg-card-dark text-slate-text hover:text-white hover:bg-[#333] transition-colors">
            <span class="material-symbols-outlined" style="font-size:20px">notifications</span>
          </button>

          <button class="p-2 rounded-lg bg-card-dark text-slate-text hover:text-white hover:bg-[#333] transition-colors">
            <span class="material-symbols-outlined" style="font-size:20px">settings</span>
          </button>

          <!-- Avatar -->
          @if (auth.user(); as user) {
            <div
              class="h-9 w-9 rounded-full bg-primary/30 border-2 border-card-dark flex items-center justify-center text-sm font-bold text-white select-none"
              [title]="user.name"
            >
              {{ user.name.charAt(0).toUpperCase() }}
            </div>
          }
        </div>
      </header>

      <!-- ─── Body ─────────────────────────────────────────────────── -->
      <div class="flex flex-1 min-h-0">

        <!-- Wardrobe main area -->
        <app-wardrobe
          #wardrobeRef
          class="flex-1 min-w-0 overflow-y-auto custom-scrollbar"
          [searchQuery]="searchQuery()"
        />

        <!-- Stylist sidebar — always visible lg+, overlay on mobile -->
        <app-stylist-panel
          class="hidden lg:flex w-96 shrink-0 border-l border-border-subtle"
          [class.!flex]="stylistOpen()"
          [class.fixed]="stylistOpen()"
          [class.inset-y-0]="stylistOpen()"
          [class.right-0]="stylistOpen()"
          [class.z-50]="stylistOpen()"
          [class.w-full]="stylistOpen()"
          [class.sm:w-96]="stylistOpen()"
          (closed)="stylistOpen.set(false)"
        />
      </div>

      <!-- Mobile FAB -->
      <button
        class="lg:hidden fixed bottom-6 right-6 z-40 h-14 w-14 rounded-full bg-primary text-white shadow-lg shadow-primary/30 flex items-center justify-center"
        (click)="stylistOpen.set(!stylistOpen())"
      >
        <span class="material-symbols-outlined">smart_toy</span>
      </button>
    </div>
  `,
})
export class DashboardComponent {
  @ViewChild('wardrobeRef') wardrobeRef!: WardrobeComponent;

  protected readonly stylistOpen = signal(false);
  protected readonly searchQuery = signal('');

  constructor(protected readonly auth: AuthService) {}
}
