/**
 * Resizes an image File to fit within `maxSide` pixels on its longest edge.
 * Returns the original File unchanged if it already fits or if the browser
 * cannot decode the format (e.g. HEIC on desktop Chrome).
 *
 * Uses createImageBitmap + OffscreenCanvas (no DOM required) and outputs a JPEG
 * blob for maximum server compatibility.
 */
export async function resizeImageFile(
  file: File,
  maxSide = 1536,
  quality = 0.92,
): Promise<File> {
  // HEIC files can't be decoded by createImageBitmap on all browsers — skip resize.
  const isHeic =
    file.type === 'image/heic' ||
    file.type === 'image/heif' ||
    file.name.toLowerCase().endsWith('.heic') ||
    file.name.toLowerCase().endsWith('.heif');

  if (isHeic) return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // Unsupported format — return as-is and let the server handle it
    return file;
  }

  const { width, height } = bitmap;
  if (width <= maxSide && height <= maxSide) {
    bitmap.close();
    return file;
  }

  const scale = maxSide / Math.max(width, height);
  const outW = Math.round(width * scale);
  const outH = Math.round(height * scale);

  let canvas: OffscreenCanvas | HTMLCanvasElement;
  const offscreenCanvasCtor = (globalThis as any).OffscreenCanvas as
    | (new (width: number, height: number) => OffscreenCanvas)
    | undefined;
  const usingOffscreenCanvas = !!offscreenCanvasCtor;
  let offscreenCanvas: OffscreenCanvas | null = null;

  if (usingOffscreenCanvas) {
    canvas = offscreenCanvas = new offscreenCanvasCtor(outW, outH);
  } else {
    canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return file;
  }

  ctx.drawImage(bitmap, 0, 0, outW, outH);
  bitmap.close();

  let blob: Blob;
  if (usingOffscreenCanvas && offscreenCanvas) {
    blob = await offscreenCanvas.convertToBlob({ type: 'image/jpeg', quality });
    // TS lib definitions may not include OffscreenCanvas.close() in all targets.
    const closable = offscreenCanvas as { close?: () => void };
    closable.close?.();
  } else {
    const htmlCanvas = canvas as HTMLCanvasElement;
    blob = await new Promise<Blob>((resolve, reject) => {
      htmlCanvas.toBlob(
        (b: Blob | null) => (b ? resolve(b) : reject(new Error('toBlob returned null'))),
        'image/jpeg',
        quality,
      );
    });
  }

  const resizedName = file.name.replace(/\.[^/.]+$/, '') + '.jpg';
  return new File([blob], resizedName, { type: 'image/jpeg', lastModified: Date.now() });
}
