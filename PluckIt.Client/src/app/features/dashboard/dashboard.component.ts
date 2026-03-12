import { Component, OnInit, signal, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { UserProfileService } from '../../core/services/user-profile.service';
import { WardrobeService } from '../../core/services/wardrobe.service';
import { WardrobeComponent } from '../closet/closet.component';
import { StylistPanelComponent } from '../stylist/stylist.component';
import { ProfilePanelComponent } from '../profile/profile-panel.component';
import { DigestPanelComponent } from '../digest/digest-panel.component';
import { AppHeaderComponent } from '../../shared/app-header.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [WardrobeComponent, StylistPanelComponent, ProfilePanelComponent, DigestPanelComponent, AppHeaderComponent],
  template: `
    <div class="flex flex-col h-screen bg-background-dark text-chrome overflow-hidden font-display">

      <app-shared-header
        section="dashboard"
        [showSearch]="true"
        [searchValue]="searchQuery()"
        searchPlaceholder="Search by brand, color, tag…"
        (searchValueChange)="searchQuery.set($event)"
        [showUpload]="true"
        (uploadRequested)="onUploadRequested()"
        [showDigest]="true"
        (digestRequested)="digestOpen.set(true)"
        (notificationsRequested)="noop()"
        (settingsRequested)="settingsOpen.set(true)"
      />

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

      <!-- Weekly Digest panel -->
      @if (digestOpen()) {
        <app-digest-panel (closed)="digestOpen.set(false)" />
      }
    </div>
  `,
})
export class DashboardComponent implements OnInit {
  @ViewChild('wardrobeRef') wardrobeRef!: WardrobeComponent;

  protected readonly stylistOpen = signal(false);
  protected readonly settingsOpen = signal(false);
  protected readonly digestOpen = signal(false);
  protected readonly searchQuery = signal('');
  protected readonly selectedIds = signal<string[]>([]);
  protected readonly dragOver = signal(false);

  constructor(
    protected readonly auth: AuthService,
    private readonly profileService: UserProfileService,
    private readonly wardrobeService: WardrobeService,
    private readonly router: Router,
  ) { }

  logout(): void {
    this.auth.logout();
    this.router.navigate(['/login']);
  }

  ngOnInit(): void {
    // Pre-load the user profile so the review modal currency/size system is available immediately
    this.profileService.load().subscribe();
  }

  protected noop(): void {}

  onUploadRequested(): void {
    this.wardrobeRef?.triggerUpload();
  }

  toggleItemSelection(id: string): void {
    const currentlySelected = this.selectedIds().includes(id);
    this.selectedIds.update(ids =>
      currentlySelected ? ids.filter(i => i !== id) : [...ids, id]
    );
    if (!currentlySelected) {
      this.recordStylingActivity(id, 'dashboard_toggle');
    }
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
      const exists = this.selectedIds().includes(id);
      this.selectedIds.update(ids => ids.includes(id) ? ids : [...ids, id]);
      if (!exists) {
        this.recordStylingActivity(id, 'dashboard_drag_drop');
      }
    }
  }

  private recordStylingActivity(itemId: string, source: string): void {
    const rand = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Array.from(crypto.getRandomValues(new Uint32Array(1)))[0].toString(16)}`;
    this.wardrobeService.recordStylingActivity({
      itemId,
      source,
      activityType: 'AddedToStyleBoard',
      clientEventId: `sty-${rand}`,
      occurredAt: new Date().toISOString(),
    }).subscribe({ error: () => { } });
  }
}
