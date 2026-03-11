import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SourceSidebarComponent } from './source-sidebar.component';
import { ScraperSource } from '../../core/models/scraped-item.model';

const SOURCES: ScraperSource[] = [
  {
    id: 'r-1',
    name: 'Reddit Trends',
    sourceType: 'reddit',
    isGlobal: false,
    isActive: true,
    config: { query: 'fashion' },
    createdAt: '2026-01-01T00:00:00Z',
    subscribed: true,
    needsClientIngest: false,
  },
  {
    id: 'r-2',
    name: 'Second Reddit',
    sourceType: 'reddit',
    isGlobal: true,
    isActive: true,
    config: { query: 'outerwear' },
    createdAt: '2026-01-02T00:00:00Z',
    subscribed: true,
    needsClientIngest: false,
  },
  {
    id: 'b-1',
    name: 'Brand Picks',
    sourceType: 'brand',
    isGlobal: false,
    isActive: true,
    config: { url: 'https://example.test' },
    createdAt: '2026-01-03T00:00:00Z',
    subscribed: true,
    needsClientIngest: false,
  },
];

describe('SourceSidebarComponent', () => {
  let component: SourceSidebarComponent;
  let fixture: ComponentFixture<SourceSidebarComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SourceSidebarComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SourceSidebarComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('sources', SOURCES);
    fixture.componentRef.setInput('activeSourceId', null);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('emits sourceSelected when All Sources is clicked', () => {
    const sourceSelected = vi.fn();
    component.sourceSelected.subscribe(sourceSelected);
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    const allButton = buttons.find(button => button.textContent?.includes('All Sources'));
    expect(allButton).toBeDefined();
    allButton?.click();
    expect(sourceSelected).toHaveBeenCalledWith(null);
  });

  it('emits sourceSelected when a source button is clicked', () => {
    const sourceSelected = vi.fn();
    component.sourceSelected.subscribe(sourceSelected);
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    const brandButton = buttons.find(button => button.textContent?.includes('Brand Picks'));
    expect(brandButton).toBeDefined();
    brandButton?.click();
    expect(sourceSelected).toHaveBeenCalledWith('b-1');
  });

  it('emits unsubscribe for non-global sources', () => {
    const unsubscribe = vi.fn();
    component.unsubscribe.subscribe(unsubscribe);
    const unsub = fixture.nativeElement.querySelector('button[title="Unsubscribe"]') as HTMLButtonElement;
    expect(unsub).toBeTruthy();
    unsub.click();
    expect(unsubscribe).toHaveBeenCalledWith('r-1');
  });

  it('only toggles suggest form via dedicated actions', () => {
    const suggest = vi.fn();
    component.suggestBrand.subscribe(suggest);

    const toggleButton = Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).find(button => button.textContent?.includes('Suggest a brand')) as HTMLButtonElement;
    expect(toggleButton.textContent).toContain('Suggest a brand');
    toggleButton.click();
    fixture.detectChanges();

    const inputs = fixture.nativeElement.querySelectorAll('input');
    expect(inputs.length).toBe(2);

    inputs[0].value = 'Acme';
    inputs[0].dispatchEvent(new Event('input'));
    inputs[1].value = 'https://acme.example';
    inputs[1].dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const submit = Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).find(button => button.textContent?.trim() === 'Submit') as HTMLButtonElement;
    submit.click();
    fixture.detectChanges();

    expect(suggest).toHaveBeenCalledWith({ name: 'Acme', url: 'https://acme.example' });
  });

  it('does not submit brand suggestion when inputs are blank', () => {
    const suggest = vi.fn();
    component.suggestBrand.subscribe(suggest);
    const toggleButton = Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).find(button => button.textContent?.includes('Suggest a brand')) as HTMLButtonElement;
    toggleButton.click();
    fixture.detectChanges();

    const submit = Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).find(button => button.textContent?.trim() === 'Submit') as HTMLButtonElement;
    submit.click();
    fixture.detectChanges();
    expect(suggest).not.toHaveBeenCalled();
  });
});
