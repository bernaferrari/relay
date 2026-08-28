import type { ActionSpec, AuthoringCaptureReview, AuthoringRecordingSource } from "@relay/protocol";

export function recordingSourceForCommit(
  input: {
    takeId: string;
    takeRevision: number;
    evidenceIds: readonly string[];
    captureReview?: AuthoringCaptureReview;
  },
  actions: readonly ActionSpec[],
): AuthoringRecordingSource | undefined {
  if (!actions.some((action) => action.kind === "recorded")) return undefined;
  if (!input.captureReview) {
    throw new TypeError("recorded commits require explicit reviewed capture provenance");
  }
  return {
    schemaVersion: 1,
    takeId: input.takeId,
    takeRevision: input.takeRevision,
    capture: structuredClone(input.captureReview),
    evidenceIds: [...new Set(input.evidenceIds)],
  };
}
