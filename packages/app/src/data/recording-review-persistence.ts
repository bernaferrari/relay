import type { EditorSaveState } from "../components/editor-save-status";

export type ReviewPersistenceKind =
  | "saving"
  | "failed"
  | "name-only"
  | "saved"
  | "changed-since-verified"
  | "ready-for-review"
  | "verified";

export type ReviewPersistence = {
  kind: ReviewPersistenceKind;
  label: string;
  detail: string;
  editorState: EditorSaveState;
};

/** One persistence model for recording review. A name change is metadata. */
export function reviewPersistence(input: {
  nameSaveState: EditorSaveState;
  nameChanged?: boolean;
  canApprove: boolean;
  replayRequired?: boolean;
  replayOutcome?: "passed" | "failed" | "cancelled";
  transitionPending: boolean;
  leavePending: boolean;
  failed: boolean;
  failureDetail?: string;
}): ReviewPersistence {
  if (input.transitionPending || input.leavePending || input.nameSaveState === "saving") {
    return {
      kind: "saving",
      label: "Saving…",
      detail: "Keeping the reviewed recording.",
      editorState: "saving",
    };
  }
  if (input.failed || input.nameSaveState === "failed") {
    return {
      kind: "failed",
      label: "Could not confirm the draft",
      detail: input.failureDetail ?? "Your work is still open here.",
      editorState: "failed",
    };
  }
  if (input.canApprove && (input.nameSaveState === "dirty" || input.nameChanged)) {
    return {
      kind: "name-only",
      label: "Name updated — recorded steps are unchanged",
      detail: "The name is kept on this computer. It does not change the executable Test.",
      editorState: input.nameSaveState === "dirty" ? "dirty" : "saved",
    };
  }
  if (input.canApprove) {
    return {
      kind: "verified",
      label: "Verified on the selected Device",
      detail: "Relay verified this exact reviewed version. It can now be saved.",
      editorState: "saved",
    };
  }
  if (input.replayRequired && input.replayOutcome === "passed") {
    return {
      kind: "changed-since-verified",
      label: "Changed since last verified replay",
      detail: "Replay the reviewed steps before saving the Test.",
      editorState: "dirty",
    };
  }
  if (input.replayRequired) {
    return {
      kind: "ready-for-review",
      label: "Ready for review",
      detail: "Review the steps, then replay before saving the Test.",
      editorState: "dirty",
    };
  }
  return {
    kind: "saved",
    label: "Draft saved",
    detail: "The recording is already saved on the server. Leave whenever you want.",
    editorState: "saved",
  };
}

/** Verification is not a save state. One passing replay verifies that configuration only. */
export function reviewVerificationLabel(kind: ReviewPersistenceKind): string | undefined {
  if (kind === "verified") return "Verified on the selected configuration";
  if (kind === "changed-since-verified") return "Changed since last run";
  return undefined;
}
