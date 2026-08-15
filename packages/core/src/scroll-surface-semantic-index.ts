import type {
  ScrollSurfaceSemanticAnchor,
  ScrollSurfaceSemanticIndex,
  StepTarget,
} from "@relay/protocol";
import type { SnapshotNode } from "./device.js";
import type { ScrollSurveyFrame } from "./scrollable-survey.js";

function normalized(value?: string): string | undefined {
  const result = value?.trim().replace(/\s+/gu, " ").toLocaleLowerCase();
  return result || undefined;
}

function semanticTarget(node: SnapshotNode): StepTarget | undefined {
  const identifier = node.identifier?.trim();
  if (identifier) return { identifier };
  const label = node.label?.trim().replace(/\s+/gu, " ");
  if (label) return { label };
  const text = node.value?.trim().replace(/\s+/gu, " ");
  if (text) return { text };
  // Native refs are session-local implementation details. Keep them only as
  // a last-resort anchor when a node has no durable human semantic value.
  const ref = node.ref?.replace(/^@/u, "").trim();
  return ref ? { ref } : undefined;
}

export function semanticTargetKey(target: StepTarget): string | undefined {
  const identifier = normalized(target.identifier);
  if (identifier) return `identifier:${identifier}`;
  const ref = normalized(target.ref?.replace(/^@/u, ""));
  if (ref) return `ref:${ref}`;
  const label = normalized(target.label);
  if (label) return `label:${label}`;
  const text = normalized(target.text);
  return text ? `text:${text}` : undefined;
}

export function semanticTargetMatches(left: StepTarget, right: StepTarget): boolean {
  return semanticTargetKey(left) === semanticTargetKey(right);
}

/** Compile ordered document coordinates from the already merged raw trees.
 * Duplicate selectors are omitted because they cannot safely identify a live
 * viewport anchor. Geometry is intentionally derived, never authoritative. */
export function compileScrollSurfaceSemanticIndex(input: {
  nodes: SnapshotNode[];
  frames: Pick<ScrollSurveyFrame, "offsetY" | "screenshot" | "snapshot">[];
  compositeHeight?: number;
}): ScrollSurfaceSemanticIndex {
  const positionsByKey = new Map<string, Array<{ frame: number; y: number }>>();
  input.frames.forEach((frame, frameIndex) => {
    for (const node of frame.snapshot.nodes) {
      const target = node.rect ? semanticTarget(node) : undefined;
      const key = target ? semanticTargetKey(target) : undefined;
      if (!key || !node.rect || node.visibleToUser === false) continue;
      const positions = positionsByKey.get(key) ?? [];
      positions.push({ frame: frameIndex, y: node.rect.y });
      positionsByKey.set(key, positions);
    }
  });
  const stickyKeys = new Set(
    [...positionsByKey.entries()].flatMap(([key, positions]) => {
      const frames = new Set(positions.map((position) => position.frame));
      const minY = Math.min(...positions.map((position) => position.y));
      const maxY = Math.max(...positions.map((position) => position.y));
      return frames.size > 1 && maxY - minY <= 4 ? [key] : [];
    }),
  );
  const candidates = input.nodes
    .flatMap((node) => {
      if (
        !node.rect ||
        node.visibleToUser === false ||
        node.rect.width <= 0 ||
        node.rect.height <= 0
      ) {
        return [];
      }
      const target = semanticTarget(node);
      const key = target ? semanticTargetKey(target) : undefined;
      if (!target || !key || stickyKeys.has(key)) return [];
      const role = normalized(node.role ?? node.type);
      if (/status.?bar|keyboard|input.?method|system.?window/u.test(role ?? "")) return [];
      return [{ key, target, documentY: Math.round(node.rect.y + node.rect.height / 2) }];
    })
    .sort((left, right) => left.documentY - right.documentY || left.key.localeCompare(right.key));
  const counts = new Map<string, number>();
  for (const candidate of candidates)
    counts.set(candidate.key, (counts.get(candidate.key) ?? 0) + 1);
  const anchors: ScrollSurfaceSemanticAnchor[] = candidates
    .filter((candidate) => counts.get(candidate.key) === 1)
    .map((candidate, order) => ({
      order,
      documentY: candidate.documentY,
      target: candidate.target,
    }));
  const viewportHeight = Math.max(1, input.frames[0]?.screenshot.height ?? 1);
  const capturedHeight = input.frames.reduce(
    (height, frame) => Math.max(height, frame.offsetY + frame.screenshot.height),
    viewportHeight,
  );
  const semanticHeight = anchors.reduce(
    (height, anchor) => Math.max(height, anchor.documentY + 1),
    viewportHeight,
  );
  return {
    schemaVersion: 1,
    documentHeight: Math.max(input.compositeHeight ?? 0, capturedHeight, semanticHeight),
    viewportHeight,
    anchors,
  };
}
