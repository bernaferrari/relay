/**
 * A bounded, evidence-first capture of a long native viewport.
 *
 * This is deliberately not a blind “full page screenshot”: every stitched
 * section retains the exact original PNG and accessibility snapshot that
 * produced it. When the page, seam, or accessibility tree becomes uncertain,
 * collection stops and returns the reason instead of continuing to scroll.
 */
import { PNG } from "pngjs";
import type { SnapshotNode } from "./device.js";
import { interact } from "./workspace-interact.js";
import { devicePlatformForSerial } from "./workspace-devices.js";
import { captureScreenshot, captureSnapshot, type SnapshotPayload } from "./workspace-capture.js";
import {
  IosMutationOutcomeUnknownError,
  rethrowIosMutationOutcomeUnknown,
} from "./ios-mutation-policy.js";
import {
  isSystemSemantic,
  normalizedSemanticPart,
  semanticNodeKey,
  semanticViewportIsStationary,
  verticalScrollSeam,
} from "./scrollable-survey-seams.js";

import type {
  ScrollSurveyCapture,
  ScrollSurveyDriver,
  ScrollSurveyFrame,
  ScrollSurveyOptions,
  ScrollSurveyResult,
  ScrollSurveyStopReason,
} from "./scrollable-survey-types.js";

export type {
  ScrollSurveyCapture,
  ScrollSurveyDriver,
  ScrollSurveyFrame,
  ScrollSurveyOptions,
  ScrollSurveyResult,
  ScrollSurveyStopReason,
} from "./scrollable-survey-types.js";
export { verticalScrollSeam } from "./scrollable-survey-seams.js";

/**
 * A scroll command may have moved an iOS viewport even when XCTest lost its
 * acknowledgement. These raw frames are deliberately retained with the
 * terminal error so a reviewer can inspect the last proven viewport without
 * issuing a compensating scroll.
 */
export type ScrollSurveyOutcomeUnknownDiagnostic = {
  schemaVersion: 1;
  status: "interrupted";
  reason: "ios-mutation-outcome-unknown";
  message: string;
  frames: ScrollSurveyFrame[];
  diagnosticFrames: ScrollSurveyFrame[];
  restoredStartViewport: false;
  restoration: {
    attempted: false;
    reason: "iOS mutation outcome is unknown";
  };
};

const outcomeUnknownDiagnostics = new WeakMap<object, ScrollSurveyOutcomeUnknownDiagnostic>();

function attachScrollSurveyOutcomeUnknownDiagnostic(
  error: unknown,
  frames: ScrollSurveyFrame[],
  diagnosticFrames: ScrollSurveyFrame[],
): void {
  if (!(error instanceof IosMutationOutcomeUnknownError)) return;
  outcomeUnknownDiagnostics.set(error, {
    schemaVersion: 1,
    status: "interrupted",
    reason: "ios-mutation-outcome-unknown",
    message:
      "An iOS scroll may already have moved the viewport. Relay retained the captured frames and did not attempt restoration.",
    frames: structuredClone(frames),
    diagnosticFrames: structuredClone(diagnosticFrames),
    restoredStartViewport: false,
    restoration: {
      attempted: false,
      reason: "iOS mutation outcome is unknown",
    },
  });
}

/** Returns raw, decomposable survey evidence attached to an uncertain iOS scroll. */
export function scrollSurveyOutcomeUnknownDiagnostic(
  error: unknown,
): ScrollSurveyOutcomeUnknownDiagnostic | undefined {
  if (!error || (typeof error !== "object" && typeof error !== "function")) return undefined;
  const diagnostic = outcomeUnknownDiagnostics.get(error);
  return diagnostic ? structuredClone(diagnostic) : undefined;
}
export function scrollSurveyGesture(
  platform: "android" | "ios",
  bounds: { width: number; height: number },
  direction: "down" | "up",
) {
  // Android turns a fast half-screen swipe into a fling; Settings physically
  // skipped 1857px after the old 1170px gesture, leaving only two overlapping
  // anchors. A slow quarter-screen drag keeps enough old content visible to
  // prove the seam. XCTest does not share Android's fling behavior.
  const lower = platform === "android" ? 0.68 : 0.78;
  const upper = platform === "android" ? 0.42 : 0.28;
  const fromY = bounds.height * (direction === "down" ? lower : upper);
  const toY = bounds.height * (direction === "down" ? upper : lower);
  return {
    kind: "swipe" as const,
    from: { x: bounds.width * 0.5, y: fromY },
    to: { x: bounds.width * 0.5, y: toY },
    durationMs: platform === "android" ? 800 : 360,
  };
}

