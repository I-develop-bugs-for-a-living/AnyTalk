import jsQR from "jsqr";

/**
 * Find a QR code in a camera frame
 * @param data RGBA pixel data of the frame
 * @param width Frame width in pixels
 * @param height Frame height in pixels
 * @returns Text of the QR code, or undefined when there is none
 */
export function decodeQrFromImage(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): string | undefined {
  try {
    // attemptBoth: also reads light-on-dark codes (dark themes, inverted)
    return jsQR(data, width, height, { inversionAttempts: "attemptBoth" })
      ?.data;
  } catch {
    // a bad frame must never stop the scan loop
    return undefined;
  }
}
