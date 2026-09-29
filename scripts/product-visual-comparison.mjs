const PIXEL_DELTA = 18;

/** Native video frames vary slightly by decoder. Keep the player edges and
 * controls in the visual comparison while excluding only its decoded image. */
export function decodedVideoFrameRegion(box) {
  if (!box || box.width <= 12 || box.height <= 70) {
    throw new Error("Report video has no usable frame bounds");
  }
  return {
    left: Math.ceil(box.x + 6),
    top: Math.ceil(box.y + 6),
    right: Math.floor(box.x + box.width - 6),
    bottom: Math.floor(box.y + box.height - 64),
  };
}

export function comparePng(PNG, expectedBytes, actualBytes, ignoredRegion) {
  const expected = PNG.sync.read(expectedBytes);
  const actual = PNG.sync.read(actualBytes);
  if (expected.width !== actual.width || expected.height !== actual.height) {
    return { ratio: 1, differentPixels: expected.width * expected.height, dimensionsChanged: true };
  }
  let differentPixels = 0;
  let comparedPixels = 0;
  for (let y = 0; y < expected.height; y += 1) {
    for (let x = 0; x < expected.width; x += 1) {
      if (
        ignoredRegion &&
        x >= ignoredRegion.left &&
        x < ignoredRegion.right &&
        y >= ignoredRegion.top &&
        y < ignoredRegion.bottom
      ) {
        continue;
      }
      comparedPixels += 1;
      const offset = (y * expected.width + x) * 4;
      const delta = Math.max(
        Math.abs(expected.data[offset] - actual.data[offset]),
        Math.abs(expected.data[offset + 1] - actual.data[offset + 1]),
        Math.abs(expected.data[offset + 2] - actual.data[offset + 2]),
        Math.abs(expected.data[offset + 3] - actual.data[offset + 3]),
      );
      if (delta > PIXEL_DELTA) differentPixels += 1;
    }
  }
  return {
    ratio: comparedPixels === 0 ? 1 : differentPixels / comparedPixels,
    differentPixels,
    dimensionsChanged: false,
  };
}
