/** Shared expiry for ephemeral runtime facts and their durable projection. */
export const TARGET_RUNTIME_READINESS_TTL_MS = 2 * 60_000;

export function isValidTargetCaptureTime(at: number | undefined, observedAt: number): at is number {
  return at !== undefined && Number.isFinite(at) && at >= 0 && at <= observedAt;
}

export function isCurrentTargetProof(at: number | undefined, observedAt: number): boolean {
  return (
    isValidTargetCaptureTime(at, observedAt) && observedAt - at <= TARGET_RUNTIME_READINESS_TTL_MS
  );
}
