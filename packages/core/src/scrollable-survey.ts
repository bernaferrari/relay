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

export type ScrollSurveyStopReason =
  | "end-of-content"
  | "screen-changed"
  | "inspection-unavailable"
  | "missing-page-anchor"
  | "seam-ambiguous"
  | "dimension-changed"
  | "scroll-failed"
  | "restore-failed"
  | "limit-reached";

export type ScrollSurveyFrame = {
  index: number;
  offsetY: number;
  screenshot: { base64: string; width: number; height: number; capturedAt: number };
  snapshot: SnapshotPayload;
  /** How much new vertical content this frame contributed to the stitch. */
  appendedHeight: number;
};

export type ScrollSurveyResult = {
  status: "completed" | "stopped";
  reason: ScrollSurveyStopReason;
  frames: ScrollSurveyFrame[];
  /** Captured candidates rejected from the logical surface. These remain raw,
   * decomposable evidence and never contribute to the composite or tree. */
  diagnosticFrames: ScrollSurveyFrame[];
  /** A composite preview only. Original frames remain authoritative evidence. */
  stitched?: { base64: string; width: number; height: number; mime: "image/png" };
  /** Leaf semantics translated into the stitched document coordinate space. */
  mergedNodes: SnapshotNode[];
  restoredStartViewport: boolean;
  message: string;
};

export type ScrollSurveyDriver = {
  capture(): Promise<{
    screenshot: { base64: string; width?: number; height?: number; capturedAt: number };
    snapshot: SnapshotPayload;
  }>;
  scrollDown(): Promise<void>;
  scrollUp(): Promise<void>;
  settle(): Promise<void>;
};

export type ScrollSurveyCapture = Awaited<ReturnType<ScrollSurveyDriver["capture"]>>;

export type ScrollSurveyOptions = {
  maxScrolls?: number;
  /** Fresh PNG/tree pair already verified before this survey. The caller owns
   * freshness; captureScrollableSurvey still applies every normal anchor,
   * seam, screen-boundary, and restoration check. */
  initialCapture?: ScrollSurveyCapture;
};

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

type Seam = { shiftY: number; confidence: number };

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

function sampleDifference(left: PNG, right: PNG, shiftY: number): number {
  const top = Math.floor(left.height * 0.14);
  const bottom = Math.floor(left.height * 0.88);
  const start = Math.max(shiftY + top, top);
  const end = Math.min(bottom, shiftY + bottom);
  if (end - start < 24) return Number.POSITIVE_INFINITY;
  let total = 0;
  let count = 0;
  for (let yi = 0; yi < 24; yi += 1) {
    const y = Math.round(start + ((end - start - 1) * yi) / 23);
    const otherY = y - shiftY;
    for (let xi = 1; xi < 13; xi += 1) {
      const x = Math.round((left.width * xi) / 14);
      const leftOffset = (y * left.width + x) * 4;
      const rightOffset = (otherY * right.width + x) * 4;
      total += Math.abs(left.data[leftOffset]! - right.data[rightOffset]!);
      total += Math.abs(left.data[leftOffset + 1]! - right.data[rightOffset + 1]!);
      total += Math.abs(left.data[leftOffset + 2]! - right.data[rightOffset + 2]!);
      count += 3;
    }
  }
  return count ? total / count : Number.POSITIVE_INFINITY;
}

/** Estimate scroll distance from the overlap of two native screenshots. */
function semanticNodeKey(node: SnapshotNode): string | undefined {
  const stable = normalizedSemanticPart(node.identifier ?? node.ref);
  const role = normalizedSemanticPart(node.role ?? node.type);
  if (stable) return `${role}:id:${stable}`;
  const label = normalizedSemanticPart(node.label);
  const value = normalizedSemanticPart(node.value);
  return label || value ? `${role}:text:${label}:${value}` : undefined;
}

