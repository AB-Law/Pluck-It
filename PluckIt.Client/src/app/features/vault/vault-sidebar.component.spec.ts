import { ComponentFixture, TestBed } from '@angular/core/testing';
import { VaultSidebarComponent, VaultFilters } from './vault-sidebar.component';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';

describe('VaultSidebarComponent', () => {
  let component: VaultSidebarComponent;
  let fixture: ComponentFixture<VaultSidebarComponent>;
  let emitted: VaultFilters | null;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [VaultSidebarComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { snapshot: {}, queryParamMap: of() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(VaultSidebarComponent);
    component = fixture.componentInstance;
    component.filtersChange.subscribe(value => { emitted = value; });
    fixture.detectChanges();
  });

  beforeEach(() => {
    emitted = null;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('initializes filters from input when present', () => {
    fixture.componentRef.setInput('initialFilters', {
      group: 'favorites',
      priceRange: [200, 400],
      wearRange: [3, 40],
      brand: 'Nike',
      condition: 'Good',
      sortField: 'wearCount',
      sortDir: 'asc',
    });
    component.ngOnInit();

    expect(component.activeGroup()).toBe('favorites');
    expect(component.priceRange()).toEqual([200, 400]);
    expect(component.wearRange()).toEqual([3, 40]);
    expect(component.brandFilter()).toBe('Nike');
    expect(component.activeCondition()).toBe('Good');
    expect(component.sortField()).toBe('wearCount');
    expect(component.sortDir()).toBe('asc');
  });

  it('emits changes on group, price, brand, sort and condition interactions', () => {
    component.selectGroup('recent');
    expect(emitted?.group).toBe('recent');
    expect(emitted?.sortField).toBe('dateAdded');

    component.onPriceChange([100, 900]);
    expect(emitted?.priceRange).toEqual([100, 900]);

    component.onBrandChange('COS');
    expect(emitted?.brand).toBe('COS');

    component.onSortChange('price.amount:asc');
    expect(emitted?.sortField).toBe('price.amount');
    expect(emitted?.sortDir).toBe('asc');

    component.toggleCondition('Good');
    expect(emitted?.condition).toBe('Good');

    component.onWearsChange([5, 20]);
    expect(emitted?.wearRange).toEqual([5, 20]);
  });

  it('clears all filters and restores defaults', () => {
    fixture.componentRef.setInput('maxPrice', 1000);
    fixture.componentRef.setInput('currency', 'USD');
    fixture.componentRef.setInput('initialFilters', {
      group: 'favorites',
      priceRange: [10, 200],
      wearRange: [5, 22],
      brand: 'COS',
      condition: 'Good',
      sortField: 'wearCount',
      sortDir: 'desc',
    });
    component.ngOnInit();
    component.clearAll();

    expect(component.priceRange()).toEqual([0, 1000]);
    expect(component.wearRange()).toEqual([0, 200]);
    expect(component.brandFilter()).toBe('');
    expect(component.activeCondition()).toBe('');
    expect(component.sortField()).toBe('dateAdded');
    expect(component.sortDir()).toBe('desc');
    expect(emitted?.brand).toBe('');
  });

  it('detects active filters and computed percentage label', () => {
    expect(component.hasActiveFilters()).toBe(false);
    component.onBrandChange('Ralph');
    expect(component.hasActiveFilters()).toBe(true);
    expect(component.priceLabel()).toContain('$');
    expect(component.sortOptions.length).toBeGreaterThan(2);
  });
});
