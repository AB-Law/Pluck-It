import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { CollectionsComponent } from './collections.component';
import { CollectionService } from '../../core/services/collection.service';
import { WardrobeService } from '../../core/services/wardrobe.service';
import { AuthService } from '../../core/services/auth.service';
import { of } from 'rxjs';
import { signal } from '@angular/core';

describe('CollectionsComponent', () => {
  let component: CollectionsComponent;
  let fixture: ComponentFixture<CollectionsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CollectionsComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) }, queryParamMap: of(convertToParamMap({})) } },
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: CollectionService, useValue: {
          collections: signal([]),
          loadAll: vi.fn().mockReturnValue(of([])),
          delete: vi.fn().mockReturnValue(of({})),
          join: vi.fn().mockReturnValue(of({})),
          leave: vi.fn().mockReturnValue(of({})),
          removeItem: vi.fn().mockReturnValue(of({})),
        }},
        { provide: WardrobeService, useValue: { getAll: vi.fn().mockReturnValue(of({ items: [], pageInfo: {} })) } },
        { provide: AuthService, useValue: { user: signal(null) } },
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(CollectionsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // Add more MCP-based tests as needed
});
