import type { RecordedNodeEvidence, RecordedStepEvidence, StepTarget } from "./api-types";

export type TargetAnchor = "top-left" | "top-right" | "center" | "bottom-left" | "bottom-right";

export const TARGET_ANCHORS: { id: TargetAnchor; label: string }[] = [
  { id: "top-left", label: "Top left" },
  { id: "top-right", label: "Top right" },
  { id: "center", label: "Center" },
  { id: "bottom-left", label: "Bottom left" },
  { id: "bottom-right", label: "Bottom right" },
];

export function targetHierarchy(
  evidence: RecordedStepEvidence | undefined,
): RecordedNodeEvidence[] {
  if (!evidence?.node) return [];
  return [evidence.node, ...(evidence.ancestors ?? [])].filter((node) => Boolean(node.rect));
}

export function targetNodeIndex(
  evidence: RecordedStepEvidence | undefined,
  target: StepTarget,
): number {
  const hierarchy = targetHierarchy(evidence);
  const exact = hierarchy.findIndex((node) => {
    if (target.ref && node.ref === target.ref) return true;
    if (target.label && (node.label === target.label || node.value === target.label)) return true;
    if (target.text && (node.value === target.text || node.label === target.text)) return true;
    return false;
  });
  if (exact >= 0) return exact;
  if (!target.point) return 0;
  const containing = hierarchy.findIndex((node) => {
    const rect = node.rect;
    return (
      rect &&
      target.point!.x >= rect.x &&
      target.point!.x <= rect.x + rect.width &&
      target.point!.y >= rect.y &&
      target.point!.y <= rect.y + rect.height
    );
  });
  return containing >= 0 ? containing : 0;
}

/** Resolve a Figma-style anchor to a tap-safe point just inside the bounds. */
export function pointForAnchor(
  node: RecordedNodeEvidence,
  anchor: TargetAnchor,
): { x: number; y: number } | undefined {
  const rect = node.rect;
  if (!rect) return undefined;
  const insetX = Math.min(12, Math.max(1, rect.width * 0.08));
  const insetY = Math.min(12, Math.max(1, rect.height * 0.08));
  const left = rect.x + insetX;
  const right = rect.x + rect.width - insetX;
  const top = rect.y + insetY;
  const bottom = rect.y + rect.height - insetY;
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;

  switch (anchor) {
    case "top-left":
      return { x: Math.round(left), y: Math.round(top) };
    case "top-right":
      return { x: Math.round(right), y: Math.round(top) };
    case "center":
      return { x: Math.round(centerX), y: Math.round(centerY) };
    case "bottom-left":
      return { x: Math.round(left), y: Math.round(bottom) };
    case "bottom-right":
      return { x: Math.round(right), y: Math.round(bottom) };
  }
}

export function targetHighlight(
  node: RecordedNodeEvidence | undefined,
  bounds: { width: number; height: number } | undefined,
): { left: string; top: string; width: string; height: string } | undefined {
  if (!node?.rect || !bounds?.width || !bounds.height) return undefined;
  return {
    left: `${(node.rect.x / bounds.width) * 100}%`,
    top: `${(node.rect.y / bounds.height) * 100}%`,
    width: `${(node.rect.width / bounds.width) * 100}%`,
    height: `${(node.rect.height / bounds.height) * 100}%`,
  };
}

export function recordedNodeName(node: RecordedNodeEvidence | undefined): string {
  return (node?.label ?? node?.value ?? node?.identifier ?? "").trim() || "Unlabelled element";
}
