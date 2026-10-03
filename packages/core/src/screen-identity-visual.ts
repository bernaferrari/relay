import { createHash } from "node:crypto";
import { PNG } from "pngjs";

/**
 * Produces a stable visual identity for screens that expose no useful native
 * semantics (custom canvases, games, system surfaces, or temporarily broken
 * accessibility bridges). A difference hash is deliberately used instead of
 * the PNG bytes: compression, colour shifts, and the clock should not turn the
 * same screen into a new node. The system bars are excluded because their
 * changing time, battery, and gesture hints describe the device, not the app.
 */
export function observeVisualScreenFingerprint(png: Uint8Array): string | undefined {
  let image: PNG;
  try {
    image = PNG.sync.read(Buffer.from(png));
  } catch {
    return undefined;
  }
  if (image.width < 17 || image.height < 20) return undefined;

  const left = 0;
  // Keep trailing page actions (Scan/Stop, Save, overflow menus) outside the
  // identity band. They often change while the user remains on one screen.
  const right = Math.max(1, Math.ceil(image.width * 0.42));
  const top = Math.floor(image.height * 0.06);
  // Screen chrome is far more stable than body content: lists reorder, feeds
  // refresh, and illustrations animate. The upper identity band retains the
  // title and leading icon while excluding those expected variations.
  const bottom = Math.max(top + 1, Math.ceil(image.height * 0.18));
  const luma = (sampleX: number, sampleY: number): number => {
    const x = Math.max(0, Math.min(image.width - 1, sampleX));
    const y = Math.max(0, Math.min(image.height - 1, sampleY));
    const offset = (y * image.width + x) * 4;
    const alpha = image.data[offset + 3]! / 255;
    const red = image.data[offset]! * alpha + 255 * (1 - alpha);
    const green = image.data[offset + 1]! * alpha + 255 * (1 - alpha);
    const blue = image.data[offset + 2]! * alpha + 255 * (1 - alpha);
    return red * 0.299 + green * 0.587 + blue * 0.114;
  };
  const sample = (column: number, row: number, columns: number, rows: number): number =>
    luma(
      Math.floor(left + ((column + 0.5) / columns) * (right - left)),
      Math.floor(top + ((row + 0.5) / rows) * (bottom - top)),
    );

  let bits = "";
  for (let row = 0; row < 16; row++) {
    for (let column = 0; column < 16; column++) {
      bits += sample(column, row, 17, 16) > sample(column + 1, row, 17, 16) ? "1" : "0";
    }
  }
  for (let row = 0; row < 16; row++) {
    for (let column = 0; column < 16; column++) {
      bits += sample(column, row, 16, 17) > sample(column, row + 1, 16, 17) ? "1" : "0";
    }
  }
  // A title alone is not unique: detail screens frequently share the same
  // back-button chrome. Add a coarse app-body signature so visually distinct
  // destinations cannot collapse into one node. This remains a fallback for
  // screens without stable native semantics, not a replacement for them.
  const bodyLeft = Math.floor(image.width * 0.04);
  const bodyRight = Math.max(bodyLeft + 1, Math.ceil(image.width * 0.96));
  const bodyTop = Math.floor(image.height * 0.2);
  const bodyBottom = Math.max(bodyTop + 1, Math.ceil(image.height * 0.9));
  const bodySample = (column: number, row: number, columns: number, rows: number): number =>
    luma(
      Math.floor(bodyLeft + ((column + 0.5) / columns) * (bodyRight - bodyLeft)),
      Math.floor(bodyTop + ((row + 0.5) / rows) * (bodyBottom - bodyTop)),
    );
  for (let row = 0; row < 8; row++) {
    for (let column = 0; column < 8; column++) {
      bits += bodySample(column, row, 9, 8) > bodySample(column + 1, row, 9, 8) ? "1" : "0";
      bits += bodySample(column, row, 8, 9) > bodySample(column, row + 1, 8, 9) ? "1" : "0";
    }
  }
  return createHash("sha256").update(`relay-screen-visual:v1:${bits}`).digest("hex");
}
