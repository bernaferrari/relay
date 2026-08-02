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
  return (
    relativeDifference(a.width, b.width) <= 0.08 && relativeDifference(a.height, b.height) <= 0.08
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