/** A single Android restoration fling. It is intentionally separate from the
 * overlap-heavy capture drag: collection needs a small, seam-friendly move;
 * returning to a proven document origin benefits from distance. */
export function scrollSurveyFastRestoreGesture(
  platform: "android" | "ios",
  bounds: { width: number; height: number },
) {
  if (platform !== "android") return scrollSurveyGesture(platform, bounds, "up");
  return {
    kind: "swipe" as const,
    from: { x: bounds.width * 0.5, y: bounds.height * 0.86 },
    to: { x: bounds.width * 0.5, y: bounds.height * 0.14 },
    durationMs: 180,
  };
}

type Composition = {
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

function pageAnchor(snapshot: SnapshotPayload): string | undefined {
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

function surveySurfaceIsIdentifiable(snapshot: SnapshotPayload): boolean {
  return Boolean(
    pageAnchor(snapshot) ||
    structuralAnchors(snapshot).size > 0 ||
    meaningfulSemantics(snapshot).size >= 3,
  );
}

function sameSurveySurface(first: SnapshotPayload, next: SnapshotPayload): boolean {
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

/** Restoration is proven only when the live viewport matches the frozen start
 * semantically and visually. Inverse swipes that settle are not enough. */
function startViewportMatches(start: ScrollSurveyCapture, restored: ScrollSurveyCapture): boolean {
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
  return Boolean(
    (seam && seam.shiftY === 0) || semanticViewportIsStationary(start.snapshot, restored.snapshot),
  );
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
    if (index === 0) {
      return { sourceY: 0, height: frames.length === 1 ? frame.screenshot.height : bottomChrome };
    }
    const sourceY = Math.max(0, bottomChrome - frame.appendedHeight);
    const end = index === frames.length - 1 ? frame.screenshot.height : bottomChrome;
    return { sourceY, height: Math.max(0, end - sourceY) };
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
): Composition | undefined {
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

function result(
  frames: ScrollSurveyFrame[],
  status: ScrollSurveyResult["status"],
  reason: ScrollSurveyStopReason,
  message: string,
  restoredStartViewport: boolean,
  diagnosticFrames: ScrollSurveyFrame[] = [],
): ScrollSurveyResult {
  const composition = composeScrollSurveyFrames(frames);
  const composedFrames = composition?.frames ?? frames;
  const stitched = reason === "seam-ambiguous" ? undefined : composition?.stitched;
  return {
    status,
    reason,
    frames: composedFrames,
    diagnosticFrames,
    ...(stitched ? { stitched } : {}),
    mergedNodes: composition?.mergedNodes ?? mergedSurveyNodes(frames),
    restoredStartViewport,
    message,
  };
}

/**
 * Device-backed survey used by the local API. It scrolls only after the first
 * inspectable frame proves a stable page anchor, captures PNG then AX in that
 * order (safe for the single-channel physical iOS runner), and returns to the
 * precise starting viewport on every non-destructive exit.
 */
export async function captureScrollableSurveyForTarget(input: {
  serial: string;
  maxScrolls?: number;
  initialCapture?: ScrollSurveyCapture;
  initialViewport?: "proven-document-origin";
  provenDocumentOrigin?: ScrollSurveyCapture;
}): Promise<ScrollSurveyResult> {
  const platform = await devicePlatformForSerial(input.serial);
  if (platform !== "android" && platform !== "ios") {
    throw new Error(`Target ${input.serial} is not an available Android or iOS device.`);
  }
  let bounds = { width: 1080, height: 2340 };
  const settle = () =>
    new Promise<void>((resolve) => setTimeout(resolve, platform === "ios" ? 700 : 350));
  return captureScrollableSurvey(
    {
      capture: async () => {
        const screenshot = await captureScreenshot({
          serial: input.serial,
          ephemeral: true,
          includeScreenMatch: false,
        });
        const snapshot = await captureSnapshot({ serial: input.serial });
        if (snapshot.bounds) bounds = snapshot.bounds;
        return { screenshot, snapshot };
      },
      scrollDown: async () => {
        await interact(scrollSurveyGesture(platform, bounds, "down"), { serial: input.serial });
      },
      scrollUp: async () => {
        await interact(scrollSurveyGesture(platform, bounds, "up"), { serial: input.serial });
      },
      scrollUpFast: async () => {
        await interact(scrollSurveyFastRestoreGesture(platform, bounds), { serial: input.serial });
      },
      settle,
    },
    {
      maxScrolls: input.maxScrolls,
      ...(input.initialCapture ? { initialCapture: input.initialCapture } : {}),
      ...(input.initialViewport ? { initialViewport: input.initialViewport } : {}),
      ...(input.provenDocumentOrigin ? { provenDocumentOrigin: input.provenDocumentOrigin } : {}),
    },
  );
}

export async function captureScrollableSurvey(
  driver: ScrollSurveyDriver,
  options: ScrollSurveyOptions = {},
): Promise<ScrollSurveyResult> {
  const maxScrolls = Math.max(1, Math.min(12, options.maxScrolls ?? 4));
  const first = options.initialCapture ?? (await driver.capture());
  const initial: ScrollSurveyFrame = {
    index: 0,
    offsetY: 0,
    screenshot: {
      base64: first.screenshot.base64,
      width: first.screenshot.width ?? 0,
      height: first.screenshot.height ?? 0,
      capturedAt: first.screenshot.capturedAt,
    },
    snapshot: first.snapshot,
    appendedHeight: 0,
  };
  const frames = [initial];
  const diagnosticFrames: ScrollSurveyFrame[] = [];
  if (options.provenDocumentOrigin && !startViewportMatches(options.provenDocumentOrigin, first)) {
    return result(
      frames,
      "stopped",
      "start-viewport-unproven",
      "The live viewport differs from the frozen document origin; Relay did not scroll it.",
      true,
    );
  }
  if (!first.snapshot.inspectable) {
    return result(
      frames,
      "stopped",
      "inspection-unavailable",
      "Accessibility is unavailable; no scroll survey was started.",
      true,
    );
  }
  if (!surveySurfaceIsIdentifiable(first.snapshot)) {
    return result(
      frames,
      "stopped",
      "missing-page-anchor",
      "The visible page has no stable accessibility structure, so Relay did not scroll it.",
      true,
    );
  }
  let restored = true;
  let owedMovements = 0;
  let attemptedScroll = false;
  let lastPostAttemptCapture: ScrollSurveyCapture | undefined;
  let provedRestoration: ScrollSurveyCapture | undefined;
  let restorationStarted = false;
  const restoreOnce = async () => {
    if (restorationStarted) return;
    restorationStarted = true;
    if (owedMovements > 0 && options.initialViewport === "proven-document-origin") {
      if (!driver.scrollUpFast) {
        restored = false;
        return;
      }
      // Three strong Android flings cover the current longest surveyed
      // product surfaces while remaining bounded. Each is followed by an
      // exact origin proof, so a changed layout can never silently look
      // restored just because a gesture settled.
      for (let index = 0; index < 3; index += 1) {
        try {
          await driver.scrollUpFast();
          await driver.settle();
          const candidate = await driver.capture();
          if (startViewportMatches(first, candidate)) {
            provedRestoration = candidate;
            owedMovements = 0;
            return;
          }
        } catch (error) {
          rethrowIosMutationOutcomeUnknown(error);
          restored = false;
          return;
        }
      }
      restored = false;
      return;
    }
    for (let index = 0; index < owedMovements; index += 1) {
      try {
        await driver.scrollUp();
      } catch (error) {
        rethrowIosMutationOutcomeUnknown(error);
        restored = false;
        continue;
      }
      try {
        await driver.settle();
      } catch (error) {
        rethrowIosMutationOutcomeUnknown(error);
        restored = false;
      }
    }
  };
  let decision: {
    status: ScrollSurveyResult["status"];
    reason: ScrollSurveyStopReason;
    message: string;
  } = {
    status: "stopped",
    reason: "limit-reached",
    message:
      "Relay reached the configured survey limit; inspect the saved viewports before collecting more.",
  };
  let unexpected: unknown;
  let hasUnexpected = false;
  try {
    for (let index = 0; index < maxScrolls; index += 1) {
      try {
        attemptedScroll = true;
        await driver.scrollDown();
        // The target may have moved as soon as the driver resolves. From this
        // point every exit owes exactly one inverse movement.
        owedMovements += 1;
        await driver.settle();
      } catch (error) {
        rethrowIosMutationOutcomeUnknown(error);
        decision = {
          status: "stopped",
          reason: "scroll-failed",
          message: "Scrolling failed; original captured viewports were retained.",
        };
        break;
      }

      let next: Awaited<ReturnType<ScrollSurveyDriver["capture"]>>;
      try {
        next = await driver.capture();
        lastPostAttemptCapture = next;
      } catch (error) {
        rethrowIosMutationOutcomeUnknown(error);
        decision = {
          status: "stopped",
          reason: "scroll-failed",
          message: "Capturing the scrolled viewport failed; Relay restored the starting viewport.",
        };
        break;
      }
      const previous = frames.at(-1)!;
      if (!sameSurveySurface(first.snapshot, next.snapshot)) {
        diagnosticFrames.push(candidateFrame(next, frames.length, previous.offsetY));
        decision = {
          status: "stopped",
          reason: "screen-changed",
          message:
            "The scroll changed to a different screen; Relay stopped before stitching unrelated content.",
        };
        break;
      }
      const width = next.screenshot.width ?? 0;
      const height = next.screenshot.height ?? 0;
      if (width !== previous.screenshot.width || height !== previous.screenshot.height) {
        diagnosticFrames.push(candidateFrame(next, frames.length, previous.offsetY));
        decision = {
          status: "stopped",
          reason: "dimension-changed",
          message:
            "The viewport dimensions changed while scrolling; Relay stopped before stitching.",
        };
        break;
      }
      const seam = verticalScrollSeam(
        Buffer.from(previous.screenshot.base64, "base64"),
        Buffer.from(next.screenshot.base64, "base64"),
        previous.snapshot,
        next.snapshot,
      );
      if (!seam) {
        if (semanticViewportIsStationary(previous.snapshot, next.snapshot)) {
          // The gesture resolved but accessibility proves the document did not
          // move. Dynamic images/video can invalidate pixel overlap without
          // creating a second viewport, so no inverse gesture is owed.
          owedMovements -= 1;
          decision = {
            status: "completed",
            reason: "end-of-content",
            message: "Captured the complete visible list and restored the original viewport.",
          };
          break;
        }
        diagnosticFrames.push(candidateFrame(next, frames.length, previous.offsetY));
        decision = {
          status: "stopped",
          reason: "seam-ambiguous",
          message:
            "Relay could not verify the visual overlap between scroll viewports; review the original frames before continuing.",
        };
        break;
      }
      if (seam.shiftY === 0) {
        // The matching viewport proves this scrollDown resolved without moving
        // the target. Discharge its provisional inverse so restoration stops
        // exactly at the starting viewport, including when capture began
        // partway through a list.
        owedMovements -= 1;
        decision = {
          status: "completed",
          reason: "end-of-content",
          message: "Captured the complete visible list and restored the original viewport.",
        };
        break;
      }
      const offsetY = previous.offsetY + seam.shiftY;
      frames.push({
        index: frames.length,
        offsetY,
        screenshot: {
          base64: next.screenshot.base64,
          width,
          height,
          capturedAt: next.screenshot.capturedAt,
        },
        snapshot: next.snapshot,
        appendedHeight: seam.shiftY,
      });
    }
  } catch (error) {
    unexpected = error;
    hasUnexpected = true;
  } finally {
    if (unexpected instanceof IosMutationOutcomeUnknownError) {
      attachScrollSurveyOutcomeUnknownDiagnostic(unexpected, frames, diagnosticFrames);
    } else {
      try {
        await restoreOnce();
      } catch (error) {
        attachScrollSurveyOutcomeUnknownDiagnostic(error, frames, diagnosticFrames);
        unexpected = error;
        hasUnexpected = true;
      }
    }
  }
  if (hasUnexpected) throw unexpected;
  if (!restored) {
    return result(
      frames,
      "stopped",
      "restore-failed",
      "Relay stopped safely, but could not restore every captured scroll movement.",
      false,
      diagnosticFrames,
    );
  }
  if (attemptedScroll) {
    try {
      const proved = provedRestoration
        ? provedRestoration
        : owedMovements > 0 || !lastPostAttemptCapture
          ? await driver.capture()
          : lastPostAttemptCapture;
      if (!startViewportMatches(first, proved)) {
        return result(
          frames,
          decision.status,
          decision.reason,
          `${decision.message} Starting viewport was not proven after restore.`,
          false,
          diagnosticFrames,
        );
      }
    } catch (error) {
      if (error instanceof IosMutationOutcomeUnknownError) {
        attachScrollSurveyOutcomeUnknownDiagnostic(error, frames, diagnosticFrames);
        throw error;
      }
      return result(
        frames,
        decision.status,
        decision.reason,
        `${decision.message} Starting viewport could not be recaptured after restore.`,
        false,
        diagnosticFrames,
      );
    }
  }
  return result(frames, decision.status, decision.reason, decision.message, true, diagnosticFrames);
}

function candidateFrame(
  capture: ScrollSurveyCapture,
  index: number,
  offsetY: number,
): ScrollSurveyFrame {
  return {
    index,
    offsetY,
    appendedHeight: 0,
    screenshot: {
      base64: capture.screenshot.base64,
      width: capture.screenshot.width ?? 0,
      height: capture.screenshot.height ?? 0,
      capturedAt: capture.screenshot.capturedAt,
    },
    snapshot: capture.snapshot,
  };
}
