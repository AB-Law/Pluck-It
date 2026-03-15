import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  effect,
  signal,
  ViewChild,
  inject,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { UserProfileService } from '../../core/services/user-profile.service';
import { WardrobeService } from '../../core/services/wardrobe.service';
import { NetworkService } from '../../core/services/network.service';
import { OfflineQueueService } from '../../core/services/offline-queue.service';
import { WardrobeComponent } from '../closet/closet.component';
import { StylistPanelComponent } from '../stylist/stylist.component';
import { ProfilePanelComponent } from '../profile/profile-panel.component';
import { DigestPanelComponent } from '../digest/digest-panel.component';
import { AppHeaderComponent } from '../../shared/app-header.component';
import { MobileNavState } from '../../shared/layout/mobile-nav.state';
import { showOfflineBlockMessage } from '../../shared/offline-message';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    WardrobeComponent,
    StylistPanelComponent,
    ProfilePanelComponent,
    DigestPanelComponent,
    AppHeaderComponent,
  ],
  template: `
    <div
      class="flex flex-col h-[100dvh] bg-background-dark text-chrome overflow-hidden pb-16 md:pb-0 font-display"
    >
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
      @if (uploadOfflineNotice()) {
        <div
          class="mx-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300"
        >
          {{ uploadOfflineNotice() }}
        </div>
      }

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
          [class.inset-y-0]="stylistOpen() && !isMobile()"
          [class.right-0]="stylistOpen() && !isMobile()"
          [class.left-0]="stylistOpen() && isMobile()"
          [class.top-0]="stylistOpen() && isMobile()"
          [class.bottom-14]="stylistOpen() && isMobile()"
          [class.z-50]="stylistOpen() && !isMobile()"
          [class.z-30]="stylistOpen() && isMobile()"
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
            <div
              class="absolute inset-0 z-10 flex items-center justify-center bg-primary/10 pointer-events-none"
            >
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
  protected readonly auth = inject(AuthService);
  private readonly profileService = inject(UserProfileService);
  private readonly wardrobeService = inject(WardrobeService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

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
  protected readonly uploadOfflineNotice = signal<string | null>(null);
  protected readonly mobileNavState = inject(MobileNavState);
  private readonly destroyRef = inject(DestroyRef);
  private readonly networkService = inject(NetworkService);
  private readonly offlineQueue = inject(OfflineQueueService);

  constructor() {
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
    this.updateViewportMode();

    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => this.applyMobilePanelCommand(params.get('mobilePanel')));
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
    if (!this.networkService.isCurrentlyOnline()) {
      this.offlineQueue.enqueue('dashboard/upload', {});
      this.uploadOfflineNotice.set(
        showOfflineBlockMessage(
          'Wardrobe upload',
          'This action was queued and will run when you reconnect.',
        ),
      );
      return;
    }
    this.uploadOfflineNotice.set(null);
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

  private applyMobilePanelCommand(panel: string | null): void {
    if (panel === 'stylist') {
      this.openStylist();
      this.clearMobilePanelQuery();
      return;
    }

    if (panel === 'wardrobe') {
      this.stylistOpen.set(false);
      this.clearMobilePanelQuery();
    }
  }

  private clearMobilePanelQuery(): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { mobilePanel: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  toggleItemSelection(id: string): void {
    const currentlySelected = this.selectedIds().includes(id);
    this.selectedIds.update((ids) =>
      currentlySelected ? ids.filter((i) => i !== id) : [...ids, id],
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
    const id =
      event.dataTransfer?.getData('text/plain') ??
      event.dataTransfer?.getData('application/pluckit-item');
    if (id) {
      const exists = this.selectedIds().includes(id);
      this.selectedIds.update((ids) => (ids.includes(id) ? ids : [...ids, id]));
      if (!exists) {
        this.recordStylingActivity(id, 'dashboard_drag_drop');
      }
    }
  }

  private recordStylingActivity(itemId: string, source: string): void {
    const randomUuid = globalThis.crypto?.randomUUID;
    const randomValues =
      globalThis.crypto?.getRandomValues ??
      globalThis.window?.msCrypto?.getRandomValues;
    const rand =
      typeof randomUuid === 'function'
        ? randomUuid()
        : typeof randomValues === 'function'
          ? `${Date.now()}-${Array.from(randomValues(new Uint32Array(1)))[0].toString(16)}`
          : `${Date.now()}-${Math.floor(Math.random() * 0xffffffff).toString(16)}`;
    this.wardrobeService
      .recordStylingActivity({
        itemId,
        source,
        activityType: 'AddedToStyleBoard',
        clientEventId: `sty-${rand}`,
        occurredAt: new Date().toISOString(),
      })
      .subscribe({ error: () => {} });
  }
}
