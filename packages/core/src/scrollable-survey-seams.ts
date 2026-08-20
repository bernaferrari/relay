/**
 * Pixel and semantic seam proof for a scroll survey.
 *
 * This module has no device commands. It derives only from the raw PNG/tree
 * pairs already captured by the caller, so it is safe to reuse for offline
 * regeneration and cannot turn an ambiguous iOS scroll into a compensating
 * action.
 */
import { PNG } from "pngjs";
import type { SnapshotNode } from "./device.js";
import type { SnapshotPayload } from "./workspace-capture.js";

export type ScrollSurveySeam = { shiftY: number; confidence: number };

function decodeImage(bytes: Buffer): PNG | undefined {
  try {
    return PNG.sync.read(bytes);
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

export function normalizedSemanticPart(value?: string): string {
  return (value ?? "").trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}

export function isSystemSemantic(node: SnapshotNode): boolean {
  const role = normalizedSemanticPart(node.role ?? node.type);
  const bundleId = normalizedSemanticPart(node.bundleId);
  const identifier = normalizedSemanticPart(node.identifier);
  return (
    bundleId === "com.android.systemui" ||
    identifier.startsWith("com.android.systemui:id/") ||
    /status.?bar|keyboard|input.?method|system.?window/u.test(role)
  );
}

export function semanticNodeKey(node: SnapshotNode): string | undefined {
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
    return { shiftY: sorted[Math.floor(sorted.length / 2)]!, members };
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

/** Prove no content movement when visual pixels are animated or noisy. */
export function semanticViewportIsStationary(
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
): ScrollSurveySeam | undefined {
  const left = decodeImage(previous);
  const right = decodeImage(current);
  if (
    !left ||
    !right ||
    left.width !== right.width ||
    left.height !== right.height ||
    left.height < 120
  )
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
