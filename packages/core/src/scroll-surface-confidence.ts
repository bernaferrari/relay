import type {
  ScrollSurfaceClassification,
  ScrollSurfaceConfidenceModel,
  ScrollSurfaceContainerIdentity,
  ScrollSurfaceMergeAnchor,
  ScrollSurfaceRegion,
  StepTarget,
} from "@relay/protocol";
import type { SnapshotNode } from "./device.js";
import {
  isSystemSemantic,
  semanticNodeKey,
  verticalScrollSeam,
} from "./scrollable-survey-seams.js";
import type { ScrollSurveyFrame, ScrollSurveyResult } from "./scrollable-survey-types.js";

type ConfidenceInput = Pick<
  ScrollSurveyResult,
  "status" | "reason" | "frames" | "diagnosticFrames"
>;

function classificationFor(input: ConfidenceInput): ScrollSurfaceClassification {
  if (input.status === "completed" && input.reason === "end-of-content") return "complete";
  if (
    input.reason === "inspection-unavailable" ||
    input.reason === "missing-page-anchor" ||
    input.reason === "dimension-changed"
  ) {
    return "unsupported";
  }
  if (input.reason === "seam-ambiguous" && input.diagnosticFrames.length > 0) return "dynamic";
  return "partial";
}

function targetFor(node: SnapshotNode): StepTarget | undefined {
  const identifier = node.identifier?.trim();
  if (identifier) return { identifier };
  const ref = node.ref?.trim();
  if (ref) return { ref };
  const label = node.label?.trim();
  if (label) return { label };
  return undefined;
}

function mergeAnchors(frames: ScrollSurveyFrame[]): ScrollSurfaceMergeAnchor[] {
  const anchors: ScrollSurfaceMergeAnchor[] = [];
  for (let index = 1; index < frames.length; index += 1) {
    const previous = frames[index - 1]!;
    const current = frames[index]!;
    const derived = verticalScrollSeam(
      Buffer.from(previous.screenshot.base64, "base64"),
      Buffer.from(current.screenshot.base64, "base64"),
      previous.snapshot,
      current.snapshot,
    );
    const shiftY = derived?.shiftY ?? current.appendedHeight;
    if (shiftY <= 0) continue;
    anchors.push({
      fromViewportIndex: previous.index,
      toViewportIndex: current.index,
      documentY: current.offsetY,
      shiftY,
      confidence: derived?.confidence ?? 0.7,
      basis: derived ? "semantic-or-visual" : "capture-offset",
    });
  }
  return anchors;
}

function stickyRegions(frames: ScrollSurveyFrame[]): ScrollSurfaceRegion[] {
  if (frames.length < 2) return [];
  const candidates = new Map<
    string,
    {
      node: SnapshotNode;
      viewportIndexes: number[];
      rect: NonNullable<SnapshotNode["rect"]>;
    }
  >();
  for (const frame of frames) {
    const seenInFrame = new Set<string>();
    for (const node of frame.snapshot.nodes) {
      const key = node.rect && !isSystemSemantic(node) ? semanticNodeKey(node) : undefined;
      const role = (node.role ?? node.type ?? "").toLocaleLowerCase();
      if (
        !key ||
        !node.rect ||
        seenInFrame.has(key) ||
        /root|window|scroll|list|table|collection|recycler|web.?view|container|frame.?layout|view.?group|linear.?layout|relative.?layout|constraint.?layout/u.test(
          role,
        )
      ) {
        continue;
      }
      seenInFrame.add(key);
      const existing = candidates.get(key);
      if (!existing) {
        candidates.set(key, { node, viewportIndexes: [frame.index], rect: node.rect });
        continue;
      }
      if (
        Math.abs(existing.rect.x - node.rect.x) <= 4 &&
        Math.abs(existing.rect.y - node.rect.y) <= 4 &&
        Math.abs(existing.rect.width - node.rect.width) <= 4 &&
        Math.abs(existing.rect.height - node.rect.height) <= 4
      ) {
        existing.viewportIndexes.push(frame.index);
      }
    }
  }
  return [...candidates.values()]
    .filter(({ viewportIndexes }) => viewportIndexes.length >= 2)
    .slice(0, 64)
    .map(({ node, viewportIndexes, rect }) => ({
      kind: "sticky" as const,
      coordinateSpace: "viewport" as const,
      rect: structuredClone(rect),
      confidence: viewportIndexes.length / frames.length,
      sourceViewportIndexes: viewportIndexes,
      ...(targetFor(node) ? { target: targetFor(node)! } : {}),
      reason: "Semantic element remained at the same viewport position across captured scrolls.",
    }));
}

