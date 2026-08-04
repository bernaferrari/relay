import type { RecipeStep, RecordedNodeEvidence } from "@relay/protocol";
import type { CanvasInteractionAnchor } from "./app-map-canvas-layout";

/**
 * Project the first recorded tap in a transition into normalized canvas
 * coordinates. Keeping this in one place is important: the live canvas,
 * persisted App Map projection, and any future grid view must agree about
 * which element was acted on.
 */
export function normalizedAnchorForStep(
  step: RecipeStep | undefined,
): CanvasInteractionAnchor | undefined {
  if (step?.kind !== "tap") return undefined;

  const evidence = step.evidence;
  const candidates = [evidence?.node, ...(evidence?.nodes ?? [])].filter(
    (candidate): candidate is RecordedNodeEvidence => Boolean(candidate?.rect),
  );
  const matchesTarget = (candidate: RecordedNodeEvidence) => {
    if (step.target.identifier && candidate.identifier === step.target.identifier) return true;
    if (step.target.ref && candidate.ref === step.target.ref) return true;
    if (
      step.target.label &&
      (candidate.label === step.target.label || candidate.value === step.target.label)
    ) {
      return true;
    }
    if (
      step.target.text &&
      (candidate.value === step.target.text || candidate.label === step.target.text)
    ) {
      return true;
    }
    return false;
  };

  // A point-only target may still carry a full tree. Do not highlight the
  // first arbitrary node in that tree; only the explicit recorded node or an
  // exact semantic match is trustworthy enough to paint on the screenshot.
  const targetNode =
    candidates.find(matchesTarget) ?? (evidence?.node?.rect ? evidence.node : undefined);
  const inferredBounds = candidates.reduce(
    (bounds, candidate) => {
      const rect = candidate.rect!;
      return {
        width: Math.max(bounds.width, rect.x + rect.width),
        height: Math.max(bounds.height, rect.y + rect.height),
      };
    },
    { width: 0, height: 0 },
  );
  const bounds =
    evidence?.deviceBounds ??
    step.target.point?.referenceBounds ??
    (inferredBounds.width && inferredBounds.height ? inferredBounds : undefined);
  if (!bounds?.width || !bounds.height) return undefined;

  const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));
  const rect = targetNode?.rect;
  const point =
    evidence?.pointer ??
    step.target.point ??
    (rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : undefined);
  if (!point) return undefined;

  const normalizedPoint = {
    x: clamp(point.x, bounds.width) / bounds.width,
    y: clamp(point.y, bounds.height) / bounds.height,
  };
  const normalizedRect = rect
    ? {
        x: clamp(rect.x, bounds.width) / bounds.width,
        y: clamp(rect.y, bounds.height) / bounds.height,
        width:
          (clamp(rect.x + rect.width, bounds.width) - clamp(rect.x, bounds.width)) / bounds.width,
        height:
          (clamp(rect.y + rect.height, bounds.height) - clamp(rect.y, bounds.height)) /
          bounds.height,
      }
    : undefined;

  return {
    point: normalizedPoint,
    ...(normalizedRect?.width && normalizedRect.height ? { rect: normalizedRect } : {}),
  };
}