function uniqueSemanticPositions(snapshot: SnapshotPayload) {
  const positions = new Map<string, { x: number; y: number; width: number; height: number }>();
  const duplicates = new Set<string>();
  for (const node of snapshot.nodes) {
    const role = normalizedSemanticPart(node.role ?? node.type);
    const identifier = normalizedSemanticPart(node.identifier);
    const label = normalizedSemanticPart(node.label);
    const value = normalizedSemanticPart(node.value);
    const semanticKey = identifier
      ? `${role}:id:${identifier}`
      : label || value
        ? `${role}:text:${label}:${value}`
        : undefined;
    const key =
      node.rect && node.visibleToUser !== false && !isSystemSemantic(node)
        ? semanticKey
        : undefined;
    if (!key) continue;
    if (positions.has(key)) duplicates.add(key);
    else positions.set(key, node.rect!);
  }
  for (const key of duplicates) positions.delete(key);
  return positions;
}

function semanticScrollShift(
  previous: SnapshotPayload,
  current: SnapshotPayload,
): { shiftY: number; support: number; confidence: number } | undefined {
  const before = uniqueSemanticPositions(previous);
  const after = uniqueSemanticPositions(current);
  const candidates: Array<{ shiftY: number; previousY: number }> = [];
  for (const [key, left] of before) {
    const right = after.get(key);
    if (!right) continue;
    const shift = Math.round(left.y - right.y);
    if (
      shift < 12 ||
      shift > Math.min(previous.bounds?.height ?? 0, current.bounds?.height ?? 0) * 0.85
    )
      continue;
    candidates.push({ shiftY: shift, previousY: left.y });
  }
  const clusters = candidates.map((candidate) => {
    const members = candidates.filter((other) => Math.abs(other.shiftY - candidate.shiftY) <= 4);
    const sorted = members.map(({ shiftY }) => shiftY).sort((left, right) => left - right);
    return {
      shiftY: sorted[Math.floor(sorted.length / 2)]!,
      members,
    };
  });
  const best = clusters.sort(
    (left, right) => right.members.length - left.members.length || left.shiftY - right.shiftY,
  )[0];
  if (!best) return undefined;
  const support = best.members.length;
  const confidence = support / Math.max(1, candidates.length);
  const verticalSpan =
    Math.max(...best.members.map(({ previousY }) => previousY)) -
    Math.min(...best.members.map(({ previousY }) => previousY));
  return support >= 3 && confidence >= 0.7 && verticalSpan >= 80
    ? { shiftY: best.shiftY, support, confidence }
    : undefined;
}

/** Prove that a completed scroll gesture did not move the content even when
 * animated pixels make the visual seam unusable. This deliberately requires
 * broad agreement across unique, non-system semantics: a few sticky controls
 * are not enough to turn an uncertain moved viewport into end-of-content. */
function semanticViewportIsStationary(
  previous: SnapshotPayload,
  current: SnapshotPayload,
): boolean {
  const before = uniqueSemanticPositions(previous);
  const after = uniqueSemanticPositions(current);
  const deltas: Array<{ x: number; y: number; width: number; height: number }> = [];
  for (const [key, left] of before) {
    const right = after.get(key);
    if (!right) continue;
    deltas.push({
      x: Math.abs(left.x - right.x),
      y: Math.abs(left.y - right.y),
      width: Math.abs(left.width - right.width),
      height: Math.abs(left.height - right.height),
    });
  }
  const support = deltas.length;
  const coverage = support / Math.max(1, Math.min(before.size, after.size));
  const stationary = deltas.filter(
    (delta) => delta.x <= 4 && delta.y <= 4 && delta.width <= 4 && delta.height <= 4,
  ).length;
  return support >= 3 && coverage >= 0.7 && stationary / support >= 0.9;
}

/** Accessibility geometry can prove a seam when several unique anchors move
 * by one strongly agreed translation. Otherwise pixels remain mandatory. */
