import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UploadItemComponent } from './upload-item.component';

const buildFileList = (files: File[]) => {
  const list = files as unknown as FileList & { [key: number]: File; item: (index: number) => File | null };
  list.item = (index: number) => files[index] ?? null;
  Object.defineProperty(list, 'length', { value: files.length, writable: true });
  files.forEach((file, index) => {
    (list as any)[index] = file;
  });
  return list;
};

describe('UploadItemComponent', () => {
  let component: UploadItemComponent;
  let fixture: ComponentFixture<UploadItemComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UploadItemComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(UploadItemComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('opens file selector when asked', () => {
    const input = fixture.nativeElement.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click');
    component.openFilePicker();
    expect(clickSpy).toHaveBeenCalled();
  });

  it('sets dragging state on drag over and clears it on drop', () => {
    const preventDefault = vi.fn();
    const event = { preventDefault } as unknown as DragEvent;
    component.onDragOver(event);
    expect(preventDefault).toHaveBeenCalled();
    expect(component.dragging).toBe(true);

    component.onDrop({ preventDefault: vi.fn() } as unknown as DragEvent);
    expect(component.dragging).toBe(false);
  });

  it('emits only image-like files on drop', () => {
    const selected = vi.fn();
    const images = [
      new File(['a'], 'shirt.jpg', { type: 'image/jpeg' }),
      new File(['b'], 'manual.txt', { type: 'text/plain' }),
      new File(['c'], 'top.HEIC', { type: 'application/octet-stream' }),
    ];
    const dropEvent = {
      preventDefault: vi.fn(),
      dataTransfer: { files: buildFileList(images) },
    } as unknown as DragEvent;

    component.fileSelected.subscribe(selected);
    component.onDrop(dropEvent);

    expect(selected).toHaveBeenCalledWith([images[0], images[2]]);
    expect(dropEvent.preventDefault).toHaveBeenCalled();
  });

  it('emits selected files on file input change and clears the control value', () => {
    const selected = vi.fn();
    const chosen = [new File(['a'], 'dress.png', { type: 'image/png' })];
    const control = {
      files: chosen,
      value: 'dirty',
    } as unknown as HTMLInputElement;

    component.fileSelected.subscribe(selected);
    component.onFileChange({ target: control } as unknown as Event);

    expect(selected).toHaveBeenCalledWith(expect.arrayContaining(chosen));
    expect(control.value).toBe('');
  });
});
