import { PNG } from "pngjs";
import type { SnapshotNode } from "./device.js";

export type IosSnapshotRotation = "none" | "left" | "right" | "upside-down";

export type IosSnapshotGeometry = {
  rotation: IosSnapshotRotation;
  logicalWidth: number;
  logicalHeight: number;
};

/**
 * Detect XCTest's mixed native-portrait and interface coordinate spaces.
 *
 * The depth-0 Application root always speaks the logical interface space, so
 * its aspect tells us when descendants arrive in the device's native portrait
 * buffer — even in sparse trees that omit the confirming Window node. The
 * optional CoreDevice display orientation decides which of the three remap
 * directions applies; without it a landscape interface can only keep the
 * historically observed default ("left").
 */
export function inferIosSnapshotGeometry(
  nodes: SnapshotNode[],
  displayOrientation?: IosDisplayOrientation | string | null,
): IosSnapshotGeometry | undefined {
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
  const orientation = parseIosDisplayOrientation(
    displayOrientation == null ? undefined : String(displayOrientation),
  );
  const rotation: IosSnapshotRotation =
    logicalWidth > logicalHeight
      ? orientation === "landscape-right"
        ? "right"
        : "left"
      : orientation === "portrait-upside-down"
        ? "upside-down"
        : "none";
  return { rotation, logicalWidth, logicalHeight };
}

/** Normalize XCTest child rects from their native buffer into the logical viewport. */
export function normalizeIosSnapshotNodes(
  nodes: SnapshotNode[],
  geometry = inferIosSnapshotGeometry(nodes),
): SnapshotNode[] {
  if (!geometry || geometry.rotation === "none") return nodes;
  const logicalWidth = geometry.logicalWidth;
  const logicalHeight = geometry.logicalHeight;
  return nodes.map((node) => {
    if (!node.rect || (node.depth === 0 && node.type === "Application")) return node;
    const rect = node.rect;
    switch (geometry.rotation) {
      case "left":
        return {
          ...node,
          rect: {
            x: rect.y,
            y: logicalHeight - (rect.x + rect.width),
            width: rect.height,
            height: rect.width,
          },
        };
      case "right":
        return {
          ...node,
          rect: {
            x: logicalWidth - (rect.y + rect.height),
            y: rect.x,
            width: rect.height,
            height: rect.width,
          },
        };
      case "upside-down":
        return {
          ...node,
          rect: {
            x: logicalWidth - (rect.x + rect.width),
            y: logicalHeight - (rect.y + rect.height),
            width: rect.width,
            height: rect.height,
          },
        };
      case "none":
        return node;
    }
  });
}

export function pngDimensions(bytes: Buffer): { width: number; height: number } | undefined {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature)) return undefined;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : undefined;
}

/**
 * UIImage.pngData() drops imageOrientation. PNGs do not carry EXIF orientation the
 * way JPEGs do, so landscape XCUIScreenshots often land sideways or upside-down
 * unless orientation is baked at encode time
 * (@see https://eorvain-app.medium.com/image-orientation-on-ios-abaf8321820b).
 *
 * agent-device's runner tries to bake via UIGraphicsImageRenderer; on some physical
 * iPads the buffer still arrives 180° off in landscape. Correct that from the
 * device interface orientation — a stable signal — not from pixel heuristics.
 */
export type IosDisplayOrientation =
  | "portrait"
  | "portrait-upside-down"
  | "landscape-left"
  | "landscape-right"
  | "unknown";

/** Map CoreDevice / UIDevice orientation tokens into a small enum. */
export function parseIosDisplayOrientation(raw: string | undefined | null): IosDisplayOrientation {
  if (!raw) return "unknown";
  const value = raw
    .trim()
    .toLowerCase()
    .replace(/[_\s-]/g, "");
  if (value === "portrait" || value === "rot0" || value === "up" || value === "faceup") {
    return "portrait";
  }
  if (value === "portraitupsidedown" || value === "rot180" || value === "down") {
    return "portrait-upside-down";
  }
  // UIDevice landscapeLeft = home button on the right. CoreDevice: rot270.
  if (value === "landscapeleft" || value === "rot270" || value === "left") {
    return "landscape-left";
  }
  // UIDevice landscapeRight = home button on the left. CoreDevice: rot90.
  if (value === "landscaperight" || value === "rot90" || value === "right") {
    return "landscape-right";
  }
  return "unknown";
}

