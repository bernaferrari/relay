import { PNG } from "pngjs";
import type { SnapshotNode } from "./device.js";
import type { SnapshotPayload } from "./workspace-capture.js";
import {
  isSystemSemantic,
  normalizedSemanticPart,
  semanticNodeKey,
  verticalScrollSeam,
} from "./scrollable-survey-seams.js";
import { surveyStitchCutY } from "./scrollable-survey-advance.js";
import type {
  ScrollSurveyCapture,
  ScrollSurveyFrame,
  ScrollSurveyResult,
} from "./scrollable-survey-types.js";

export type ScrollSurveyComposition = {
  frames: ScrollSurveyFrame[];
  stitched?: ScrollSurveyResult["stitched"];
  mergedNodes: SnapshotNode[];
};

function decodeFrame(frame: ScrollSurveyFrame): PNG | undefined {
  try {
    return PNG.sync.read(Buffer.from(frame.screenshot.base64, "base64"));
  } catch {
    return undefined;
  }
}

export function pageAnchor(snapshot: SnapshotPayload): string | undefined {
  if (!snapshot.inspectable || !snapshot.bounds) return undefined;
  const cutoff = snapshot.bounds.height * 0.24;
  const anchors = snapshot.nodes
    .filter(
      (node) => node.visibleToUser !== false && (node.rect?.y ?? Number.POSITIVE_INFINITY) < cutoff,
    )
    .flatMap((node) => {
      const stable = node.identifier?.trim() || node.ref?.trim();
      const role = (node.role ?? node.type ?? "").trim();
      return stable && role ? [`${role}:${stable}`] : [];
    })
    .sort();
  return anchors.length ? anchors.join("|") : undefined;
}

function structuralAnchors(snapshot: SnapshotPayload): Set<string> {
  const anchors = new Set<string>();
  for (const node of snapshot.nodes) {
    if (node.visibleToUser === false || isSystemSemantic(node)) continue;
    const role = normalizedSemanticPart(node.role ?? node.type);
    const stable = normalizedSemanticPart(node.identifier ?? node.ref);
    if (
      stable &&
      (/application|scroll|list|table|collection|web.?view/u.test(role) || (node.depth ?? 99) <= 1)
    ) {
      anchors.add(`${role}:${stable}`);
    } else if (/application|scroll|list|table|collection|web.?view/u.test(role)) {
      const label = normalizedSemanticPart(node.label);
      if (label) anchors.add(`${role}:text:${label}`);
    }
  }
  return anchors;
}

function meaningfulSemantics(snapshot: SnapshotPayload): Set<string> {
  const semantics = new Set<string>();
  for (const node of snapshot.nodes) {
    if (node.visibleToUser === false || isSystemSemantic(node)) continue;
    const role = normalizedSemanticPart(node.role ?? node.type) || "node";
    const stable = normalizedSemanticPart(node.identifier ?? node.ref);
    const label = normalizedSemanticPart(node.label);
    const value = normalizedSemanticPart(node.value);
    if (stable) semantics.add(`${role}:id:${stable}`);
    else if (label || value) semantics.add(`${role}:text:${label}:${value}`);
  }
  return semantics;
}

function overlap(left: Set<string>, right: Set<string>): { count: number; ratio: number } {
  let count = 0;
  for (const value of left) if (right.has(value)) count += 1;
  return { count, ratio: count / Math.max(1, Math.min(left.size, right.size)) };
}

export function surveySurfaceIsIdentifiable(snapshot: SnapshotPayload): boolean {
  return Boolean(
    pageAnchor(snapshot) ||
    structuralAnchors(snapshot).size > 0 ||
    meaningfulSemantics(snapshot).size >= 3,
  );
}

export function sameSurveySurface(first: SnapshotPayload, next: SnapshotPayload): boolean {
  if (!next.inspectable) return false;
  if (first.foregroundApp && next.foregroundApp && first.foregroundApp !== next.foregroundApp) {
    return false;
  }
  const initialAnchor = pageAnchor(first);
  const nextAnchor = pageAnchor(next);
  if (initialAnchor && nextAnchor && initialAnchor === nextAnchor) return true;

  const structural = overlap(structuralAnchors(first), structuralAnchors(next));
  const semantic = overlap(meaningfulSemantics(first), meaningfulSemantics(next));
  // Some native sheets expose no identifier on their fixed header. Preserve
  // the conservative screen boundary by requiring several independent,
  // non-system semantics in addition to the same foreground app/root. The
  // visual seam remains a separate mandatory check before a frame is accepted.
  const meaningfulOverlap = semantic.count >= 3 && semantic.ratio >= 0.35;
  return meaningfulOverlap && structural.count > 0;
}

/** Restoration is proven only by a same-surface identity plus a pixel seam
 * with zero vertical movement. Semantic stationary hints stay review-only:
 * sticky controls inside a list can be stationary while unlabeled content
 * moves, so they must never certify a document-origin return. */
export function startViewportMatches(
  start: ScrollSurveyCapture,
  restored: ScrollSurveyCapture,
): boolean {
  if (!sameSurveySurface(start.snapshot, restored.snapshot)) return false;
  const startFingerprint = start.snapshot.screenIdentity?.fingerprint;
  const restoredFingerprint = restored.snapshot.screenIdentity?.fingerprint;
  if (startFingerprint && restoredFingerprint && startFingerprint !== restoredFingerprint) {
    return false;
  }
  const seam = verticalScrollSeam(
    Buffer.from(start.screenshot.base64, "base64"),
    Buffer.from(restored.screenshot.base64, "base64"),
    start.snapshot,
    restored.snapshot,
  );
  return Boolean(seam && seam.shiftY === 0);
}

