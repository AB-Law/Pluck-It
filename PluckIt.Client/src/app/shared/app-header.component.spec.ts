import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { AppHeaderComponent } from './app-header.component';

describe('AppHeaderComponent', () => {
  let fixture: ComponentFixture<AppHeaderComponent>;
  let component: AppHeaderComponent;
  let router: {
    navigate: ReturnType<typeof vi.fn>;
    createUrlTree: ReturnType<typeof vi.fn>;
    serializeUrl: ReturnType<typeof vi.fn>;
    isActive: ReturnType<typeof vi.fn>;
  };
  const route = {
    snapshot: { queryParamMap: convertToParamMap({}) },
    queryParamMap: of(convertToParamMap({})),
  };

  beforeEach(async () => {
    const serializeCommands = (commands: unknown): string => {
      if (typeof commands === 'string') {
        return commands;
      }
      if (Array.isArray(commands)) {
        return `/${commands.map((command) => String(command).replace(/^\//, '')).join('/')}`;
      }
      if (commands === null || commands === undefined) {
        return '/';
      }
      if (typeof commands === 'object') {
        return `/${JSON.stringify(commands)}`;
      }
      if (typeof commands === 'number' || typeof commands === 'bigint' || typeof commands === 'boolean') {
        return `/${commands}`;
      }
      if (typeof commands === 'symbol') {
        return `/${commands.description ?? commands.toString()}`;
      }
      if (typeof commands === 'function') {
        return `/[function ${commands.name || 'anonymous'}]`;
      }
      return '/';
    };

    router = {
      navigate: vi.fn(),
      createUrlTree: vi.fn((commands: unknown) => ({
        toString: () => serializeCommands(commands),
      })),
      serializeUrl: vi.fn((tree: { toString: () => string }) => tree.toString()),
      isActive: vi.fn(() => false),
    };

    await TestBed.configureTestingModule({
      imports: [AppHeaderComponent],
      providers: [
        { provide: Router, useValue: router },
        { provide: ActivatedRoute, useValue: route },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AppHeaderComponent);
    component = fixture.componentInstance;
  });

  it('renders core nav links and active state', () => {
    fixture.componentRef.setInput('section', 'vault');
    fixture.componentRef.setInput('showSearch', false);
    fixture.detectChanges();

    const links = fixture.nativeElement.querySelectorAll('a') as NodeListOf<HTMLAnchorElement>;
    const routes = Array.from(links, link => link.getAttribute('href') ?? '');
    expect(routes).toContain('/vault');
    expect(routes).toContain('/collections');
    expect(routes).toContain('/discover');

    const activeVault = fixture.nativeElement.querySelector('a[title="Digital Vault"]') as HTMLAnchorElement;
    expect(activeVault?.className).toContain('bg-primary/10');
  });

  it('emits searchValueChange from the shared search input', () => {
    const handler = vi.fn();
    component.searchValueChange.subscribe(handler);

    fixture.componentRef.setInput('section', 'discover');
    fixture.componentRef.setInput('showSearch', true);
    fixture.componentRef.setInput('searchPlaceholder', 'Search styles, tags…');
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('input[placeholder="Search styles, tags…"]') as HTMLInputElement;
    input.value = 'linen';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(handler).toHaveBeenCalledWith('linen');
  });

  it('emits action outputs for settings and notifications', () => {
    const notificationsSpy = vi.fn();
    const settingsSpy = vi.fn();
    const uploadSpy = vi.fn();
    const uploadLegacySpy = vi.fn();
    component.notificationsRequested.subscribe(notificationsSpy);
    component.settingsRequested.subscribe(settingsSpy);
    component.uploadRequested.subscribe(uploadSpy);
    component.uploadrequest.subscribe(uploadLegacySpy);

    fixture.componentRef.setInput('section', 'dashboard');
    fixture.componentRef.setInput('showUpload', true);
    fixture.componentRef.setInput('showDigest', true);
    fixture.componentRef.setInput('showSearch', false);
    fixture.detectChanges();

    const uploadButton = fixture.nativeElement.querySelector('button[aria-label="Upload item"]') as HTMLButtonElement;
    const notificationsButton = fixture.nativeElement.querySelector(
      'button[aria-label="Open notifications"]',
    ) as HTMLButtonElement;
    const settingsButton = fixture.nativeElement.querySelector(
      'button[aria-label="Open settings"]',
    ) as HTMLButtonElement;

    uploadButton?.click();
    notificationsButton?.click();
    settingsButton?.click();

    expect(uploadSpy).toHaveBeenCalledTimes(1);
    expect(uploadLegacySpy).toHaveBeenCalledTimes(1);
    expect(notificationsSpy).toHaveBeenCalledTimes(1);
    expect(settingsSpy).toHaveBeenCalledTimes(1);
  });

  it('provides accessible titles and labels for icon actions', () => {
    fixture.detectChanges();
    const actions = Array.from(
      fixture.nativeElement.querySelectorAll('a[title], button[title], button[aria-label]') as NodeListOf<HTMLElement>,
    );
    expect(actions.length).toBeGreaterThan(0);
    for (const el of actions) {
      expect(el.getAttribute('title') ?? el.getAttribute('aria-label')).toBeTruthy();
    }
  });
});
