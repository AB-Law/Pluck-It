import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { signal, WritableSignal } from '@angular/core';
import { DashboardComponent } from './dashboard.component';
import { WardrobeService } from '../../core/services/wardrobe.service';
import { UserProfileService } from '../../core/services/user-profile.service';
import { AuthService } from '../../core/services/auth.service';
import { MobileNavState } from '../../shared/layout/mobile-nav.state';

describe('DashboardComponent', () => {
  let component: DashboardComponent;
  let fixture: ComponentFixture<DashboardComponent>;
  let wardrobeService: {
    getAll: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    getDrafts: ReturnType<typeof vi.fn>;
    recordStylingActivity: ReturnType<typeof vi.fn>;
  };
  let authService: { logout: ReturnType<typeof vi.fn>; user: ReturnType<typeof vi.fn> };
  let mobileNavState: MobileNavState;
  let queryParamMap$: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let route: {
    snapshot: { queryParamMap: ReturnType<typeof convertToParamMap> };
    queryParamMap: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  };
  let router: {
    navigate: ReturnType<typeof vi.fn>;
    createUrlTree: ReturnType<typeof vi.fn>;
    serializeUrl: ReturnType<typeof vi.fn>;
    isActive: ReturnType<typeof vi.fn>;
  };
  type DashboardComponentInternals = {
    dragOver: WritableSignal<boolean>;
    onWindowResize: () => void;
    openSettings: () => void;
    closeSettingsPanel: () => void;
    openDigest: () => void;
    settingsOpen: WritableSignal<boolean>;
    digestOpen: WritableSignal<boolean>;
    stylistOpen: WritableSignal<boolean>;
    uploadOfflineNotice: WritableSignal<string | null>;
  };
  const asInternal = (): DashboardComponentInternals => component as unknown as DashboardComponentInternals;

  beforeEach(async () => {
    const initialQueryParams = convertToParamMap({});
    queryParamMap$ = new BehaviorSubject(initialQueryParams);
    route = {
      snapshot: { queryParamMap: initialQueryParams },
      queryParamMap: queryParamMap$,
    };

    authService = {
      logout: vi.fn(),
      user: vi.fn().mockReturnValue({ name: 'Tester' }),
    };
    wardrobeService = {
      getAll: vi.fn().mockReturnValue(of({ items: [], pageInfo: {} })),
      getDrafts: vi.fn().mockReturnValue(of({ items: [] })),
      update: vi.fn().mockReturnValue(of({})),
      delete: vi.fn().mockReturnValue(of({})),
      recordStylingActivity: vi.fn().mockReturnValue(of({})),
    };
    router = {
      navigate: vi.fn(),
      createUrlTree: vi.fn((commands: unknown) => ({
        toString: () => (typeof commands === 'string' ? commands : `/${(commands as unknown[]).join('/')}`),
      })),
      serializeUrl: vi.fn((tree: { toString: () => string }) => tree.toString()),
      isActive: vi.fn(() => false),
    };

    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        { provide: ActivatedRoute, useValue: route },
        { provide: WardrobeService, useValue: wardrobeService },
        { provide: Router, useValue: router },
        { provide: UserProfileService, useValue: { load: vi.fn().mockReturnValue(of({})), profile: signal(null), getOrDefault: vi.fn().mockReturnValue({ currencyCode: 'USD' }) } },
        { provide: AuthService, useValue: authService },
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(DashboardComponent);
    component = fixture.componentInstance;
    mobileNavState = TestBed.inject(MobileNavState);
    fixture.detectChanges();
  });

  afterEach(() => {
    mobileNavState.closePanel();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('toggles item selection and records styling activity for new additions', () => {
    component.toggleItemSelection('item-1');
    expect(component['selectedIds']().includes('item-1')).toBe(true);
    expect(wardrobeService['recordStylingActivity']).toHaveBeenCalledTimes(1);

    component.toggleItemSelection('item-1');
    expect(component['selectedIds']().includes('item-1')).toBe(false);
    expect(wardrobeService['recordStylingActivity']).toHaveBeenCalledTimes(1);
  });

  it('records styling activity on drag over and drop when item is new', () => {
    const dragOver = { preventDefault: vi.fn() } as unknown as DragEvent;
    component.onDragOver(dragOver);
    expect(dragOver.preventDefault).toHaveBeenCalled();
    expect(asInternal().dragOver()).toBe(true);

    component.onDrop({
      preventDefault: vi.fn(),
      dataTransfer: {
        getData: (key: string) => key === 'text/plain' ? 'item-1' : '',
      },
    } as unknown as DragEvent);
    expect(wardrobeService['recordStylingActivity']).toHaveBeenCalledTimes(1);
    expect(asInternal().dragOver()).toBe(false);
  });

  it('does not duplicate selection on drop when item is already selected', () => {
    component.toggleItemSelection('item-1');
    wardrobeService.recordStylingActivity.mockClear();
    component.onDrop({
      preventDefault: vi.fn(),
      dataTransfer: {
        getData: () => 'item-1',
      },
    } as unknown as DragEvent);
    expect(wardrobeService['recordStylingActivity']).toHaveBeenCalledTimes(0);
    expect(component['selectedIds']()).toEqual(['item-1']);
  });

  it('does not add already selected item on drop and handles drag leave', () => {
    component.toggleItemSelection('item-1');
    wardrobeService.recordStylingActivity.mockClear();
    component.onDragLeave();
    expect(asInternal().dragOver()).toBe(false);

    component.onDrop({
      preventDefault: vi.fn(),
      dataTransfer: { getData: () => 'item-1' },
    } as unknown as DragEvent);

    expect(component['selectedIds']()).toEqual(['item-1']);
    expect(wardrobeService['recordStylingActivity']).toHaveBeenCalledTimes(0);
  });

  it('logout emits nav and auth cleanup', () => {
    component.logout();
    expect(authService.logout).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });

  it('routes settings open to shell profile panel on mobile and local panel on desktop', () => {
    Object.defineProperty(globalThis.window, 'innerWidth', { value: 390, configurable: true });
    asInternal().onWindowResize();
    mobileNavState.closePanel();
    asInternal().openSettings();
    expect(mobileNavState.activePanel()).toBe('profile');
    expect(asInternal().settingsOpen()).toBe(false);

    mobileNavState.closePanel();
    Object.defineProperty(globalThis.window, 'innerWidth', { value: 1400, configurable: true });
    asInternal().onWindowResize();
    asInternal().openSettings();
    expect(asInternal().settingsOpen()).toBe(true);
    expect(mobileNavState.activePanel()).toBe('none');
  });

  it('routes digest open to shell digest panel on mobile and local overlay on desktop', () => {
    Object.defineProperty(globalThis.window, 'innerWidth', { value: 390, configurable: true });
    asInternal().onWindowResize();
    mobileNavState.closePanel();
    asInternal().openDigest();
    expect(mobileNavState.activePanel()).toBe('digest');
    expect(asInternal().digestOpen()).toBe(false);

    mobileNavState.closePanel();
    Object.defineProperty(globalThis.window, 'innerWidth', { value: 1200, configurable: true });
    asInternal().onWindowResize();
    asInternal().openDigest();
    expect(asInternal().digestOpen()).toBe(true);
    expect(mobileNavState.activePanel()).toBe('none');
  });

  it('opens stylist when mobilePanel=stylist query param is present', () => {
    queryParamMap$.next(convertToParamMap({ mobilePanel: 'stylist' }));
    fixture.detectChanges();

    expect(asInternal().stylistOpen()).toBe(true);
    expect(router.navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        relativeTo: route,
        queryParams: { mobilePanel: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      }),
    );
  });

  it('closes stylist when mobilePanel=wardrobe query param is present', () => {
    asInternal().stylistOpen.set(true);
    queryParamMap$.next(convertToParamMap({ mobilePanel: 'wardrobe' }));
    fixture.detectChanges();

    expect(asInternal().stylistOpen()).toBe(false);
    expect(router.navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        relativeTo: route,
        queryParams: { mobilePanel: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      }),
    );
  });

  it('closes any stale shell panel and restores main focus target when settings close', async () => {
    Object.defineProperty(globalThis.window, 'innerWidth', { value: 390, configurable: true });
    asInternal().onWindowResize();
    mobileNavState.openDigest();
    fixture.detectChanges();

    const focusTarget = fixture.nativeElement.querySelector('[aria-label="Wardrobe items"]') as HTMLElement | null;
    expect(focusTarget).not.toBeNull();
    const focusSpy = vi.spyOn(focusTarget!, 'focus');

    asInternal().settingsOpen.set(true);
    asInternal().closeSettingsPanel();

    expect(mobileNavState.activePanel()).toBe('none');
    await Promise.resolve();
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
  });
  it('resets stale mobile panel state before opening settings', () => {
    Object.defineProperty(globalThis.window, 'innerWidth', { value: 390, configurable: true });
    asInternal().onWindowResize();
    mobileNavState.openDigest();
    const closeSpy = vi.spyOn(mobileNavState, 'closePanel');

    asInternal().openSettings();

    expect(closeSpy).toHaveBeenCalled();
    expect(mobileNavState.activePanel()).toBe('profile');
  });

  it('queues upload request when offline', () => {
    vi.spyOn(component['networkService'], 'isCurrentlyOnline').mockReturnValue(false);
    const enqueueSpy = vi.spyOn(component['offlineQueue'], 'enqueue');

    component.onUploadRequested();

    expect(enqueueSpy).toHaveBeenCalledWith('dashboard/upload', {});
    expect(asInternal().uploadOfflineNotice()).toContain('queued');
  });
});