export function verticalScrollSeam(
  previous: Buffer,
  current: Buffer,
  previousSnapshot?: SnapshotPayload,
  currentSnapshot?: SnapshotPayload,
): Seam | undefined {
  let left: PNG;
  let right: PNG;
  try {
    left = PNG.sync.read(previous);
    right = PNG.sync.read(current);
  } catch {
    return undefined;
  }
  if (left.width !== right.width || left.height !== right.height || left.height < 120)
    return undefined;
  const unchanged = sampleDifference(left, right, 0);
  const semantic =
    previousSnapshot && currentSnapshot
      ? semanticScrollShift(previousSnapshot, currentSnapshot)
      : undefined;
  if (semantic) return { shiftY: semantic.shiftY, confidence: semantic.confidence };
  // Status-bar clocks are cropped, but sticky headers and Compose shimmer still
  // live in the sampled band. A mean per-channel delta under 8/255 is bounce or
  // chrome noise, not a new viewport — treating it as motion made Settings
  // inverse-swipe off the page when the first fling rubber-banded.
  if (unchanged < 8) return { shiftY: 0, confidence: 1 };
  const minimum = Math.max(24, Math.round(left.height * 0.07));
  const maximum = Math.floor(left.height * 0.82);
  const stride = Math.max(8, Math.round(left.height * 0.009));
  const candidates: Array<{ shiftY: number; score: number }> = [];
  for (let shiftY = minimum; shiftY <= maximum; shiftY += stride) {
    candidates.push({ shiftY, score: sampleDifference(left, right, shiftY) });
  }
  candidates.sort((a, b) => a.score - b.score || a.shiftY - b.shiftY);
  const coarse = candidates[0];
  if (!coarse || !Number.isFinite(coarse.score)) return undefined;
  let best = coarse;
  for (
    let shiftY = Math.max(minimum, coarse.shiftY - stride);
    shiftY <= Math.min(maximum, coarse.shiftY + stride);
    shiftY += 1
  ) {
    const score = sampleDifference(left, right, shiftY);
    if (score < best.score) best = { shiftY, score };
  }
  const alternate = candidates.find(
    (candidate) => Math.abs(candidate.shiftY - best.shiftY) > stride * 2,
  );
  const separation = alternate ? Math.max(0, alternate.score - best.score) : best.score;
  const confidence = Math.max(
    0,
    Math.min(1, (1 - best.score / 32) * 0.75 + Math.min(1, separation / 12) * 0.25),
  );
  return confidence >= 0.7 ? { shiftY: best.shiftY, confidence } : undefined;
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

function normalizedSemanticPart(value?: string): string {
  return (value ?? "").trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}

function isSystemSemantic(node: SnapshotNode): boolean {
  const role = normalizedSemanticPart(node.role ?? node.type);
  const bundleId = normalizedSemanticPart(node.bundleId);
  const identifier = normalizedSemanticPart(node.identifier);
  return (
    bundleId === "com.android.systemui" ||
    identifier.startsWith("com.android.systemui:id/") ||
    /status.?bar|keyboard|input.?method|system.?window/u.test(role)
  );
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
      settle,
    },
    {
      maxScrolls: input.maxScrolls,
      ...(input.initialCapture ? { initialCapture: input.initialCapture } : {}),
    },
  );
}

export async function captureScrollableSurvey(
  driver: ScrollSurveyDriver,
  options: ScrollSurveyOptions = {},
): Promise<ScrollSurveyResult> {
  const maxScrolls = Math.max(1, Math.min(6, options.maxScrolls ?? 4));
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
  let restorationStarted = false;
  const restoreOnce = async () => {
    if (restorationStarted) return;
    restorationStarted = true;
    for (let index = 0; index < owedMovements; index += 1) {
      try {
        await driver.scrollUp();
      } catch {
        restored = false;
        continue;
      }
      try {
        await driver.settle();
      } catch {
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
  try {
    for (let index = 0; index < maxScrolls; index += 1) {
      try {
        attemptedScroll = true;
        await driver.scrollDown();
        // The target may have moved as soon as the driver resolves. From this
        // point every exit owes exactly one inverse movement.
        owedMovements += 1;
        await driver.settle();
      } catch {
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
      } catch {
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
  } finally {
    await restoreOnce();
  }
  if (unexpected !== undefined) throw unexpected;
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
      const proved =
        owedMovements > 0 || !lastPostAttemptCapture
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
    } catch {
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
