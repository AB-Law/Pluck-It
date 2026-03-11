import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DiscoverComponent } from './discover.component';
import { DiscoverService } from '../../core/services/discover.service';
import { of } from 'rxjs';

describe('DiscoverComponent', () => {
  let component: DiscoverComponent;
  let fixture: ComponentFixture<DiscoverComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DiscoverComponent],
      providers: [
        { provide: DiscoverService, useValue: {
          getSources: vi.fn().mockReturnValue(of([])),
          getFeed: vi.fn().mockReturnValue(of({ items: [], nextCursor: null })),
          acquireLease: vi.fn().mockReturnValue(of({})),
          ingestReddit: vi.fn().mockReturnValue(of({})),
          sendFeedback: vi.fn().mockReturnValue(of({})),
          suggestSource: vi.fn().mockReturnValue(of({})),
          unsubscribe: vi.fn().mockReturnValue(of({})),
        }}
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(DiscoverComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // Add more MCP-based tests as needed
});
