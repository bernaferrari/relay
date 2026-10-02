import type { ProductRecordingState } from "../data/recording-product-service";
import type { AuthoringRecordingEdit } from "@relay/protocol";

export type ReviewTransitionIntent =
  | { action: "replay" }
  | { action: "approve"; testName: string }
  | {
      action: "edit";
      edit: AuthoringRecordingEdit;
      history?: { kind: "new" | "undo" | "redo"; fromRevision: number };
    };

export function reviewEditIntent(
  edit: AuthoringRecordingEdit,
  currentRevision?: number,
): ReviewTransitionIntent {
  return {
    action: "edit",
    edit,
    ...(currentRevision ? { history: { kind: "new", fromRevision: currentRevision } } : {}),
  };
}

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
