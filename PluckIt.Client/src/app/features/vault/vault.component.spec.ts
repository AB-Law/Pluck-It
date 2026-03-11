import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { VaultComponent } from './vault.component';
import { VaultInsightsService } from '../../core/services/vault-insights.service';
import { WardrobeService } from '../../core/services/wardrobe.service';
import { UserProfileService } from '../../core/services/user-profile.service';
import { of } from 'rxjs';

describe('VaultComponent', () => {
  let component: VaultComponent;
  let fixture: ComponentFixture<VaultComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [VaultComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) }, queryParamMap: of(convertToParamMap({})) } },
        { provide: VaultInsightsService, useValue: { getInsights: vi.fn().mockReturnValue(of({ behavioralInsights: { topColorWearShare: null, avgWearFrequency: 0 }, insights: [] })) } },
        { provide: WardrobeService, useValue: { getAll: vi.fn().mockReturnValue(of({ items: [], pageInfo: {} })), getWearSuggestions: vi.fn().mockReturnValue(of([])), logWear: vi.fn().mockReturnValue(of({})), update: vi.fn().mockReturnValue(of({})), updateWearSuggestionStatus: vi.fn().mockReturnValue(of({})) } },
        { provide: UserProfileService, useValue: { load: vi.fn().mockReturnValue(of({ id: 'test', name: 'Test' })), getOrDefault: vi.fn().mockReturnValue({ currencyCode: 'USD' }) } }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(VaultComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // Add more MCP-based tests as needed
});
