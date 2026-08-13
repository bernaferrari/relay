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

export type ScrollSurveyOptions = { maxScrolls?: number };

type Seam = { shiftY: number; confidence: number };

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
export function verticalScrollSeam(previous: Buffer, current: Buffer): Seam | undefined {
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
  if (unchanged < 2.5) return { shiftY: 0, confidence: 1 };
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

function sameSurveySurface(first: SnapshotPayload, next: SnapshotPayload): boolean {
  if (!next.inspectable) return false;
  if (first.foregroundApp && next.foregroundApp && first.foregroundApp !== next.foregroundApp) {
    return false;
  }
  const initialAnchor = pageAnchor(first);
  const nextAnchor = pageAnchor(next);
  return Boolean(initialAnchor && nextAnchor && initialAnchor === nextAnchor);
}

function mergedSurveyNodes(frames: ScrollSurveyFrame[]): SnapshotNode[] {
  const seen = new Set<string>();
  const merged: SnapshotNode[] = [];
  for (const frame of frames) {
    for (const node of frame.snapshot.nodes) {
      if (!node.rect || node.visibleToUser === false) continue;
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
  const height = frames.reduce(
    (total, frame, index) => total + (index === 0 ? frame.screenshot.height : frame.appendedHeight),
    0,
  );
  if (first.width * height > 28_000_000) return undefined;
  const output = new PNG({ width: first.width, height });
  let targetY = 0;
  for (const [index, image] of decoded.entries()) {
    const sourceY = index === 0 ? 0 : image!.height - frames[index]!.appendedHeight;
    const copyHeight = index === 0 ? image!.height : frames[index]!.appendedHeight;
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

function result(
  frames: ScrollSurveyFrame[],
  status: ScrollSurveyResult["status"],
  reason: ScrollSurveyStopReason,
  message: string,
  restoredStartViewport: boolean,
): ScrollSurveyResult {
  const stitched = stitchSurveyFrames(frames);
  return {
    status,
    reason,
    frames,
    ...(stitched ? { stitched } : {}),
    mergedNodes: mergedSurveyNodes(frames),
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
        await interact(
          {
            kind: "swipe",
            from: { x: bounds.width * 0.5, y: bounds.height * 0.78 },
            to: { x: bounds.width * 0.5, y: bounds.height * 0.28 },
            durationMs: 360,
          },
          { serial: input.serial },
        );
      },
      scrollUp: async () => {
        await interact(
          {
            kind: "swipe",
            from: { x: bounds.width * 0.5, y: bounds.height * 0.28 },
            to: { x: bounds.width * 0.5, y: bounds.height * 0.78 },
            durationMs: 360,
          },
          { serial: input.serial },
        );
      },
      settle,
    },
    { maxScrolls: input.maxScrolls },
  );
}

export async function captureScrollableSurvey(
  driver: ScrollSurveyDriver,
  options: ScrollSurveyOptions = {},
): Promise<ScrollSurveyResult> {
  const maxScrolls = Math.max(1, Math.min(6, options.maxScrolls ?? 4));
  const first = await driver.capture();
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
  if (!first.snapshot.inspectable) {
    return result(
      frames,
      "stopped",
      "inspection-unavailable",
      "Accessibility is unavailable; no scroll survey was started.",
      true,
    );
  }
  if (!pageAnchor(first.snapshot)) {
    return result(
      frames,
      "stopped",
      "missing-page-anchor",
      "The visible page has no stable accessibility anchor, so Relay did not scroll it.",
      true,
    );
  }
  let restored = true;
  let successfulScrolls = 0;
  const restore = async () => {
    for (let index = 0; index < successfulScrolls; index += 1) {
      try {
        await driver.scrollUp();
        await driver.settle();
      } catch {
        restored = false;
        break;
      }
    }
  };
  for (let index = 0; index < maxScrolls; index += 1) {
    try {
      await driver.scrollDown();
      await driver.settle();
    } catch {
      await restore();
      return result(
        frames,
        "stopped",
        "scroll-failed",
        "Scrolling failed; original captured viewports were retained.",
        restored,
      );
    }
    const next = await driver.capture();
    if (!sameSurveySurface(first.snapshot, next.snapshot)) {
      await restore();
      return result(
        frames,
        "stopped",
        "screen-changed",
        "The scroll changed to a different screen; Relay stopped before stitching unrelated content.",
        restored,
      );
    }
    const previous = frames.at(-1)!;
    const seam = verticalScrollSeam(
      Buffer.from(previous.screenshot.base64, "base64"),
      Buffer.from(next.screenshot.base64, "base64"),
    );
    if (!seam) {
      await restore();
      return result(
        frames,
        "stopped",
        "seam-ambiguous",
        "Relay could not verify the visual overlap between scroll viewports; review the original frames before continuing.",
        restored,
      );
    }
    if (seam.shiftY === 0) {
      await restore();
      return result(
        frames,
        "completed",
        "end-of-content",
        "Captured the complete visible list and restored the original viewport.",
        restored,
      );
    }
    const offsetY = previous.offsetY + seam.shiftY;
    frames.push({
      index: frames.length,
      offsetY,
      screenshot: {
        base64: next.screenshot.base64,
        width: next.screenshot.width ?? 0,
        height: next.screenshot.height ?? 0,
        capturedAt: next.screenshot.capturedAt,
      },
      snapshot: next.snapshot,
      appendedHeight: seam.shiftY,
    });
    successfulScrolls += 1;
  }
  await restore();
  return result(
    frames,
    "stopped",
    "limit-reached",
    "Relay reached the configured survey limit; inspect the saved viewports before collecting more.",
    restored,
  );
}
