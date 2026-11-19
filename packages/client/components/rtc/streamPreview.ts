/** Width of an uploaded stream preview, in pixels */
export const PREVIEW_WIDTH = 320;

/** Largest preview the server accepts, in bytes */
export const PREVIEW_MAX_BYTES = 200 * 1024;

/** JPEG qualities to try, best first */
export const PREVIEW_QUALITIES = [0.6, 0.45, 0.3, 0.2];

/** Time between the stream start and the first preview, in milliseconds */
export const PREVIEW_FIRST_DELAY_MS = 3000;

/** Time between previews, in milliseconds */
export const PREVIEW_INTERVAL_MS = 3 * 60 * 1000;

/**
 * Size of a preview for a captured frame: scaled down to the preview width
 * with the aspect ratio kept. Small frames are not scaled up.
 * @param width Frame width
 * @param height Frame height
 * @param maxWidth Preview width
 * @returns Preview size, or undefined when the frame has no size
 */
export function previewSize(
  width: number,
  height: number,
  maxWidth = PREVIEW_WIDTH,
): { width: number; height: number } | undefined {
  if (!(width > 0) || !(height > 0)) return undefined;
  const scale = Math.min(1, maxWidth / width);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Encode a frame as JPEG, lowering the quality until it fits the size limit
 * @param encode Encodes the frame at a quality (e.g. canvas toBlob)
 * @param maxBytes Size limit
 * @returns The image, or undefined when it can't be made small enough
 */
export async function encodeUnderLimit(
  encode: (quality: number) => Promise<Blob | null>,
  maxBytes = PREVIEW_MAX_BYTES,
): Promise<Blob | undefined> {
  for (const quality of PREVIEW_QUALITIES) {
    const blob = await encode(quality);
    if (!blob) return undefined;
    if (blob.size <= maxBytes) return blob;
  }
  return undefined;
}
