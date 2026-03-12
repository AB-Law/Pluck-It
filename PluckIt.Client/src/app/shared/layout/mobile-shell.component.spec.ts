import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MobileShellComponent } from './mobile-shell.component';
import { MobileNavState } from './mobile-nav.state';

describe('MobileShellComponent', () => {
  let fixture: ComponentFixture<MobileShellComponent>;
  let component: MobileShellComponent;
  let mobileState: MobileNavState;
  let body: HTMLElement;
  let root: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MobileShellComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(MobileShellComponent);
    component = fixture.componentInstance;
    mobileState = TestBed.inject(MobileNavState);
    body = document.body;
    root = document.documentElement;

    body.style.overflow = '';
    body.style.touchAction = '';
    body.style.position = '';
    body.style.top = '';
    body.style.left = '';
    body.style.width = '';
    root.style.overflow = '';
    root.style.touchAction = '';
    fixture.detectChanges();
  });

  afterEach(() => {
    mobileState.closePanel();
    fixture.destroy();
    body.style.overflow = '';
    body.style.touchAction = '';
    body.style.position = '';
    body.style.top = '';
    body.style.left = '';
    body.style.width = '';
    root.style.overflow = '';
    root.style.touchAction = '';
  });

  it('locks and restores scrolling when shell-managed profile overlay opens and closes', () => {
    mobileState.openProfile();
    fixture.detectChanges();

    expect(body.style.overflow).toBe('hidden');
    expect(root.style.overflow).toBe('hidden');
    expect(body.style.touchAction).toBe('none');
    expect(root.style.touchAction).toBe('none');
    expect((component as any).mobileState.activePanel()).toBe('profile');

    mobileState.closePanel();
    fixture.detectChanges();

    expect(body.style.overflow).toBe('');
    expect(root.style.overflow).toBe('');
    expect(body.style.touchAction).toBe('');
    expect(root.style.touchAction).toBe('');
  });

  it('restores prior body and root inline styles including scroll position', () => {
    const scrollSpy = vi.spyOn(globalThis.window, 'scrollTo');

    body.style.overflow = 'visible';
    body.style.position = 'relative';
    body.style.top = '12px';
    body.style.left = '4px';
    body.style.width = '95%';
    body.style.touchAction = 'auto';
    root.style.overflow = 'clip';
    root.style.touchAction = 'manipulation';

    mobileState.openDigest();
    fixture.detectChanges();

    expect(body.style.position).toBe('fixed');
    expect(['0px', '-0px']).toContain(body.style.top);
    expect(['0', '0px']).toContain(body.style.left);
    expect(body.style.width).toBe('100%');
    expect(body.style.overflow).toBe('hidden');
    expect(root.style.overflow).toBe('hidden');
    expect(body.style.touchAction).toBe('none');
    expect(root.style.touchAction).toBe('none');

    mobileState.closePanel();
    fixture.detectChanges();

    expect(body.style.overflow).toBe('visible');
    expect(body.style.position).toBe('relative');
    expect(body.style.top).toBe('12px');
    expect(body.style.left).toBe('4px');
    expect(body.style.width).toBe('95%');
    expect(body.style.touchAction).toBe('auto');
    expect(root.style.overflow).toBe('clip');
    expect(root.style.touchAction).toBe('manipulation');
    expect(scrollSpy).toHaveBeenCalledWith(0, 0);
  });

  it('unlocks scrolling on component destroy even if overlay remains open', () => {
    mobileState.openDigest();
    fixture.detectChanges();

    expect(body.style.touchAction).toBe('none');
    expect(root.style.touchAction).toBe('none');

    fixture.destroy();

    expect(body.style.overflow).toBe('');
    expect(root.style.overflow).toBe('');
    expect(body.style.touchAction).toBe('');
    expect(root.style.touchAction).toBe('');
  });
});
