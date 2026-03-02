import { Component, OnInit, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { UserProfileService } from '../../core/services/user-profile.service';
import { WardrobeComponent } from '../closet/closet.component';
import { StylistPanelComponent } from '../stylist/stylist.component';
import { ProfilePanelComponent } from '../profile/profile-panel.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [FormsModule, RouterLink, WardrobeComponent, StylistPanelComponent, ProfilePanelComponent],
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

          <!-- Vault icon -->
          <a routerLink="/vault"
             class="p-2 rounded-lg bg-card-dark text-slate-text hover:text-white hover:bg-[#333] transition-colors"
             title="Digital Vault">
            <span class="material-symbols-outlined" style="font-size:20px">inventory_2</span>
          </a>

          <!-- Collections icon -->
          <a routerLink="/collections"
             class="p-2 rounded-lg bg-card-dark text-slate-text hover:text-white hover:bg-[#333] transition-colors"
             title="My Collections">
            <span class="material-symbols-outlined" style="font-size:20px">folder_special</span>
          </a>

          <button class="p-2 rounded-lg bg-card-dark text-slate-text hover:text-white hover:bg-[#333] transition-colors">
            <span class="material-symbols-outlined" style="font-size:20px">notifications</span>
          </button>

          <button class="p-2 rounded-lg bg-card-dark text-slate-text hover:text-white hover:bg-[#333] transition-colors"
                  (click)="settingsOpen.set(true)" aria-label="Settings">
            <span class="material-symbols-outlined" style="font-size:20px">settings</span>
          </button>

          <!-- Avatar dropdown -->
          @if (auth.user(); as user) {
            <div class="relative">
              <button
                class="h-9 w-9 rounded-full bg-primary/30 border-2 border-card-dark flex items-center justify-center text-sm font-bold text-white select-none hover:border-primary transition-colors"
                [title]="user.name"
                (click)="avatarMenuOpen.set(!avatarMenuOpen())"
              >
                {{ user.name.charAt(0).toUpperCase() }}
              </button>

              @if (avatarMenuOpen()) {
                <!-- Backdrop to close on outside click -->
                <div class="fixed inset-0 z-40" (click)="avatarMenuOpen.set(false)"></div>

                <!-- Menu -->
                <div class="absolute right-0 top-11 z-50 w-52 rounded-xl bg-[#111] border border-[#1F1F1F] shadow-2xl overflow-hidden">
                  <div class="px-4 py-3 border-b border-[#1F1F1F]">
                    <p class="text-white text-sm font-semibold truncate">{{ user.name }}</p>
                    <p class="text-slate-500 text-xs font-mono truncate">{{ user.email }}</p>
                  </div>
                  <button
                    class="w-full flex items-center gap-3 px-4 py-3 text-sm text-slate-300 hover:text-red-400 hover:bg-[#1a1a1a] transition-colors"
                    (click)="logout()"
                  >
                    <span class="material-symbols-outlined" style="font-size:18px">logout</span>
                    Sign out
                  </button>
                </div>
              }
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
          [selectedIds]="selectedIds()"
          (itemToggled)="toggleItemSelection($event)"
        />

        <!-- Stylist sidebar — always visible lg+, overlay on mobile -->
        <div
          class="hidden lg:flex w-96 shrink-0 border-l border-border-subtle flex-col relative"
          [class.!flex]="stylistOpen()"
          [class.fixed]="stylistOpen()"
          [class.inset-y-0]="stylistOpen()"
          [class.right-0]="stylistOpen()"
          [class.z-50]="stylistOpen()"
          [class.w-full]="stylistOpen()"
          [class.sm:w-96]="stylistOpen()"
          [class.ring-2]="dragOver()"
          [class.ring-primary]="dragOver()"
          [class.ring-inset]="dragOver()"
          (dragover)="onDragOver($event)"
          (dragleave)="onDragLeave()"
          (drop)="onDrop($event)"
        >
          @if (dragOver()) {
            <div class="absolute inset-0 z-10 flex items-center justify-center bg-primary/10 pointer-events-none">
              <div class="flex flex-col items-center gap-2 text-primary">
                <span class="material-symbols-outlined" style="font-size:40px">style</span>
                <span class="text-xs font-mono font-bold tracking-wider">DROP TO STYLE</span>
              </div>
            </div>
          }
          <app-stylist-panel
            class="flex flex-col h-full"
            [selectedItemIds]="selectedIds"
            (closed)="stylistOpen.set(false)"
            (clearSelected)="selectedIds.set([])"
          />
        </div>
      </div>

      <!-- Mobile FAB -->
      <button
        class="lg:hidden fixed bottom-6 right-6 z-40 h-14 w-14 rounded-full bg-primary text-white shadow-lg shadow-primary/30 flex items-center justify-center"
        (click)="stylistOpen.set(!stylistOpen())"
      >
        <span class="material-symbols-outlined">smart_toy</span>
      </button>

      <!-- Profile / Settings panel -->
      @if (settingsOpen()) {
        <app-profile-panel (closed)="settingsOpen.set(false)" />
      }
    </div>
  `,
})
export class DashboardComponent implements OnInit {
  @ViewChild('wardrobeRef') wardrobeRef!: WardrobeComponent;

  protected readonly stylistOpen  = signal(false);
  protected readonly settingsOpen = signal(false);
  protected readonly avatarMenuOpen = signal(false);
  protected readonly searchQuery  = signal('');
  protected readonly selectedIds  = signal<string[]>([]);
  protected readonly dragOver     = signal(false);

  constructor(
    protected readonly auth: AuthService,
    private readonly profileService: UserProfileService,
    private readonly router: Router,
  ) {}

  logout(): void {
    this.avatarMenuOpen.set(false);
    this.auth.logout();
    this.router.navigate(['/login']);
  }

  ngOnInit(): void {
    // Pre-load the user profile so the review modal currency/size system is available immediately
    this.profileService.load().subscribe();
  }

  toggleItemSelection(id: string): void {
    this.selectedIds.update(ids =>
      ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id]
    );
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(true);
  }

  onDragLeave(): void {
    this.dragOver.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(false);
    const id = event.dataTransfer?.getData('text/plain')
            ?? event.dataTransfer?.getData('application/pluckit-item');
    if (id) {
      this.selectedIds.update(ids => ids.includes(id) ? ids : [...ids, id]);
    }
  }
}
