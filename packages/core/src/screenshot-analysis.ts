import { createHash } from "node:crypto";
import { PNG, type PNGWithMetadata } from "pngjs";
import { proposeVisualRowsFromDecodedRaster, type ProposedVisualRow } from "./visual-rows.js";
import { validateInterlacedPngExpansion } from "./screenshot-interlace-bounds.js";

/**
 * Produces a stable visual identity for screens that expose no useful native
 * semantics (custom canvases, games, system surfaces, or temporarily broken
 * accessibility bridges). A difference hash is deliberately used instead of
 * the PNG bytes: compression, colour shifts, and the clock should not turn the
 * same screen into a new node. The system bars are excluded because their
 * changing time, battery, and gesture hints describe the device, not the app.
 */
export type ScreenshotAnalysis = Readonly<{
  blank: boolean;
  visualFingerprint?: string;
  dimensions?: Readonly<{ width: number; height: number }>;
  proposedRows?: readonly ProposedVisualRow[];
}>;

export const MAX_SCREENSHOT_ANALYSIS_BYTES = 32 * 1024 * 1024;
// 16 megapixels accommodates 4K desktops and current Retina device captures.
// Bound each axis too, so an extremely narrow raster cannot drive huge row work.
const MAX_SCREENSHOT_ANALYSIS_PIXELS = 16 * 1024 * 1024;
const MAX_SCREENSHOT_ANALYSIS_DIMENSION = 16_384;
const MAX_SCREENSHOT_ANALYSIS_CHUNKS = 8192;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Validate allocation bounds before copying input or invoking a PNG decoder.
 * Invalid non-PNG input keeps the established decode-failure fallback. */
export function screenshotAnalysisDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | undefined {
  if (bytes.byteLength > MAX_SCREENSHOT_ANALYSIS_BYTES) {
    throw new Error("Screenshot exceeds the 32 MiB analysis byte limit");
  }
  const png = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    png.length < 24 ||
    !png.subarray(0, 8).equals(PNG_SIGNATURE) ||
    png.toString("ascii", 12, 16) !== "IHDR"
  )
    return undefined;
  assertSinglePngHeader(png);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (
    width > MAX_SCREENSHOT_ANALYSIS_DIMENSION ||
    height > MAX_SCREENSHOT_ANALYSIS_DIMENSION ||
    width * height > MAX_SCREENSHOT_ANALYSIS_PIXELS
  ) {
    throw new Error(
      "Screenshot exceeds the analysis dimension limit (16 megapixels, 16384 per axis)",
    );
  }
  return { width, height };
}

/** pngjs accepts later IHDR chunks, so checking only the first header could
 * understate its actual allocation. Scan chunk boundaries without copying data. */
function assertSinglePngHeader(png: Buffer): void {
  let offset = 8;
  let headers = 0;
  let chunks = 0;
  while (offset + 8 <= png.length) {
    if (++chunks > MAX_SCREENSHOT_ANALYSIS_CHUNKS) {
      throw new Error("Screenshot exceeds the PNG analysis chunk limit");
    }
    const length = png.readUInt32BE(offset);
    const kind = png.readUInt32BE(offset + 4);
    if (kind === 0x49484452 && ++headers > 1) {
      throw new Error("Screenshot PNG contains duplicate IHDR headers");
    }
    const next = offset + length + 12;
    if (next > png.length || kind === 0x49454e44) return;
    offset = next;
  }
}

/** Analyze one immutable captured raster once; retain only small metadata,
 * never decoded pixels or a global cache that could outlive the observation. */
export function analyzeScreenshot(png: Uint8Array): ScreenshotAnalysis {
  const dimensions = screenshotAnalysisDimensions(png);
  if (
    !validateInterlacedPngExpansion(
      Buffer.from(png.buffer, png.byteOffset, png.byteLength),
      dimensions,
    )
  )
    return { blank: false };
  let image: PNGWithMetadata;
  try {
    // Apple can return 16-bit RGB. Keep its original samples, then apply
    // pngjs's exact 8-bit rounding only to channels we actually inspect.
    image = PNG.sync.read(Buffer.from(png), { skipRescale: png[24] === 16 });
  } catch {
    return { blank: false };
  }
  let blank = true;
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const alpha = channel(image, offset + 3);
    const red = channel(image, offset);
    const green = channel(image, offset + 1);
    const blue = channel(image, offset + 2);
    if (alpha > 0 && Math.max(red, green, blue) > 4) {
      blank = false;
      break;
    }
  }
  const proposedRows = proposeVisualRowsFromDecodedRaster({
    width: image.width,
    height: image.height,
    data: image.data,
    sampleDepth: image.depth === 16 ? 16 : 8,
  });
  return {
    blank,
    dimensions: { width: image.width, height: image.height },
    visualFingerprint: fingerprintFromDecodedRaster(image),
    ...(proposedRows.length ? { proposedRows } : {}),
  };
}

function channel(image: PNGWithMetadata, index: number): number {
  const value = image.data[index] ?? 0;
  return image.depth === 16 ? Math.floor((value * 255) / 65_535 + 0.5) : value;
}

function fingerprintFromDecodedRaster(image: PNGWithMetadata): string | undefined {
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
    const alpha = channel(image, offset + 3) / 255;
    const red = channel(image, offset) * alpha + 255 * (1 - alpha);
    const green = channel(image, offset + 1) * alpha + 255 * (1 - alpha);
    const blue = channel(image, offset + 2) * alpha + 255 * (1 - alpha);
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
