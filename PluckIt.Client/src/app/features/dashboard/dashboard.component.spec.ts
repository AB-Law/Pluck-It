import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { signal } from '@angular/core';
import { DashboardComponent } from './dashboard.component';
import { WardrobeService } from '../../core/services/wardrobe.service';
import { UserProfileService } from '../../core/services/user-profile.service';
import { AuthService } from '../../core/services/auth.service';

describe('DashboardComponent', () => {
  let component: DashboardComponent;
  let fixture: ComponentFixture<DashboardComponent>;
  let wardrobeService: { [key: string]: ReturnType<typeof vi.fn> };
  let authService: { logout: ReturnType<typeof vi.fn>; user: ReturnType<typeof vi.fn> };
  let router: {
    navigate: ReturnType<typeof vi.fn>;
    createUrlTree: ReturnType<typeof vi.fn>;
    serializeUrl: ReturnType<typeof vi.fn>;
    isActive: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
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
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) }, queryParamMap: of(convertToParamMap({})) } },
        { provide: WardrobeService, useValue: wardrobeService },
        { provide: Router, useValue: router },
        { provide: UserProfileService, useValue: { load: vi.fn().mockReturnValue(of({})), profile: signal(null), getOrDefault: vi.fn().mockReturnValue({ currencyCode: 'USD' }) } },
        { provide: AuthService, useValue: authService },
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(DashboardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
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
    expect((component as any).dragOver()).toBe(true);

    component.onDrop({
      preventDefault: vi.fn(),
      dataTransfer: {
        getData: (key: string) => key === 'text/plain' ? 'item-1' : '',
      },
    } as unknown as DragEvent);
    expect(wardrobeService['recordStylingActivity']).toHaveBeenCalledTimes(1);
    expect((component as any).dragOver()).toBe(false);
  });

  it('does not duplicate selection on drop when item is already selected', () => {
    component.toggleItemSelection('item-1');
    (wardrobeService['recordStylingActivity'] as any).mockClear();
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
    (wardrobeService['recordStylingActivity'] as any).mockClear();
    component.onDragLeave();
    expect((component as any).dragOver()).toBe(false);

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
});
