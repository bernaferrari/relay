import { inflateSync } from "node:zlib";

const ADAM7_PASSES = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;
const CHANNELS_BY_COLOR_TYPE: Readonly<Record<number, number>> = {
  0: 1,
  2: 3,
  3: 1,
  4: 2,
  6: 4,
};

/** pngjs bounds ordinary PNG inflation but not Adam7 inflation. Validate its
 * same IDAT stream with Node's output limit before permitting that decode;
 * worker heap limits alone cannot bound external Buffer allocations. */
export function validateInterlacedPngExpansion(
  png: Buffer,
  dimensions: { width: number; height: number } | undefined,
): boolean {
  if (!dimensions || png.length < 33 || png[28] !== 1) return true;
  const depth = png[24]!;
  const channels = CHANNELS_BY_COLOR_TYPE[png[25]!];
  // Unsupported headers fail in pngjs before inflation. Preserve its invalid
  // image fallback rather than assigning them a guessed allocation budget.
  if (!channels || ![1, 2, 4, 8, 16].includes(depth)) return true;
  let maximum = 0;
  for (const [startX, startY, stepX, stepY] of ADAM7_PASSES) {
    const width = Math.max(0, Math.ceil((dimensions.width - startX) / stepX));
    const height = Math.max(0, Math.ceil((dimensions.height - startY) / stepY));
    if (width && height) maximum += (Math.ceil((width * channels * depth) / 8) + 1) * height;
  }
  if (!maximum) return false;
  const data: Buffer[] = [];
  let offset = 8;
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const kind = png.readUInt32BE(offset + 4);
    const next = offset + length + 12;
    if (next > png.length || kind === 0x49454e44) break;
    if (kind === 0x49444154) data.push(png.subarray(offset + 8, offset + 8 + length));
    offset = next;
  }
  try {
    inflateSync(Buffer.concat(data), { maxOutputLength: maximum });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE") {
      throw new Error("Screenshot exceeds the interlaced PNG expansion limit");
    }
    // Do not retry corrupt data with pngjs's unbounded inflater. Its error can
    // occur after substantial output, even though the original input is small.
    return false;
  }
}