function dynamicRegions(
  classification: ScrollSurfaceClassification,
  frames: ScrollSurveyFrame[],
  diagnostics: ScrollSurveyFrame[],
): ScrollSurfaceRegion[] {
  if (classification !== "dynamic") return [];
  const candidate = diagnostics[0] ?? frames.at(-1);
  if (!candidate) return [];
  return [
    {
      kind: "dynamic",
      coordinateSpace: "viewport",
      rect: { x: 0, y: 0, width: candidate.screenshot.width, height: candidate.screenshot.height },
      confidence: 0.7,
      sourceViewportIndexes: diagnostics.map(({ index }) => index),
      reason: "Captured candidate could not produce a stable visual or semantic merge seam.",
    },
  ];
}

function scrollContainer(frames: ScrollSurveyFrame[]): ScrollSurfaceContainerIdentity | undefined {
  if (frames.length === 0) return undefined;
  const matches = new Map<string, { node: SnapshotNode; indexes: number[]; nested: boolean }>();
  for (const frame of frames) {
    const nodesByIndex = new Map(
      frame.snapshot.nodes.flatMap((node) =>
        typeof node.index === "number" ? ([[node.index, node]] as const) : [],
      ),
    );
    for (const node of frame.snapshot.nodes) {
      const role = (node.role ?? node.type ?? "").toLocaleLowerCase();
      if (!/scroll|list|table|collection|recycler|web.?view/u.test(role)) continue;
      const key = semanticNodeKey(node);
      const target = targetFor(node);
      if (!key || !target) continue;
      const existing = matches.get(key);
      const nested =
        typeof node.parentIndex === "number" && nodesByIndex.has(node.parentIndex)
          ? nodesByIndex.get(node.parentIndex)?.parentIndex !== undefined
          : false;
      if (existing) existing.indexes.push(frame.index);
      else matches.set(key, { node, indexes: [frame.index], nested });
    }
  }
  const best = [...matches.values()].sort(
    (left, right) => right.indexes.length - left.indexes.length,
  )[0];
  const target = best ? targetFor(best.node) : undefined;
  if (!best || !target) return undefined;
  return {
    target,
    ...(best.node.role || best.node.type ? { role: best.node.role ?? best.node.type } : {}),
    ...(best.node.rect ? { viewportRect: structuredClone(best.node.rect) } : {}),
    nested: best.nested,
    confidence: best.indexes.length / frames.length,
    sourceViewportIndexes: best.indexes,
  };
}

function baseConfidence(
  classification: ScrollSurfaceClassification,
  anchors: ScrollSurfaceMergeAnchor[],
): number {
  const anchorConfidence = anchors.length
    ? anchors.reduce((total, anchor) => total + anchor.confidence, 0) / anchors.length
    : 1;
  const classificationWeight = {
    complete: 0.98,
    partial: 0.72,
    dynamic: 0.4,
    unsupported: 0.15,
  }[classification];
  return Math.round(Math.min(classificationWeight, anchorConfidence) * 100) / 100;
}

/** Build an additive review model from raw evidence and explicit terminal
 * facts. Unknown remaining length stays open; no derived geometry upgrades the
 * capture's original status, stop reason, or origin proof. */
export function deriveScrollSurfaceConfidence(
  input: ConfidenceInput,
): ScrollSurfaceConfidenceModel {
  const classification = classificationFor(input);
  const anchors = mergeAnchors(input.frames);
  const capturedPixels = input.frames.reduce(
    (maximum, frame) => Math.max(maximum, frame.offsetY + frame.screenshot.height),
    0,
  );
  const complete = classification === "complete";
  const capturedState = classification === "dynamic" ? "dynamic" : "captured";
  const container = scrollContainer(input.frames);
  return {
    schemaVersion: 1,
    classification,
    confidence: baseConfidence(classification, anchors),
    capturedPixels,
    documentExtent: complete ? "known" : "open",
    coverage: [
      ...(capturedPixels > 0
        ? [
            {
              startY: 0,
              endY: capturedPixels,
              state: capturedState,
              confidence: classification === "dynamic" ? 0.4 : 1,
              sourceViewportIndexes: input.frames.map(({ index }) => index),
            } as const,
          ]
        : []),
      ...(!complete
        ? [
            {
              startY: capturedPixels,
              endY: null,
              state: "not-reached" as const,
              confidence: 1,
              sourceViewportIndexes: [],
            },
          ]
        : []),
    ],
    mergeAnchors: anchors,
    regions: [
      ...stickyRegions(input.frames),
      ...dynamicRegions(classification, input.frames, input.diagnosticFrames),
    ],
    ...(container ? { scrollContainer: container } : {}),
  };
}
