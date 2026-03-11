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

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) }, queryParamMap: of(convertToParamMap({})) } },
        { provide: WardrobeService, useValue: { 
          getAll: vi.fn().mockReturnValue(of({ items: [], pageInfo: {} })), 
          getDrafts: vi.fn().mockReturnValue(of({ items: [] })),
          update: vi.fn().mockReturnValue(of({})),
          delete: vi.fn().mockReturnValue(of({}))
        } },
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: UserProfileService, useValue: { load: vi.fn().mockReturnValue(of({})), profile: signal(null), getOrDefault: vi.fn().mockReturnValue({ currencyCode: 'USD' }) } },
        { provide: AuthService, useValue: { user: signal(null), logout: vi.fn() } },
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(DashboardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // Add more MCP-based tests as needed
});
