const RECORDED_PAUSE_THRESHOLD_MS = 200;
const RECORDED_PAUSE_QUANTUM_MS = 50;
// Recorded timing should preserve deliberate interaction cadence without
// turning time spent inspecting the canvas into a very slow replay.
const RECORDED_PAUSE_MAX_MS = 10_000;

/** Quantize meaningful recorded pauses and bound accidental idle time. */
export function recordedPauseDuration(durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs < RECORDED_PAUSE_THRESHOLD_MS) return 0;
  return Math.min(
    RECORDED_PAUSE_MAX_MS,
    Math.round(durationMs / RECORDED_PAUSE_QUANTUM_MS) * RECORDED_PAUSE_QUANTUM_MS,
  );
}
