import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { WardrobeComponent } from './closet.component';
import { WardrobeService } from '../../core/services/wardrobe.service';

describe('WardrobeComponent', () => {
  let component: WardrobeComponent;
  let fixture: ComponentFixture<WardrobeComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WardrobeComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) }, queryParamMap: of(convertToParamMap({})) } },
        { provide: WardrobeService, useValue: { 
          getAll: vi.fn().mockReturnValue(of({ items: [], pageInfo: {} })), 
          getDrafts: vi.fn().mockReturnValue(of({ items: [] })),
          update: vi.fn().mockReturnValue(of({})),
          delete: vi.fn().mockReturnValue(of({}))
        } },
        { provide: Router, useValue: { navigate: vi.fn() } }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(WardrobeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // Add more MCP-based tests as needed
});
