import { PNG } from "pngjs";
import type { SnapshotNode } from "./device.js";

export type IosSnapshotGeometry = {
  rotation: "none" | "left";
  logicalWidth: number;
  logicalHeight: number;
};

/** Detect XCTest's mixed native-portrait and interface-landscape coordinate spaces. */
export function inferIosSnapshotGeometry(nodes: SnapshotNode[]): IosSnapshotGeometry | undefined {
  const application = nodes.find(
    (node) =>
      node.depth === 0 &&
      node.type === "Application" &&
      node.rect &&
      node.rect.width >= 100 &&
      node.rect.height >= 100,
  );
  if (!application?.rect) return undefined;
  const logicalWidth = application.rect.width;
  const logicalHeight = application.rect.height;
  const nativeWindow = nodes.find(
    (node) =>
      node.depth === 1 &&
      node.type === "Window" &&
      node.rect &&
      Math.abs(node.rect.width - logicalHeight) <= 2 &&
      Math.abs(node.rect.height - logicalWidth) <= 2,
  );
  return {
    rotation: nativeWindow && logicalWidth > logicalHeight ? "left" : "none",
    logicalWidth,
    logicalHeight,
  };
}

/** Normalize XCTest's portrait-buffer child rects into the logical viewport. */
export function normalizeIosSnapshotNodes(
  nodes: SnapshotNode[],
  geometry = inferIosSnapshotGeometry(nodes),
): SnapshotNode[] {
  if (!geometry || geometry.rotation === "none") return nodes;
  return nodes.map((node) => {
    if (!node.rect || (node.depth === 0 && node.type === "Application")) return node;
    const rect = node.rect;
    return {
      ...node,
      rect: {
        x: rect.y,
        y: geometry.logicalHeight - (rect.x + rect.width),
        width: rect.height,
        height: rect.width,
      },
    };
  });
}

export function pngDimensions(bytes: Buffer): { width: number; height: number } | undefined {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature)) return undefined;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : undefined;
}

/** Rotate transport pixels when they disagree with the logical viewport. */
export function normalizeScreenshotToBounds(
  bytes: Buffer,
  bounds?: { width: number; height: number },
): Buffer {
  const dimensions = pngDimensions(bytes);
  const boundsLandscape = bounds ? bounds.width > bounds.height : false;
  const pixelsLandscape = dimensions ? dimensions.width > dimensions.height : false;
  if (
    !bounds ||
    !dimensions ||
    boundsLandscape === pixelsLandscape ||
    bounds.width === bounds.height ||
    dimensions.width === dimensions.height
  ) {
    return bytes;
  }

  let source: PNG;
  try {
    source = PNG.sync.read(bytes);
  } catch {
    return bytes;
  }
  const destination = new PNG({ width: source.height, height: source.width });
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const sourceOffset = (source.width * y + x) << 2;
      const destinationX = y;
      const destinationY = source.width - x - 1;
      const destinationOffset = (destination.width * destinationY + destinationX) << 2;
      source.data.copy(destination.data, destinationOffset, sourceOffset, sourceOffset + 4);
    }
  }
  return PNG.sync.write(destination);
}
