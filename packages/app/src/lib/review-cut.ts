/**
 * A review cut is a non-destructive view of captured video.  It points back
 * into the original media rather than creating a second, lossy video file.
 * That keeps an audit-quality recording available while making everyday
 * review much faster.
 */
export type ReviewCutReason = "action" | "visual-change" | "wait";

export type ReviewCutSegment = {
  startMs: number;
  endMs: number;
  reasons: ReviewCutReason[];
};

export type ReviewCut = {
  sourceDurationMs: number;
  reviewDurationMs: number;
  skippedDurationMs: number;
  segments: ReviewCutSegment[];
};

export type ReviewCutStep = {
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  kind?: string;
  frames?: Array<{ capturedAt?: number }>;
};

const LEAD_IN_MS = 700;
const SETTLE_MS = 1_200;
const VISUAL_CONTEXT_MS = 900;
const MIN_IDLE_GAP_MS = 2_500;

type Candidate = ReviewCutSegment;

function clamp(value: number, max: number): number {
  return Math.max(0, Math.min(max, value));
}

function addCandidate(
  candidates: Candidate[],
  sourceDurationMs: number,
  startMs: number,
  endMs: number,
  reason: ReviewCutReason,
): void {
  const start = clamp(Math.min(startMs, endMs), sourceDurationMs);
  const end = clamp(Math.max(startMs, endMs), sourceDurationMs);
  if (end <= start) return;
  candidates.push({ startMs: start, endMs: end, reasons: [reason] });
}

/**
 * Build a compact review timeline from durable trace timestamps.  Every action
 * receives a small lead-in and settle period; screenshot/frame timestamps add
 * visual context; explicit wait-like steps are never collapsed.  An idle gap
 * must exceed MIN_IDLE_GAP_MS before it is skipped, which avoids a jumpy cut.
 */
export function deriveReviewCut(input: {
  sourceDurationMs: number;
  sourceStartedAt?: number;
  steps: ReviewCutStep[];
  evidenceEvents?: Array<{ at?: number; kind?: string }>;
}): ReviewCut | null {
  const duration = Math.max(0, Math.round(input.sourceDurationMs));
  if (duration < MIN_IDLE_GAP_MS * 2 || input.steps.length === 0) return null;

  const sourceStartedAt = input.sourceStartedAt ?? 0;
  const toOffset = (at: number | undefined) =>
    at == null ? undefined : Math.max(0, at - sourceStartedAt);
  const candidates: Candidate[] = [];

  for (const step of input.steps) {
    const started = toOffset(step.startedAt);
    if (started == null) continue;
    const finished = toOffset(step.finishedAt) ?? started + Math.max(0, step.durationMs ?? 0);
    const waitLike = ["sleep", "wait-for", "wait-response", "pause"].includes(step.kind ?? "");
    addCandidate(
      candidates,
      duration,
      started - LEAD_IN_MS,
      finished + SETTLE_MS,
      waitLike ? "wait" : "action",
    );
    for (const frame of step.frames ?? []) {
      const at = toOffset(frame.capturedAt);
      if (at != null) {
        addCandidate(
          candidates,
          duration,
          at - VISUAL_CONTEXT_MS,
          at + VISUAL_CONTEXT_MS,
          "visual-change",
        );
      }
    }
  }

  for (const event of input.evidenceEvents ?? []) {
    // Evidence events mark a known visual moment even if the trace step did
    // not carry an inline screenshot (for example a collector-side frame).
    if (!/frame|screenshot|capture\.started|capture\.stopped/i.test(event.kind ?? "")) continue;
    const at = toOffset(event.at);
    if (at != null) {
      addCandidate(
        candidates,
        duration,
        at - VISUAL_CONTEXT_MS,
        at + VISUAL_CONTEXT_MS,
        "visual-change",
      );
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const segments: ReviewCutSegment[] = [];
  for (const candidate of candidates) {
    const previous = segments.at(-1);
    // Keep short idle windows intact.  A review cut should feel like one calm
    // recording, not a montage of individual events.
    if (previous && candidate.startMs - previous.endMs < MIN_IDLE_GAP_MS) {
      previous.endMs = Math.max(previous.endMs, candidate.endMs);
      previous.reasons = [...new Set([...previous.reasons, ...candidate.reasons])];
    } else {
      segments.push({ ...candidate });
    }
  }

  const reviewDurationMs = segments.reduce(
    (total, segment) => total + segment.endMs - segment.startMs,
    0,
  );
  const skippedDurationMs = Math.max(0, duration - reviewDurationMs);
  // Do not introduce a mode that only saves a barely perceptible moment.
  if (skippedDurationMs < MIN_IDLE_GAP_MS) return null;
  return { sourceDurationMs: duration, reviewDurationMs, skippedDurationMs, segments };
}

/** Convert a time on the shortened review rail into the original video time. */
export function reviewTimeToSourceMs(cut: ReviewCut, reviewMs: number): number {
  let remaining = Math.max(0, reviewMs);
  for (const segment of cut.segments) {
    const length = segment.endMs - segment.startMs;
    if (remaining <= length) return segment.startMs + remaining;
    remaining -= length;
  }
  return cut.segments.at(-1)?.endMs ?? 0;
}

/** Convert an original video timestamp to its position on the shortened rail. */
export function sourceTimeToReviewMs(cut: ReviewCut, sourceMs: number): number {
  const source = Math.max(0, sourceMs);
  let review = 0;
  for (const segment of cut.segments) {
    if (source <= segment.startMs) return review;
    const length = segment.endMs - segment.startMs;
    if (source <= segment.endMs) return review + source - segment.startMs;
    review += length;
  }
  return review;
}

/** Return the first source time still visible after a skipped gap. */
export function nextReviewSourceMs(cut: ReviewCut, sourceMs: number): number | null {
  const source = Math.max(0, sourceMs);
  for (const segment of cut.segments) {
    if (source < segment.startMs) return segment.startMs;
    if (source <= segment.endMs) return null;
  }
  return null;
}
