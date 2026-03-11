import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { TasteQuizComponent } from './taste-quiz.component';

describe('TasteQuizComponent', () => {
  let component: TasteQuizComponent;
  let fixture: ComponentFixture<TasteQuizComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TasteQuizComponent],
      providers: [
        { provide: ActivatedRoute, useValue: {} }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(TasteQuizComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // Add more MCP-based tests as needed
});
