import { ApiError } from "@relay/client";
import { isRelayTransportFailure } from "@relay/workflows/operation-port";
import type { HumanError } from "@relay/product/errors";
import type { ProductRecordingState } from "../data/recording-product-service";
import type { ReviewTransitionIntent } from "./recording-review-state";
import type { QueryClient } from "@tanstack/react-query";
import type { RecordingProductService } from "../data/recording-product-service";
import { refreshRecording } from "../data/recording-queries";

export type RecordingReviewOperation =
  | "inspect"
  | "edit"
  | "replay"
  | "approve"
  | "recover"
  | "save-draft";

/** The query retains a failed follow-up read. It must not manufacture a
 * mutation error after the action already returned its own result. */
export function refreshRecordingReview(
  queryClient: QueryClient,
  service: RecordingProductService,
  workflowId: string,
) {
  return refreshRecording(queryClient, service, workflowId).catch(() => undefined);
}
const operations: Record<RecordingReviewOperation, { label: string; title: string }> = {
  inspect: { label: "Check recording status", title: "Could not load the recording" },
  edit: { label: "Update recorded steps", title: "Could not confirm the recording update" },
  replay: { label: "Run recorded steps", title: "Could not confirm the replay" },
  approve: { label: "Save test", title: "Could not confirm the test save" },
  recover: { label: "Open saved steps", title: "Could not confirm opening saved steps" },
  "save-draft": { label: "Save recording draft", title: "Could not confirm the draft save" },
};

// Only stable public categories are inspectable. Arbitrary error strings,
// response bodies, IDs and transport payloads never become diagnostics.
const publicCodes = new Set([
  "invalid-intent",
  "operation-unavailable",
  "compile-blocked",
  "revision-changed",
  "malformed-response",
  "mutation-outcome-unknown",
  "input-not-dispatched",
  "stale-workflow-version",
  "invalid-workflow-ref",
  "unknown-job-status",
  "unexpected-authoring-state",
  "review-required",
  "transport",
  "local-service-transport",
  "target-profile-ambiguous",
  "native-recording-target-not-ready",
  "raw-evidence-recapture-required",
  "raw-evidence-variant-recapture-required",
  "AUTHORING_INTERACTION_FAILED",
  "ACTION_FAILED",
  "INTERNAL",
  "CANCELLED",
  "DEVICE_MISSING",
  "IOS_MUTATION_OUTCOME_UNKNOWN",
  "INPUT_OUTCOME_UNKNOWN",
]);

type ReviewErrorContext = { code?: string; sourceCode?: string; httpStatus?: number };