function bottomSystemChromeTop(frame: ScrollSurveyFrame): number | undefined {
  const labels = new Set<string>();
  let top = frame.screenshot.height;
  for (const node of frame.snapshot.nodes) {
    if (!node.rect || node.rect.y < frame.screenshot.height * 0.8) continue;
    const label = normalizedSemanticPart(node.label);
    const identifier = normalizedSemanticPart(node.identifier);
    const navigationSemantic = /^(back|home|recents|overview)$/u.test(label)
      ? label
      : /com\.android\.systemui:id\/(?:navigationbar|navigation_bar|nav_buttons|back|home|recent_apps)$/u.test(
            identifier,
          )
        ? identifier
        : undefined;
    if (!navigationSemantic) continue;
    labels.add(navigationSemantic);
    top = Math.min(top, node.rect.y);
  }
  return labels.size >= 2 ? Math.max(0, Math.floor(top)) : undefined;
}

function mergedSurveyNodes(frames: ScrollSurveyFrame[]): SnapshotNode[] {
  const seen = new Set<string>();
  const merged: SnapshotNode[] = [];
  const sticky = new Map<string, number>();
  for (const node of frames[0]?.snapshot.nodes ?? []) {
    const key = node.rect ? semanticNodeKey(node) : undefined;
    if (key && node.rect) sticky.set(key, node.rect.y);
  }
  for (const [frameIndex, frame] of frames.entries()) {
    const bottomChrome = bottomSystemChromeTop(frame);
    for (const node of frame.snapshot.nodes) {
      if (!node.rect || node.visibleToUser === false) continue;
      if (
        bottomChrome !== undefined &&
        frameIndex < frames.length - 1 &&
        node.rect.y >= bottomChrome
      )
        continue;
      const semanticKey = semanticNodeKey(node);
      if (
        frameIndex > 0 &&
        semanticKey &&
        sticky.has(semanticKey) &&
        Math.abs(sticky.get(semanticKey)! - node.rect.y) <= 4
      )
        continue;
      const rect = { ...node.rect, y: node.rect.y + frame.offsetY };
      const key = [
        node.identifier ?? node.ref ?? node.label ?? node.value ?? node.type ?? node.role ?? "node",
        Math.round(rect.x / 4),
        Math.round(rect.y / 4),
        Math.round(rect.width / 4),
        Math.round(rect.height / 4),
      ].join(":");
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({ ...node, rect, parentIndex: undefined, index: undefined });
    }
  }
  return merged;
}

/** Merge accessibility nodes using already-validated explicit document
 * offsets. Unlike visual composition, this never guesses or changes seams. */
export function mergeScrollSurfaceNodes(frames: ScrollSurveyFrame[]): SnapshotNode[] {
  return mergedSurveyNodes(frames);
}

function stitchSurveyFrames(
  frames: ScrollSurveyFrame[],
): ScrollSurveyResult["stitched"] | undefined {
  const decoded = frames.map(decodeFrame);
  const first = decoded[0];
  if (
    !first ||
    decoded.some((image) => !image || image.width !== first.width || image.height !== first.height)
  ) {
    return undefined;
  }
  const pieces = frames.map((frame, index) => {
    const bottomChrome = bottomSystemChromeTop(frame) ?? frame.screenshot.height;
    const cutY =
      index === frames.length - 1
        ? frame.screenshot.height
        : surveyStitchCutY(frame.snapshot, bottomChrome);
    if (index === 0) {
      return { sourceY: 0, height: frames.length === 1 ? frame.screenshot.height : cutY };
    }
    const previous = frames[index - 1]!;
    const previousChrome = bottomSystemChromeTop(previous) ?? previous.screenshot.height;
    const previousCut = surveyStitchCutY(previous.snapshot, previousChrome);
    const sourceY = Math.max(0, previousCut - frame.appendedHeight);
    return { sourceY, height: Math.max(0, cutY - sourceY) };
  });
  const height = pieces.reduce((total, piece) => total + piece.height, 0);
  if (first.width * height > 28_000_000) return undefined;
  const output = new PNG({ width: first.width, height });
  let targetY = 0;
  for (const [index, image] of decoded.entries()) {
    const { sourceY, height: copyHeight } = pieces[index]!;
    for (let y = 0; y < copyHeight; y += 1) {
      image!.data.copy(
        output.data,
        (targetY + y) * first.width * 4,
        (sourceY + y) * first.width * 4,
        (sourceY + y + 1) * first.width * 4,
      );
    }
    targetY += copyHeight;
  }
  return {
    base64: PNG.sync.write(output).toString("base64"),
    width: first.width,
    height,
    mime: "image/png",
  };
}

/** Recalculate all derived geometry from canonical raw PNG/tree pairs. Stored
 * offsets are hints only; regeneration and new captures share this path. */
export function composeScrollSurveyFrames(
  inputFrames: ScrollSurveyFrame[],
): ScrollSurveyComposition | undefined {
  const frames = inputFrames.map((frame, index) => ({
    ...frame,
    index,
    offsetY: 0,
    appendedHeight: 0,
  }));
  for (let index = 1; index < frames.length; index += 1) {
    const previous = frames[index - 1]!;
    const current = frames[index]!;
    const seam = verticalScrollSeam(
      Buffer.from(previous.screenshot.base64, "base64"),
      Buffer.from(current.screenshot.base64, "base64"),
      previous.snapshot,
      current.snapshot,
    );
    if (!seam || seam.shiftY <= 0) return undefined;
    current.appendedHeight = seam.shiftY;
    current.offsetY = previous.offsetY + seam.shiftY;
  }
  return { frames, stitched: stitchSurveyFrames(frames), mergedNodes: mergedSurveyNodes(frames) };
}