/**
 * Bake screenshot pixels to match the device interface orientation.
 *
 * Simple, no pixel heuristics (UIImage.pngData drops orientation —
 * https://eorvain-app.medium.com/image-orientation-on-ios-abaf8321820b):
 *
 * - Portrait buffer + landscape interface → one 90° turn (direction from side)
 * - Landscape buffer + landscape interface → preserve pixels; raster and AX already agree
 * - Portrait interface → force portrait aspect only
 */
export function normalizeScreenshotToBounds(
  bytes: Buffer,
  bounds?: { width: number; height: number },
  displayOrientation?: IosDisplayOrientation | string | null,
): Buffer {
  const orientation = parseIosDisplayOrientation(
    displayOrientation == null ? undefined : String(displayOrientation),
  );
  const dimensions = pngDimensions(bytes);
  if (!dimensions) return bytes;

  const pixelsLandscape = dimensions.width > dimensions.height;
  const interfaceLandscape =
    orientation === "landscape-left" || orientation === "landscape-right"
      ? true
      : orientation === "portrait" || orientation === "portrait-upside-down"
        ? false
        : bounds
          ? bounds.width > bounds.height
          : undefined;

  // Aspect disagrees with interface → exactly one 90° correction.
  if (interfaceLandscape === true && !pixelsLandscape) {
    // landscapeLeft (rot270) needs CW; landscapeRight (rot90) needs CCW.
    // Verified on physical iPad Pro 10.5 + AgentDeviceRunner portrait buffers.
    return orientation === "landscape-right"
      ? rotatePng90CounterClockwise(bytes)
      : rotatePng90Clockwise(bytes);
  }
  if (interfaceLandscape === false && pixelsLandscape) {
    return rotatePng90Clockwise(bytes);
  }

  // A same-aspect raster is already in the XCTest interaction coordinate space.
  // Rotating it from interface orientation alone makes pixels and AX disagree:
  // rot90 describes how the physical panel is held, not an encoded PNG transform.
  if (interfaceLandscape === true && pixelsLandscape) {
    return bytes;
  }
  if (orientation === "portrait-upside-down") {
    return rotatePng180(bytes);
  }

  // Legacy: bounds-only aspect fix when orientation is unknown.
  if (
    interfaceLandscape === undefined &&
    bounds &&
    bounds.width !== bounds.height &&
    bounds.width > bounds.height !== pixelsLandscape
  ) {
    return rotatePng90Clockwise(bytes);
  }
  return bytes;
}

function rotatePng90Clockwise(bytes: Buffer): Buffer {
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

function rotatePng90CounterClockwise(bytes: Buffer): Buffer {
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
      const destinationX = source.height - y - 1;
      const destinationY = x;
      const destinationOffset = (destination.width * destinationY + destinationX) << 2;
      source.data.copy(destination.data, destinationOffset, sourceOffset, sourceOffset + 4);
    }
  }
  return PNG.sync.write(destination);
}

function rotatePng180(bytes: Buffer): Buffer {
  let source: PNG;
  try {
    source = PNG.sync.read(bytes);
  } catch {
    return bytes;
  }
  const destination = new PNG({ width: source.width, height: source.height });
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const sourceOffset = (source.width * y + x) << 2;
      const destinationOffset =
        (destination.width * (source.height - 1 - y) + (source.width - 1 - x)) << 2;
      source.data.copy(destination.data, destinationOffset, sourceOffset, sourceOffset + 4);
    }
  }
  return PNG.sync.write(destination);
}
