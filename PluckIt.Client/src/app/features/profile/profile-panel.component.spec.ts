import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProfilePanelComponent } from './profile-panel.component';
import { UserProfileService } from '../../core/services/user-profile.service';
import { of } from 'rxjs';
import { signal } from '@angular/core';

describe('ProfilePanelComponent', () => {
  let component: ProfilePanelComponent;
  let fixture: ComponentFixture<ProfilePanelComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProfilePanelComponent],
      providers: [
        { provide: UserProfileService, useValue: {
          load: vi.fn().mockReturnValue(of({ currencyCode: 'USD', preferredSizeSystem: 'US', stylePreferences: [], favoriteBrands: [], preferredColours: [] })),
          profile: signal(null),
          update: vi.fn().mockReturnValue(of({})),
        }}
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(ProfilePanelComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // Add more MCP-based tests as needed
});
