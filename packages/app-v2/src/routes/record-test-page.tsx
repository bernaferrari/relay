/** @jsxImportSource react */
import { Button, Dialog } from "@relay/ui-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useNavigate, useRouteContext } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { recordingQueryKeys, refreshRecording } from "../data/recording-queries";
import { writeWorkflowPointer } from "../data/workflow-pointer";
import { PageLoading, RecordingProblem, targetLabel } from "./recording-shared";

const routeApi = getRouteApi("/tests/$testId/record");

type CaptureAction =
  | { action: "record" }
  | { action: "checkpoint"; label?: string }
  | { action: "stop" };

export function RecordTestPage() {
  const { productService, platform, queryClient } = useRouteContext({ from: "__root__" });
  const { testId } = routeApi.useParams();
  const navigate = useNavigate();
  const workflowId = testId;
  const [checkpointOpen, setCheckpointOpen] = useState(false);
  const [checkpointLabel, setCheckpointLabel] = useState("");

  const recording = useQuery({
    queryKey: recordingQueryKeys.workflow(workflowId),
    queryFn: async () => {
      await writeWorkflowPointer(platform, workflowId);
      return productService.inspect(workflowId);
    },
    staleTime: 0,
  });

  const action = useMutation({
    mutationFn: async (intent: CaptureAction) => {
      if (intent.action === "record") return productService.recordCurrent();
      if (intent.action === "checkpoint") return productService.checkpoint(intent.label);
      return productService.stop();
    },
    onSuccess: async (state, intent) => {
      const canonical = await refreshRecording(queryClient, productService, workflowId);
      if (state.recovery || canonical.recovery) return;
      if (intent.action === "checkpoint") {
        setCheckpointLabel("");
        setCheckpointOpen(false);
      }
      if (intent.action === "stop" && canonical.snapshot?.stage === "reviewing") {
        await navigate({
          to: "/recordings/$recordingId/review",
          params: { recordingId: workflowId },
        });
      }
    },
  });

  const snapshot = recording.data?.snapshot;
  const allowed = new Set(snapshot?.allowedNextActions ?? []);

  useEffect(() => {
    if (snapshot?.stage !== "reviewing") return;
    void navigate({
      to: "/recordings/$recordingId/review",
      params: { recordingId: workflowId },
      replace: true,
    });
  }, [navigate, snapshot?.stage, workflowId]);

  function saveCheckpoint(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (action.isPending || !allowed.has("checkpoint")) return;
    action.mutate({
      action: "checkpoint",
      ...(checkpointLabel.trim() ? { label: checkpointLabel.trim() } : {}),
    });
  }

  const selectedTarget = recording.data?.selectedTarget ?? snapshot?.frozen?.target;

  return (
    <section className="relay-capture-stage">
      <header className="relay-capture-header relay-electron-drag">
        <Link className="relay-capture-back relay-electron-no-drag" to="/tests/new">
          Exit recording
        </Link>
        <div className="relay-capture-title">
          <span className="relay-recording-dot" aria-hidden="true" />
          <div>
            <p>Recording</p>
            <h1>{snapshot?.title ?? "Preparing Test"}</h1>
          </div>
        </div>
        <span className="relay-capture-progress" role="status">
          {snapshot?.progress.label ?? "Connecting…"}
        </span>
      </header>

      <div className="relay-capture-body">
        {recording.isPending ? <PageLoading label="Restoring the recording…" /> : null}
        <RecordingProblem
          error={recording.error ?? action.error}
          recovery={action.data?.recovery ?? recording.data?.recovery}
          onRetry={() => void recording.refetch()}
          retrying={recording.isFetching}
        />

        {!recording.isPending && snapshot ? (
          <div className="relay-capture-canvas" aria-label="Recording stage">
            <div className="relay-capture-presence">
              <span className="relay-capture-presence-mark" aria-hidden="true" />
              <h2>The capture is live</h2>
              <p>
                Complete the journey on the connected target. Use Record when the current state
                should become the next step.
              </p>
              {selectedTarget ? (
                <div className="relay-target-summary">
                  <span>{targetLabel(selectedTarget).detail}</span>
                  <strong>{targetLabel(selectedTarget).title}</strong>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <footer className="relay-capture-controls" aria-label="Recording controls">
        <Button
          variant="secondary"
          onClick={() => action.mutate({ action: "record" })}
          disabled={!allowed.has("record") || action.isPending}
        >
          {action.isPending && action.variables?.action === "record" ? "Recording…" : "Record"}
        </Button>
        <Dialog.Root open={checkpointOpen} onOpenChange={setCheckpointOpen}>
          <Dialog.Trigger
            className="relay-button relay-button--secondary relay-button--medium"
            disabled={!allowed.has("checkpoint") || action.isPending}
          >
            Checkpoint
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Backdrop className="relay-dialog-backdrop" />
            <Dialog.Viewport className="relay-dialog-viewport">
              <Dialog.Popup className="relay-overlay-popup relay-dialog-popup relay-checkpoint-dialog">
                <Dialog.Title>Save a checkpoint</Dialog.Title>
                <Dialog.Description>
                  Mark a state someone should verify when this Test runs.
                </Dialog.Description>
                <form onSubmit={saveCheckpoint}>
                  <label htmlFor="checkpoint-label">Label</label>
                  <input
                    id="checkpoint-label"
                    className="relay-input"
                    value={checkpointLabel}
                    onChange={(event) => setCheckpointLabel(event.currentTarget.value)}
                    placeholder="Optional"
                    maxLength={160}
                    autoComplete="off"
                  />
                  <div className="relay-dialog-actions">
                    <Dialog.Close className="relay-button relay-button--ghost relay-button--medium">
                      Cancel
                    </Dialog.Close>
                    <Button type="submit" variant="primary" disabled={action.isPending}>
                      {action.isPending ? "Saving…" : "Save checkpoint"}
                    </Button>
                  </div>
                </form>
              </Dialog.Popup>
            </Dialog.Viewport>
          </Dialog.Portal>
        </Dialog.Root>
        <Button
          variant="primary"
          onClick={() => action.mutate({ action: "stop" })}
          disabled={!allowed.has("stop") || action.isPending}
        >
          {action.isPending && action.variables?.action === "stop" ? "Stopping…" : "Stop"}
        </Button>
      </footer>
    </section>
  );
}
