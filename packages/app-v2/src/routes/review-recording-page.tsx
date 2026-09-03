/** @jsxImportSource react */
import { Button } from "@relay/ui-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useRouteContext } from "@tanstack/react-router";
import { recordingQueryKeys, refreshRecording } from "../data/recording-queries";
import { clearWorkflowPointer } from "../data/workflow-pointer";
import { PageLoading, RecordingProblem } from "./recording-shared";

const routeApi = getRouteApi("/recordings/$recordingId/review");

export function ReviewRecordingPage() {
  const { productService, platform, queryClient } = useRouteContext({ from: "__root__" });
  const { recordingId } = routeApi.useParams();
  const workflowId = recordingId;

  const recording = useQuery({
    queryKey: recordingQueryKeys.workflow(workflowId),
    queryFn: () => productService.inspect(workflowId),
    staleTime: 0,
  });
  const transition = useMutation({
    mutationFn: (action: "replay" | "approve") =>
      action === "replay" ? productService.replay() : productService.approve(),
    onSuccess: async (state, action) => {
      const canonical = await refreshRecording(queryClient, productService, workflowId);
      if (state.recovery || canonical.recovery) return;
      if (action === "approve" && canonical.snapshot?.stage === "committed") {
        await clearWorkflowPointer(platform);
        queryClient.setQueryData(recordingQueryKeys.pointer, undefined);
      }
    },
  });

  const state = recording.data;
  const snapshot = state?.snapshot;
  const review = snapshot?.review;
  const allowed = new Set(snapshot?.allowedNextActions ?? []);
  const committedTestId = snapshot?.authoring?.committedTestId;
  const saved = snapshot?.stage === "committed";

  if (saved) {
    return (
      <section className="relay-review-page relay-review-complete">
        <div className="relay-review-complete-mark" aria-hidden="true">
          ✓
        </div>
        <p className="relay-eyebrow">Test saved</p>
        <h1>{snapshot.title}</h1>
        <p>The reviewed recording passed replay and is ready to run again.</p>
        <div className="relay-review-complete-actions">
          {committedTestId ? (
            <Link
              className="relay-button relay-button--primary relay-button--medium"
              to="/tests/$testId"
              params={{ testId: committedTestId }}
            >
              Open Test
            </Link>
          ) : null}
          <Link className="relay-button relay-button--secondary relay-button--medium" to="/tests">
            All Tests
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="relay-review-page">
      <header className="relay-review-header relay-electron-drag">
        <div>
          <p className="relay-eyebrow">Recording review</p>
          <h1>{snapshot?.title ?? "Review recording"}</h1>
          <p>Check the recorded journey, then replay it before saving the Test.</p>
        </div>
        <Link
          className="relay-review-back relay-electron-no-drag"
          to="/tests/$testId/record"
          params={{ testId: workflowId }}
        >
          Back to recording
        </Link>
      </header>

      {recording.isPending ? <PageLoading label="Loading the reviewed recording…" /> : null}
      <RecordingProblem
        error={recording.error ?? transition.error}
        recovery={transition.data?.recovery ?? state?.recovery}
        onRetry={() => void recording.refetch()}
        retrying={recording.isFetching}
      />

      {!recording.isPending && snapshot ? (
        <div className="relay-review-layout">
          <div className="relay-review-main">
            <div className="relay-review-section-heading">
              <div>
                <p className="relay-section-label">Journey</p>
                <h2>{review?.actionCount ?? 0} recorded steps</h2>
              </div>
              <span>{snapshot.progress.label}</span>
            </div>

            {review?.actions.length ? (
              <ol className="relay-review-steps">
                {review.actions.map((step, index) => (
                  <li key={step.id}>
                    <span className="relay-review-step-number">{index + 1}</span>
                    <div>
                      <strong>{step.label ?? step.intent}</strong>
                      <p>
                        {step.stepCount === 1 ? "1 action" : `${step.stepCount} actions`}
                        {step.proofStatus ? ` · ${proofLabel(step.proofStatus)}` : ""}
                      </p>
                    </div>
                    <span className="relay-proof-badge">
                      {captureProofLabel(step.captureProof)}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="relay-review-empty">
                <h2>No recorded steps were returned</h2>
                <p>Return to the recording and capture the journey before saving.</p>
              </div>
            )}
          </div>

          <aside className="relay-review-sidebar" aria-label="Replay and save">
            <div className="relay-replay-status">
              <p className="relay-section-label">Replay</p>
              <h2>{replayTitle(review?.latestReplay?.outcome, review?.replayRequired)}</h2>
              <p>{replayDetail(review?.latestReplay?.outcome, review?.latestReplay?.error)}</p>
            </div>

            {allowed.has("approve") ? (
              <Button
                variant="primary"
                onClick={() => transition.mutate("approve")}
                disabled={transition.isPending}
              >
                {transition.isPending ? "Saving…" : "Save Test"}
              </Button>
            ) : allowed.has("replay") ? (
              <Button
                variant="primary"
                onClick={() => transition.mutate("replay")}
                disabled={transition.isPending}
              >
                {transition.isPending ? "Replaying…" : "Replay recording"}
              </Button>
            ) : (
              <p className="relay-review-waiting" role="status">
                Waiting for Relay to make the next review action available.
              </p>
            )}
            {allowed.has("replay") ? (
              <p className="relay-save-requirement">A passing replay is required before saving.</p>
            ) : null}
          </aside>
        </div>
      ) : null}
    </section>
  );
}

function proofLabel(proof: "verified" | "pixels-only" | "unresolved"): string {
  if (proof === "verified") return "Verified";
  if (proof === "pixels-only") return "Visual evidence";
  return "Needs review";
}

function captureProofLabel(
  proof: "relay-controlled" | "inferred-unproved" | "instrumented-unproved" | "replay-proved",
): string {
  if (proof === "relay-controlled") return "Captured by Relay";
  if (proof === "replay-proved") return "Replay passed";
  return "Needs replay";
}

function replayTitle(outcome: "passed" | "failed" | "cancelled" | undefined, required?: boolean) {
  if (outcome === "passed" && !required) return "Replay passed";
  if (outcome === "failed") return "Replay needs attention";
  if (outcome === "cancelled") return "Replay was cancelled";
  return "Replay required";
}

function replayDetail(
  outcome: "passed" | "failed" | "cancelled" | undefined,
  error: string | undefined,
) {
  if (outcome === "passed") return "The server verified this exact reviewed revision.";
  if (outcome === "failed") return error ?? "The latest replay did not complete successfully.";
  if (outcome === "cancelled") return "Run the replay again when the target is ready.";
  return "Replay the reviewed steps on the selected target.";
}
