// @vitest-environment jsdom
import { createRoot } from "solid-js";
import { QRCodeSVG } from "solid-qr-code";

import { describe, expect, it } from "vitest";

import { decodeQrFromImage } from "./qrDecode";
import { QR_LEVEL, encodeQrLogin } from "./qrLoginCode";

const ID = "abcdefghijklmnopqrstuvwxyz012345";

/** Side of the rendered code in svg units, as in FlowQrLogin */
const SIZE = 240;

/**
 * Render the code like FlowQrLogin does and rasterise it, with a quiet zone
 * @param value Text to encode
 * @param invert Draw light modules on a dark background
 */
function raster(value: string, invert: boolean) {
  let svg!: SVGElement;
  createRoot(() => {
    svg = QRCodeSVG({
      value,
      level: QR_LEVEL,
      backgroundColor: "white",
      foregroundColor: "black",
      height: SIZE,
      width: SIZE,
      backgroundAlpha: 1,
      foregroundAlpha: 1,
    }) as unknown as SVGElement;
  });

  const margin = 40;
  const side = SIZE + margin * 2;
  const data = new Uint8ClampedArray(side * side * 4);
  const [bg, fg] = invert ? [0, 255] : [255, 0];
  for (let i = 0; i < side * side; i++) {
    data.fill(bg, i * 4, i * 4 + 3);
    data[i * 4 + 3] = 255;
  }
  for (const rect of svg.querySelectorAll("rect")) {
    if (!rect.style.fill.includes("black")) continue;
    const x0 = Math.round(Number(rect.getAttribute("x"))) + margin;
    const y0 = Math.round(Number(rect.getAttribute("y"))) + margin;
    const w = Math.round(Number(rect.getAttribute("width")));
    const h = Math.round(Number(rect.getAttribute("height")));
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        data.fill(fg, (y * side + x) * 4, (y * side + x) * 4 + 3);
      }
    }
  }
  return { data, side };
}

describe("qr decode", () => {
  const content = encodeQrLogin(ID, "https://192.168.178.26:5175");

  it("reads the code rendered by the login screen", () => {
    const { data, side } = raster(content, false);
    expect(decodeQrFromImage(data, side, side)).toBe(content);
  });

  it("reads the same code with inverted colours", () => {
    const { data, side } = raster(content, true);
    expect(decodeQrFromImage(data, side, side)).toBe(content);
  });

  it("returns undefined for a blank frame", () => {
    expect(decodeQrFromImage(new Uint8ClampedArray(40 * 40 * 4), 40, 40)).toBe(
      undefined,
    );
  });
});
