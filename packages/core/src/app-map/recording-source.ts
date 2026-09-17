import type {
  ActionSpec,
  AuthoringCaptureReview,
  AuthoringRecordingSource,
  AuthoringEvidence,
  AuthoringObservation,
} from "@relay/protocol";

export function recordingSourceForCommit(
  input: {
    takeId: string;
    takeRevision: number;
    evidenceIds: readonly string[];
    captureReview?: AuthoringCaptureReview;
    before?: AuthoringObservation;
    after?: AuthoringObservation;
    evidenceById?: Record<string, AuthoringEvidence>;
  },
  actions: readonly ActionSpec[],
): AuthoringRecordingSource | undefined {
  const hasRecordedActions = actions.some((action) => action.kind === "recorded");
  const hasScreenshot = Object.values(input.evidenceById ?? {}).some(
    (item) => item.kind === "screenshot" && input.evidenceIds.includes(item.id),
  );
  if (!hasRecordedActions && (!hasScreenshot || !input.captureReview)) return undefined;
  if (!input.captureReview) {
    throw new TypeError("recorded commits require explicit reviewed capture provenance");
  }
  const frames: NonNullable<AuthoringRecordingSource["frames"]> = [];
  for (const role of ["before", "after"] as const) {
    const evidence = input[role]?.evidenceIds
      .map((id) => input.evidenceById?.[id])
      .find((item) => item?.kind === "screenshot" && input.evidenceIds.includes(item.id));
    if (evidence && /^relay-evidence:\/\/[a-f\d]{64}$/iu.test(evidence.uri)) {
      frames.push({ evidenceId: evidence.id, uri: evidence.uri, role });
    }
  }
  if (!hasRecordedActions && !frames.length) return undefined;
  return {
    ...(frames.length ? { frames } : {}),
    schemaVersion: 1,
    takeId: input.takeId,
    takeRevision: input.takeRevision,
    capture: structuredClone(input.captureReview),
    evidenceIds: [...new Set(input.evidenceIds)],
  };
}
