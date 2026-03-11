import { ComponentFixture, TestBed } from '@angular/core/testing';
import { VaultSidebarComponent } from './vault-sidebar.component';
import { VaultFilters } from './vault-sidebar.component';
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

    if (!('elementFromPoint' in document)) {
      Object.defineProperty(document, 'elementFromPoint', {
        value: vi.fn(),
        configurable: true,
        writable: true,
      });
    }

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
      minWears: 3,
      brand: 'Nike',
      condition: 'Good',
      sortField: 'wearCount',
      sortDir: 'asc',
    });
    component.ngOnInit();

    expect(component.activeGroup()).toBe('favorites');
    expect(component.priceRange()).toEqual([200, 400]);
    expect(component.minWears()).toBe(3);
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
  });

  it('clears all filters and restores defaults', () => {
    fixture.componentRef.setInput('maxPrice', 1000);
    fixture.componentRef.setInput('currency', 'USD');
    fixture.componentRef.setInput('initialFilters', {
      group: 'favorites',
      priceRange: [10, 200],
      minWears: 5,
      brand: 'COS',
      condition: 'Good',
      sortField: 'wearCount',
      sortDir: 'desc',
    });
    component.ngOnInit();
    component.clearAll();

    expect(component.priceRange()).toEqual([0, 1000]);
    expect(component.minWears()).toBe(0);
    expect(component.brandFilter()).toBe('');
    expect(component.activeCondition()).toBe('');
    expect(component.sortField()).toBe('dateAdded');
    expect(component.sortDir()).toBe('desc');
    expect(emitted?.brand).toBe('');
  });

  it('tracks wear slider drag only when dragging and rounds to nearest integer', () => {
    const track = document.createElement('div');
    track.className = 'relative';
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 200,
      top: 0,
      right: 200,
      bottom: 0,
      x: 0,
      y: 0,
      height: 0,
      toJSON: () => ({}),
    } as DOMRect);
    const thumb = { closest: vi.fn().mockReturnValue(track) } as unknown as Element;
    const spy = vi.spyOn(document, 'elementFromPoint').mockReturnValue(thumb);
    component.startWearDrag(new MouseEvent('mousedown', { clientX: 0 }) );
    spy.mockReturnValue(track);
    component.onWearDrag(new MouseEvent('mousemove', { clientX: 200, clientY: 0 }) );
    expect(component.minWears()).toBe(200);
    component.stopWearDrag();
    component.onWearDrag(new MouseEvent('mousemove', { clientX: 20, clientY: 0 }) );
    expect(component.minWears()).toBe(200);
  });

  it('detects active filters and computed percentage label', () => {
    expect(component.hasActiveFilters()).toBe(false);
    component.onBrandChange('Ralph');
    expect(component.hasActiveFilters()).toBe(true);
    expect(component.wearPct()).toBe(0);
    expect(component.priceLabel()).toContain('$');
    expect(component.sortOptions.length).toBeGreaterThan(2);
  });
});
