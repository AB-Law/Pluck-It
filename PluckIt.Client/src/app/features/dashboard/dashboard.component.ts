import { Component, ElementRef, HostListener, OnDestroy, OnInit, effect, signal, ViewChild, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { UserProfileService } from '../../core/services/user-profile.service';
import { WardrobeService } from '../../core/services/wardrobe.service';
import { WardrobeComponent } from '../closet/closet.component';
import { StylistPanelComponent } from '../stylist/stylist.component';
import { ProfilePanelComponent } from '../profile/profile-panel.component';
import { DigestPanelComponent } from '../digest/digest-panel.component';
import { AppHeaderComponent } from '../../shared/app-header.component';
import { MobileNavState } from '../../shared/layout/mobile-nav.state';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [WardrobeComponent, StylistPanelComponent, ProfilePanelComponent, DigestPanelComponent, AppHeaderComponent],
  template: `
    <div class="flex flex-col h-[100dvh] bg-background-dark text-chrome overflow-hidden pb-16 md:pb-0 font-display">

      <app-shared-header
        section="dashboard"
        [showSearch]="true"
        [searchValue]="searchQuery()"
        searchPlaceholder="Search by brand, color, tag…"
        (searchValueChange)="searchQuery.set($event)"
        [showUpload]="true"
        (uploadRequested)="onUploadRequested()"
        [showDigest]="true"
        (digestRequested)="openDigest()"
        (notificationsRequested)="noop()"
        (settingsRequested)="openSettings()"
        [showStylistShortcut]="true"
        (stylistRequested)="openStylist()"
      />

      <!-- ─── Body ─────────────────────────────────────────────────── -->
      <div class="flex flex-1 min-h-0">

        <!-- Wardrobe main area -->
        <main
          #mainScrollArea
          class="flex-1 min-w-0 min-h-0 overflow-y-auto touch-pan-y custom-scrollbar outline-none"
          tabindex="-1"
          aria-label="Wardrobe items"
        >
          <app-wardrobe
            #wardrobeRef
            [searchQuery]="searchQuery()"
            [selectedIds]="selectedIds()"
            (itemToggled)="toggleItemSelection($event)"
          />
        </main>

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

      <!-- Profile / Settings panel -->
      @if (settingsOpen()) {
        <app-profile-panel (closed)="closeSettingsPanel()" />
      }

      <!-- Weekly Digest panel -->
      @if (digestOpen()) {
        <app-digest-panel (closed)="closeDigestPanel()" />
      }
    </div>
  `,
})
export class DashboardComponent implements OnInit, OnDestroy {
  @ViewChild('mainScrollArea')
  private readonly mainScrollArea?: ElementRef<HTMLElement>;
  @ViewChild('wardrobeRef') wardrobeRef!: WardrobeComponent;

  protected readonly stylistOpen = signal(false);
  protected readonly settingsOpen = signal(false);
  protected readonly digestOpen = signal(false);
  protected readonly searchQuery = signal('');
  protected readonly selectedIds = signal<string[]>([]);
  protected readonly dragOver = signal(false);
  protected readonly isMobile = signal(false);
  protected readonly mobileNavState = inject(MobileNavState);

  constructor(
    protected readonly auth: AuthService,
    private readonly profileService: UserProfileService,
    private readonly wardrobeService: WardrobeService,
    private readonly router: Router,
    private readonly route: ActivatedRoute,
  ) {
    effect(() => {
      if (this.mobileNavState.activePanel() === 'none') {
        this.restoreMainFocusTarget();
      }
    });
  }

  ngOnDestroy(): void {
    this.mobileNavState.closePanel();
  }

  logout(): void {
    this.auth.logout();
    this.router.navigate(['/login']);
  }

  ngOnInit(): void {
    // Pre-load the user profile so the review modal currency/size system is available immediately
    this.profileService.load().subscribe();
    const launchPanel = this.route.snapshot.queryParamMap.get('mobilePanel');
    if (launchPanel === 'stylist') {
      this.openStylist();
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { mobilePanel: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }
    this.updateViewportMode();
  }

  @HostListener('window:resize')
  protected onWindowResize(): void {
    this.updateViewportMode();
  }

  private updateViewportMode(): void {
    if (globalThis.window === undefined) {
      return;
    }
    this.isMobile.set(globalThis.window.innerWidth < 768);
  }

  protected noop(): void {}

  onUploadRequested(): void {
    this.wardrobeRef?.triggerUpload();
  }

  protected openDigest(): void {
    this.mobileNavState.closePanel();
    if (this.isMobile()) {
      this.mobileNavState.openDigest();
      return;
    }
    this.digestOpen.set(true);
  }

  protected openSettings(): void {
    this.mobileNavState.closePanel();
    if (this.isMobile()) {
      this.mobileNavState.openProfile();
      return;
    }

    this.settingsOpen.set(true);
  }

  protected closeDigestPanel(): void {
    this.digestOpen.set(false);
    this.mobileNavState.closePanel();
    this.restoreMainFocusTarget();
  }

  protected closeSettingsPanel(): void {
    this.settingsOpen.set(false);
    this.mobileNavState.closePanel();
    this.restoreMainFocusTarget();
  }

  private restoreMainFocusTarget(): void {
    queueMicrotask(() => {
      this.mainScrollArea?.nativeElement?.focus({ preventScroll: true });
    });
  }

  protected openStylist(): void {
    this.stylistOpen.set(true);
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
