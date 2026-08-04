export type CompanionDimensions = { width: number; height: number };

export type CompanionFramePresentation = {
  dimensions: CompanionDimensions;
  orientation: "portrait" | "landscape" | "square";
  rotation: "none" | "left" | "right";
};

export type CompanionImageLayout = {
  aspectRatio: string;
  widthPercent: number;
  heightPercent: number;
  rotationDegrees: -90 | 0 | 90;
};

export type CompanionPoint = { x: number; y: number };
export type CompanionRect = CompanionPoint & { width: number; height: number };

type SnapshotRect = CompanionDimensions & { x: number; y: number };

export type CompanionSnapshotNode = {
  depth?: number;
  rect?: SnapshotRect;
};

const VALID_DIMENSION = (value: number) => Number.isFinite(value) && value > 0;

function validDimensions(value: CompanionDimensions | undefined): value is CompanionDimensions {
  return Boolean(value && VALID_DIMENSION(value.width) && VALID_DIMENSION(value.height));
}

function relativeDifference(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(a, b);
}

function dimensionsMatch(a: CompanionDimensions, b: CompanionDimensions): boolean {
  // Screenshots are pixels while XCTest geometry is points (commonly 2× or
  // 3×). Orientation depends on shape, so accept a consistent display scale
  // instead of requiring both coordinate systems to use identical units.
  const widthScale = a.width / b.width;
  const heightScale = a.height / b.height;
  return (
    VALID_DIMENSION(widthScale) &&
    VALID_DIMENSION(heightScale) &&
    relativeDifference(widthScale, heightScale) <= 0.08
  );
}

function frameOrientation(
  dimensions: CompanionDimensions,
): CompanionFramePresentation["orientation"] {
  const ratio = dimensions.width / dimensions.height;
  if (ratio > 1.08) return "landscape";
  if (ratio < 0.92) return "portrait";
  return "square";
}

/**
 * XCTest can return physical iOS screenshots in the panel's native portrait
 * pixel buffer even while the interface is landscape. The accessibility root
 * describes the intended logical viewport, so a transposed match is a strong,
 * deterministic rotation signal without guessing from the device name.
 */
export function companionFramePresentation(input: {
  frame: CompanionDimensions | undefined;
  logicalViewport: CompanionDimensions | undefined;
  platform: string | undefined;
  edge: "left" | "right" | undefined;
}): CompanionFramePresentation | undefined {
  if (!validDimensions(input.frame)) return undefined;

  let rotation: CompanionFramePresentation["rotation"] = "none";
  if (
    input.platform === "ios" &&
    validDimensions(input.logicalViewport) &&
    frameOrientation(input.frame) !== frameOrientation(input.logicalViewport) &&
    dimensionsMatch({ width: input.frame.height, height: input.frame.width }, input.logicalViewport)
  ) {
    // A status strip on the right becomes the top edge after a left rotation;
    // the inverse applies when iOS reports it along the left edge.
    rotation = input.edge === "left" ? "right" : "left";
  }

  const dimensions =
    rotation === "none" ? input.frame : { width: input.frame.height, height: input.frame.width };
  return { dimensions, orientation: frameOrientation(dimensions), rotation };
}

export function companionImageLayout(
  presentation: CompanionFramePresentation,
): CompanionImageLayout {
  const ratio = presentation.dimensions.width / presentation.dimensions.height;
  return {
    aspectRatio: `${presentation.dimensions.width} / ${presentation.dimensions.height}`,
    widthPercent: presentation.rotation === "none" ? 100 : 100 / ratio,
    heightPercent: presentation.rotation === "none" ? 100 : ratio * 100,
    rotationDegrees:
      presentation.rotation === "left" ? -90 : presentation.rotation === "right" ? 90 : 0,
  };
}

/**
 * Convert a point from the pixels people see in the companion back into the
 * logical XCTest viewport. Physical iOS screenshots can arrive in the native
 * portrait buffer while the accessibility tree and interface are landscape;
 * the image is rotated for presentation, so input must apply the exact inverse
 * transform before it is sent to the device.
 */
export function companionDisplayedPointToLogical(
  point: CompanionPoint,
  rotation: CompanionFramePresentation["rotation"],
): CompanionPoint {
  if (rotation === "left") return { x: 1 - point.y, y: point.x };
  if (rotation === "right") return { x: point.y, y: 1 - point.x };
  return point;
}

/** Convert a normalized logical point into the displayed, possibly rotated frame. */
export function companionLogicalPointToDisplayed(
  point: CompanionPoint,
  rotation: CompanionFramePresentation["rotation"],
): CompanionPoint {
  if (rotation === "left") return { x: point.y, y: 1 - point.x };
  if (rotation === "right") return { x: 1 - point.y, y: point.x };
  return point;
}

/** Project a logical accessibility rectangle onto the rotated companion. */
export function companionLogicalRectToDisplayed(
  rect: CompanionRect,
  rotation: CompanionFramePresentation["rotation"],
): CompanionRect {
  if (rotation === "left") {
    return {
      x: rect.y,
      y: 1 - rect.x - rect.width,
      width: rect.height,
      height: rect.width,
    };
  }
  if (rotation === "right") {
    return {
      x: 1 - rect.y - rect.height,
      y: rect.x,
      width: rect.height,
      height: rect.width,
    };
  }
  return rect;
}

/** Find the logical application viewport rather than the snapshot union. */
export function companionLogicalViewport(
  nodes: readonly CompanionSnapshotNode[] | undefined,
): CompanionDimensions | undefined {
  const root = nodes?.find(
    (node) =>
      node.depth === 0 &&
      node.rect &&
      VALID_DIMENSION(node.rect.width) &&
      VALID_DIMENSION(node.rect.height),
  );
  return root?.rect ? { width: root.rect.width, height: root.rect.height } : undefined;
}

/**
 * Landscape iOS snapshots expose their rotated status strip as a thin,
 * full-height edge node. Its side disambiguates left from right rotation.
 */
export function companionOrientationEdge(
  nodes: readonly CompanionSnapshotNode[] | undefined,
  logicalViewport: CompanionDimensions | undefined,
): "left" | "right" | undefined {
  if (!nodes || !validDimensions(logicalViewport)) return undefined;
  const rawWidth = Math.min(logicalViewport.width, logicalViewport.height);
  const rawHeight = Math.max(logicalViewport.width, logicalViewport.height);
  const strip = nodes.find((node) => {
    const rect = node.rect;
    if (!rect) return false;
    return (
      rect.height >= rawHeight * 0.88 &&
      rect.width <= rawWidth * 0.08 &&
      (rect.x <= rawWidth * 0.12 || rect.x + rect.width >= rawWidth * 0.88)
    );
  });
  if (!strip?.rect) return undefined;
  return strip.rect.x + strip.rect.width / 2 < rawWidth / 2 ? "left" : "right";
}

export function companionFooterMode(input: {
  deviceSelected: boolean;
  canRecord: boolean;
  arming: boolean;
  captureBusy: boolean;
}): "hidden" | "ready" | "busy" {
  if (!input.deviceSelected || input.arming) return "hidden";
  if (input.captureBusy) return "busy";
  return input.canRecord ? "ready" : "hidden";
}
