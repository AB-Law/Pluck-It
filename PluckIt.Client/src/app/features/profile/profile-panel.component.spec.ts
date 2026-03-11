import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProfilePanelComponent } from './profile-panel.component';
import { UserProfileService } from '../../core/services/user-profile.service';
import { of, throwError } from 'rxjs';
import { signal } from '@angular/core';
import { UserProfile } from '../../core/services/user-profile.service';

describe('ProfilePanelComponent', () => {
  let component: ProfilePanelComponent;
  let fixture: ComponentFixture<ProfilePanelComponent>;
  let profileService: {
    load: ReturnType<typeof vi.fn>;
    profile: ReturnType<typeof signal>;
    update: ReturnType<typeof vi.fn>;
  };
  const PROFILE: UserProfile = {
    id: 'u-1',
    currencyCode: 'USD',
    preferredSizeSystem: 'US',
    stylePreferences: ['minimalist'],
    favoriteBrands: ['Nike', 'COS'],
    preferredColours: ['black', 'beige'],
    recommendationOptIn: true,
    locationCity: 'London',
  };

  beforeEach(async () => {
    profileService = {
      load: vi.fn().mockReturnValue(of(PROFILE)),
      profile: signal(USER_PROFILE_DEFAULT),
      update: vi.fn().mockReturnValue(of({})),
    };
    await TestBed.configureTestingModule({
      imports: [ProfilePanelComponent],
      providers: [
        { provide: UserProfileService, useValue: profileService },
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(ProfilePanelComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('starts from existing profile and allows style and list parsing', () => {
    profileService.profile.set(PROFILE);
    component.ngOnInit();

    component.toggleStyle('y2k');
    expect(component.draft.stylePreferences).toContain('y2k');

    component.toggleStyle('minimalist');
    expect(component.draft.stylePreferences).not.toContain('minimalist');

    const brandsEvent = new Event('blur');
    Object.defineProperty(brandsEvent, 'target', { value: { value: 'A,B,  ' } });
    component.parseBrands(brandsEvent);
    expect(component.draft.favoriteBrands).toEqual(['A', 'B']);

    const coloursEvent = new Event('blur');
    Object.defineProperty(coloursEvent, 'target', { value: { value: 'red, blue' } });
    component.parseColours(coloursEvent);
    expect(component.draft.preferredColours).toEqual(['red', 'blue']);
  });

  it('saves profile and surfaces save errors', () => {
    const closedSpy = vi.fn();
    component.closed.subscribe(() => {
      closedSpy();
    });
    component.save();
    expect(profileService.update).toHaveBeenCalledWith(component.draft);
    expect(component.saving()).toBe(false);
    expect(closedSpy).toHaveBeenCalledTimes(1);

    profileService.update.mockReturnValueOnce(throwError(() => ({ error: { error: 'bad' } })));
    component.save();
    expect(component.saveError()).toBe('bad');
    expect(profileService.update).toHaveBeenCalledTimes(2);
  });

  it('loads profile from network when signal is empty on init', () => {
    profileService.profile.set(null);
    profileService.update.mockReturnValue(of({}));
    component.ngOnInit();
    expect(profileService.load).toHaveBeenCalled();
  });

  it('computes button chip and style classes', () => {
    expect(component.styleChipClass('minimalist')).toContain('bg-transparent');
    expect(component.sysClass('US', false)).toContain('bg-white');
  });
});

const USER_PROFILE_DEFAULT = {
  currencyCode: 'USD',
  preferredSizeSystem: 'US',
  stylePreferences: [],
  favoriteBrands: [],
  preferredColours: [],
};
