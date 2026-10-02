import type { ProductRecordingState } from "../data/recording-product-service";

export function blocksReview(state: ProductRecordingState | undefined): boolean {
  if (!state?.recovery) return false;
  const snapshot = state.snapshot;
  // A proved replay failure is actionable review feedback, not lost transport.
  return !(
    state.recovery.code === "operation-unavailable" &&
    snapshot?.stage === "reviewing" &&
    snapshot.phase !== "needs-attention" &&
    snapshot.allowedNextActions.includes("replay")
  );
}
