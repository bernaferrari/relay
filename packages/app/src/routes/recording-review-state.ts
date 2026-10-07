import type { ProductRecordingState } from "../data/recording-product-service";
import type { AuthoringRecordingEdit } from "@relay/protocol";

export type DraftSaveAttempt = {
  workflowId: string;
  reviewRevision: number;
  rename?: { actionId: string; intent: string };
};

export const unsavedDraftInstructionProblem = {
  title: "Could not confirm the saved draft",
  detail: "Save the instruction before closing this draft.",
  recovery: "Save the instruction in the editor, then close the draft.",
  retryable: false,
};

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

export function reviewInspectionRecovery(
  state: ProductRecordingState | undefined,
  workflowId: string,
  attempt?: DraftSaveAttempt,
): { healthy: boolean; draftSaved: boolean } {
  const canonical = state?.snapshot;
  if (
    !canonical ||
    canonical.workflow?.workflowId !== workflowId ||
    canonical.version === "unavailable" ||
    canonical.phase === "needs-attention" ||
    (canonical.allowedNextActions.every((action) => action === "inspect") &&
      canonical.stage !== "committed" &&
      canonical.stage !== "cancelled") ||
    blocksReview(state)
  )
    return { healthy: false, draftSaved: false };
  const rename = attempt?.rename;
  return {
    healthy: true,
    draftSaved: Boolean(
      attempt?.workflowId === workflowId &&
      canonical.review?.currentRevision === attempt.reviewRevision + (rename ? 1 : 0) &&
      (!rename ||
        canonical.review.actions.some(
          (action) => action.id === rename.actionId && action.intent === rename.intent,
        )),
    ),
  };
}
