import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DigestPanelComponent } from './digest-panel.component';

describe('DigestPanelComponent', () => {
  let component: DigestPanelComponent;
  let fixture: ComponentFixture<DigestPanelComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DigestPanelComponent]
    }).compileComponents();
    fixture = TestBed.createComponent(DigestPanelComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // Add more MCP-based tests as needed
});
