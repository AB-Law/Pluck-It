import { resizeImageFile } from './image-utils';

describe('resizeImageFile', () => {
  const encoder = new TextEncoder();
  const sampleBytes = encoder.encode('fake-image-bytes');

  const createImageBitmapMock = () => ({
    width: 2400,
    height: 1200,
    close: vi.fn(),
  });

  beforeEach(() => {
    if (!(globalThis as any).createImageBitmap) {
      Object.defineProperty(globalThis, 'createImageBitmap', {
        value: vi.fn(),
        configurable: true,
        writable: true,
      });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as any).OffscreenCanvas;
  });

  it('returns HEIC and HEIF files as-is', async () => {
    const file = new File([sampleBytes], 'look.heic', { type: 'image/heic' });
    const resized = await resizeImageFile(file);
    expect(resized).toBe(file);
  });

  it('returns original file when browser cannot decode', async () => {
    const file = new File([sampleBytes], 'look.png', { type: 'image/png' });
    vi.spyOn(globalThis as any, 'createImageBitmap').mockRejectedValue(new Error('unsupported'));

    const resized = await resizeImageFile(file);
    expect(resized).toBe(file);
  });

  it('resizes image with OffscreenCanvas path when available', async () => {
    vi.spyOn(globalThis as any, 'createImageBitmap').mockResolvedValue(createImageBitmapMock());

    const convertToBlob = vi.fn().mockResolvedValue(new Blob([sampleBytes], { type: 'image/jpeg' }));
    const ctx = { drawImage: vi.fn() };
    class TestOffscreenCanvas {
      width = 0;
      height = 0;
      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }
      getContext() {
        return ctx;
      }
      convertToBlob(...args: unknown[]) {
        return convertToBlob(...args);
      }
    }
    (globalThis as any).OffscreenCanvas = TestOffscreenCanvas as unknown as typeof OffscreenCanvas;

    const file = new File([sampleBytes], 'look.png', { type: 'image/png' });
    const resized = await resizeImageFile(file, 1000);

    expect(resized).not.toBe(file);
    expect(convertToBlob).toHaveBeenCalledWith({ type: 'image/jpeg', quality: 0.92 });
    expect(resized.name).toBe('look.jpg');
  });

  it('falls back to html canvas and returns original when context is null', async () => {
    vi.spyOn(globalThis as any, 'createImageBitmap').mockResolvedValue(createImageBitmapMock());
    const nullContextCanvas = { getContext: vi.fn().mockReturnValue(null) };
    vi.spyOn(document, 'createElement').mockReturnValue(nullContextCanvas as any);

    const file = new File([sampleBytes], 'look.png', { type: 'image/png' });
    const resized = await resizeImageFile(file, 1000);

    expect(resized).toBe(file);
    expect(nullContextCanvas.getContext).toHaveBeenCalledWith('2d');
  });

  it('rejects when html canvas toBlob callback is null', async () => {
    vi.spyOn(globalThis as any, 'createImageBitmap').mockResolvedValue(createImageBitmapMock());
    vi.spyOn(document, 'createElement').mockReturnValue({
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue({ drawImage: vi.fn() }),
      toBlob: (cb: (value: Blob | null) => void) => cb(null),
    } as any);

    const file = new File([sampleBytes], 'look.png', { type: 'image/png' });

    await expect(resizeImageFile(file, 1000)).rejects.toThrow('toBlob returned null');
  });
});
