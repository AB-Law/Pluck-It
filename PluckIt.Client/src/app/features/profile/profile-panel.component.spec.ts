import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProfilePanelComponent } from './profile-panel.component';
import { UserProfileService } from '../../core/services/user-profile.service';
import { of, throwError } from 'rxjs';
import { signal } from '@angular/core';
import { UserProfile } from '../../core/services/user-profile.service';
import { By } from '@angular/platform-browser';

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

  it('handles overlay and footer close interactions', () => {
    const closedSpy = vi.fn();
    component.closed.subscribe(() => closedSpy());

    const backdrop = fixture.debugElement.query(By.css('div[style*="background"]'));
    backdrop.triggerEventHandler('click');
    expect(closedSpy).toHaveBeenCalledTimes(1);

    const closeButton = fixture.debugElement.query(By.css('button[aria-label="Close"]'));
    closeButton.triggerEventHandler('click');
    expect(closedSpy).toHaveBeenCalledTimes(2);

    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLElement>) as HTMLButtonElement[];
    const cancel = buttons.find(
      button => button.textContent?.trim() === 'Cancel',
    );
    cancel?.click();
    expect(closedSpy).toHaveBeenCalledTimes(3);

    const aside = fixture.debugElement.query(By.css('aside'));
    const stopSpy = vi.fn();
    aside.triggerEventHandler('click', { stopPropagation: stopSpy });
    expect(stopSpy).toHaveBeenCalledTimes(1);
  });

  it('updates draft fields via template bindings and parse handlers', () => {
    const currency = fixture.debugElement.query(By.css('select'));
    currency.triggerEventHandler('ngModelChange', 'EUR');
    fixture.detectChanges();
    expect(component.draft.currencyCode).toBe('EUR');

    const buttons = fixture.nativeElement.querySelectorAll('section button');
    (Array.from(buttons) as HTMLButtonElement[]).find(btn => btn.textContent?.trim() === 'EU')?.click();
    expect(component.draft.preferredSizeSystem).toBe('EU');

    (Array.from(buttons) as HTMLButtonElement[]).find(btn => btn.textContent?.trim() === 'minimalist')?.click();
    expect(component.draft.stylePreferences).toContain('minimalist');
    (Array.from(buttons) as HTMLButtonElement[]).find(btn => btn.textContent?.trim() === 'minimalist')?.click();
    expect(component.draft.stylePreferences).not.toContain('minimalist');

    const numberInputs = fixture.debugElement.queryAll(By.css('input[type="number"]'));
    numberInputs[0].triggerEventHandler('ngModelChange', 180);
    numberInputs[1].triggerEventHandler('ngModelChange', 72);
    numberInputs[2].triggerEventHandler('ngModelChange', 96);
    numberInputs[3].triggerEventHandler('ngModelChange', 82);
    numberInputs[4].triggerEventHandler('ngModelChange', 101);
    numberInputs[5].triggerEventHandler('ngModelChange', 78);
    expect(component.draft.waistCm).toBe(82);

    const brandsInput = fixture.debugElement.query(By.css('input[placeholder="e.g. Nike, COS, Zara"]'));
    brandsInput.triggerEventHandler('blur', { target: { value: 'Nike, COS,  ' } });
    expect(component.draft.favoriteBrands).toEqual(['Nike', 'COS']);

    const coloursInput = fixture.debugElement.query(By.css('input[placeholder="e.g. black, earth tones, pastels"]'));
    coloursInput.triggerEventHandler('blur', { target: { value: 'black, white,  ' } });
    expect(component.draft.preferredColours).toEqual(['black', 'white']);

    const cityInput = fixture.debugElement.query(By.css('input[placeholder="e.g. London"]'));
    cityInput.triggerEventHandler('ngModelChange', 'Paris');
    expect(component.draft.locationCity).toBe('Paris');

    const recommendationToggle = fixture.debugElement.query(By.css('button[role="switch"]'));
    recommendationToggle.triggerEventHandler('click');
    expect(component.draft.recommendationOptIn).toBe(false);
    recommendationToggle.triggerEventHandler('click');
    expect(component.draft.recommendationOptIn).toBe(true);
  });

  it('invokes save when save button is clicked', () => {
    profileService.update.mockReturnValue(of({}));
    fixture.detectChanges();
    const saveButton = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLElement>) as HTMLButtonElement[];
    const save = saveButton.find(
      b => b.textContent?.trim() === 'Save'
    );
    expect(save).toBeTruthy();
    save?.click();
    expect(profileService.update).toHaveBeenCalled();
  });
});

const USER_PROFILE_DEFAULT = {
  currencyCode: 'USD',
  preferredSizeSystem: 'US',
  stylePreferences: [],
  favoriteBrands: [],
  preferredColours: [],
};