function httpStatus(error: unknown, recovery?: ReviewErrorContext): number | undefined {
  const status = error instanceof ApiError ? error.status : recovery?.httpStatus;
  return typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599
    ? status
    : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

export function recordingReviewDiagnostics(
  operation: RecordingReviewOperation,
  error: unknown,
  recovery?: ReviewErrorContext,
): readonly string[] {
  const lines = [`Operation: ${operations[operation].label}`];
  const status = httpStatus(error, recovery);
  if (status !== undefined) lines.push(`HTTP status: ${status}`);
  const body = error instanceof ApiError ? record(error.body) : undefined;
  const problem = record(body?.error);
  const details = record(body?.details);
  const direct = record(error);
  const codes = [
    recovery?.code,
    recovery?.sourceCode,
    direct?.code,
    direct?.sourceCode,
    body?.code,
    details?.code,
    problem?.code,
    problem?.sourceCode,
  ];
  if (isRelayTransportFailure(error)) codes.push("local-service-transport");
  for (const code of new Set(codes)) {
    if (typeof code === "string" && publicCodes.has(code)) lines.push(`Code: ${code}`);
  }
  return lines;
}

export function recordingReviewErrorCopy(
  operation: RecordingReviewOperation,
  projected: Pick<HumanError, "title" | "detail" | "recovery"> | undefined,
  error: unknown,
  recovery?: ReviewErrorContext,
): Pick<HumanError, "title" | "detail" | "recovery"> | undefined {
  const transport =
    isRelayTransportFailure(error) || recovery?.sourceCode === "local-service-transport";
  const generic =
    !projected ||
    [
      "Something went wrong",
      "Relay could not complete this request",
      "Relay could not complete that request",
      "Relay could not accept this request",
      "Relay is temporarily unavailable",
      "Relay needs your attention",
      "Relay is not connected",
      "Recording status is unavailable",
    ].includes(projected.title);
  if (!generic) return projected;
  if (operation === "inspect" && !recovery?.sourceCode && httpStatus(error, recovery) === 503)
    return {
      title: "Recording status is temporarily unavailable",
      detail: "Relay could not complete this status check.",
      recovery: "Wait a moment, then check status.",
    };
  return {
    title:
      transport && operation === "inspect"
        ? "Recording status is unavailable"
        : operations[operation].title,
    detail:
      operation === "inspect"
        ? transport
          ? "Relay could not reach the service while checking this recording."
          : "The recording status could not be loaded."
        : "Check status before choosing your next action.",
    recovery:
      operation === "inspect"
        ? transport
          ? "Check the Relay connection, then check status."
          : "Check status again."
        : "",
  };
}

export function reviewRequestProblem(input: {
  inspectionError?: unknown;
  transition?: { error: unknown; variables?: ReviewTransitionIntent; data?: ProductRecordingState };
  recoveryError?: unknown;
  draftError?: unknown;
  recoveryAction?: string;
}): { error: unknown; reviewOperation: RecordingReviewOperation } {
  if (input.inspectionError) return { error: input.inspectionError, reviewOperation: "inspect" };
  if (input.transition?.error)
    return {
      error: input.transition.error,
      reviewOperation: input.transition.variables?.action ?? "inspect",
    };
  if (input.recoveryError) return { error: input.recoveryError, reviewOperation: "recover" };
  if (input.draftError) return { error: input.draftError, reviewOperation: "save-draft" };
  const action =
    input.transition?.data?.recovery?.action ??
    (input.transition?.data?.recovery ? input.transition.variables?.action : input.recoveryAction);
  return {
    error: undefined,
    reviewOperation:
      action === "replay" || action === "edit" || action === "approve" ? action : "inspect",
  };
}

/** A healthy read alone cannot acknowledge an earlier failed mutation. Only
 * the matching successful action result supplies its exact immutable proof. */
export function reviewTransitionConfirmed(
  result: ProductRecordingState | undefined,
  canonical: ProductRecordingState | undefined,
  intent: ReviewTransitionIntent | undefined,
): boolean {
  const before = result?.snapshot;
  const after = canonical?.snapshot;
  if (
    !intent ||
    !before ||
    !after ||
    result?.recovery ||
    canonical?.recovery ||
    !before.workflow?.workflowId ||
    before.workflow.workflowId !== after.workflow?.workflowId ||
    !before.authoring?.sessionId ||
    before.authoring.sessionId !== after.authoring?.sessionId ||
    after.version === "unavailable" ||
    after.phase === "needs-attention"
  )
    return false;
  if (intent.action === "approve")
    return (
      before.stage === "committed" &&
      after.stage === "committed" &&
      Boolean(
        before.authoring.committedTestId &&
        before.authoring.committedTestId === after.authoring.committedTestId,
      )
    );
  if (intent.action === "edit")
    return (
      before.review?.currentRevision !== undefined &&
      before.review.currentRevision === after.review?.currentRevision
    );
  const replay = before.review?.latestReplay;
  const current = after.review?.latestReplay;
  return Boolean(
    replay?.id &&
    replay.id === current?.id &&
    replay.outcome === "passed" &&
    current.outcome === "passed" &&
    replay.takeRevision === current.takeRevision &&
    current.takeRevision === after.review?.currentRevision,
  );
}

export function reviewStatusRetry(
  refetch: () => Promise<{ data?: ProductRecordingState; error: unknown }>,
  inspectRecovered: (state?: ProductRecordingState) => { healthy: boolean; draftSaved: boolean },
  transition: {
    data?: ProductRecordingState;
    error: unknown;
    variables?: ReviewTransitionIntent;
    reset(): void;
  },
  draft: { error: unknown; reset(): void },
  clearDraftSave: () => void,
): () => void {
  return () => {
    void refetch().then((result) => {
      if (result.error) return;
      const recovered = inspectRecovered(result.data);
      if (!recovered.healthy) return;
      if (
        !transition.error &&
        reviewTransitionConfirmed(transition.data, result.data, transition.variables)
      )
        transition.reset();
      if (recovered.draftSaved && isRelayTransportFailure(draft.error)) {
        draft.reset();
        clearDraftSave();
      }
    });
  };
}
