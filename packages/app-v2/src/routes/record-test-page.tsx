/** @jsxImportSource react */
import {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@relay/ui-react/components/dialog";
import { ScrollArea } from "@relay/ui-react/components/scroll-area";
import { Field, FieldDescription, FieldLabel } from "@relay/ui-react/components/field";
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useNavigate, useRouteContext } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, BookmarkPlus, CheckCircle2, Circle, Square } from "lucide-react";
import type { LiveTargetSession, LiveTargetStatus } from "../data/live-target-session";
import { recordingQueryKeys, refreshRecording } from "../data/recording-queries";
import { clearWorkflowPointerIfCurrent, writeWorkflowPointer } from "../data/workflow-pointer";
import { LiveTargetCanvas } from "./live-target-canvas";
import { PageLoading, RecordingProblem, errorMessage, targetLabel } from "./recording-shared";

const testRouteApi = getRouteApi("/tests/$testId/record");
const recordingRouteApi = getRouteApi("/recordings/$recordingId");

type CaptureAction = { action: "checkpoint"; label?: string } | { action: "stop" };

export function RecordTestPage() {
  const { testId } = testRouteApi.useParams();
  return (
    <RecordingWorkspace
      workflowId={testId}
      exitLink={
        <Link
          className="relay-capture-back relay-electron-no-drag"
          to="/tests/$testId"
          params={{ testId }}
        >
          <ArrowLeft aria-hidden="true" />
          Exit recording
        </Link>
      }
    />
  );
}

/** The recording-owned route is used while a new Test has no Test ID yet. It
 * intentionally shares the exact recorder workspace with true Test recording
 * instead of teaching two route-specific UIs the same workflow behavior. */
export function RecordingPage() {
  const { recordingId } = recordingRouteApi.useParams();
  return (
    <RecordingWorkspace
      workflowId={recordingId}
      exitLink={
        <Link className="relay-capture-back relay-electron-no-drag" to="/tests/new">
          <ArrowLeft aria-hidden="true" />
          Exit recording
        </Link>
      }
    />
  );
}

function RecordingWorkspace({ workflowId, exitLink }: { workflowId: string; exitLink: ReactNode }) {
  const { productService, platform, queryClient } = useRouteContext({ from: "__root__" });
  const navigate = useNavigate();
  const [checkpointOpen, setCheckpointOpen] = useState(false);
  const [checkpointLabel, setCheckpointLabel] = useState("");
  const liveCanvas = useRef<HTMLCanvasElement>(null);
  const [liveStatus, setLiveStatus] = useState<LiveTargetStatus>("idle");
  const [liveIssue, setLiveIssue] = useState<string>();
  const [liveInputBusy, setLiveInputBusy] = useState(false);
  const liveSession = useRef<LiveTargetSession | undefined>(undefined);
  const liveInputQueue = useRef(Promise.resolve());

  const recording = useQuery({
    queryKey: recordingQueryKeys.workflow(workflowId),
    queryFn: () => productService.inspect(workflowId),
    staleTime: 0,
  });

  useEffect(() => {
    void writeWorkflowPointer(platform, workflowId).then(() => {
      queryClient.setQueryData<string | null>(recordingQueryKeys.pointer, workflowId);
      queryClient.setQueryData<string | null>(recordingQueryKeys.reconciledPointer, workflowId);
    });
  }, [platform, queryClient, workflowId]);

  const action = useMutation({
    mutationFn: async (intent: CaptureAction) => {
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
  const captureReady = recording.data?.status === "recording" && !recording.data.recovery;
  const allowed = new Set(captureReady ? (snapshot?.allowedNextActions ?? []) : []);
  const recordedActions = snapshot?.review?.actions ?? [];

  useEffect(() => {
    if (recording.data?.recovery || recording.error) return;
    if (snapshot?.stage !== "reviewing" && snapshot?.stage !== "committed") return;
    void navigate({
      to: "/recordings/$recordingId/review",
      params: { recordingId: workflowId },
      replace: true,
    });
  }, [navigate, recording.data?.recovery, recording.error, snapshot?.stage, workflowId]);

  useEffect(() => {
    if (snapshot?.stage !== "cancelled") return;
    void clearWorkflowPointerIfCurrent(platform, workflowId).then((cleared) => {
      if (cleared) {
        queryClient.setQueryData<string | null>(recordingQueryKeys.pointer, null);
        queryClient.setQueryData<string | null>(recordingQueryKeys.reconciledPointer, null);
      }
    });
  }, [platform, queryClient, snapshot?.stage, workflowId]);

  function saveCheckpoint(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (action.isPending || !allowed.has("checkpoint")) return;
    action.mutate({
      action: "checkpoint",
      ...(checkpointLabel.trim() ? { label: checkpointLabel.trim() } : {}),
    });
  }

  const selectedTarget = recording.data?.selectedTarget ?? snapshot?.frozen?.target;
  const selectedTargetId = selectedTarget?.targetId;
  const targetPresentation = useQuery({
    queryKey: recordingQueryKeys.targetPresentation(selectedTargetId ?? "unselected"),
    queryFn: () => productService.presentTargets([selectedTarget!]),
    enabled: Boolean(selectedTarget),
    staleTime: 30_000,
  });

  useEffect(() => {
    const createLiveTarget = productService.liveTarget;
    if (!captureReady || !selectedTarget || !liveCanvas.current || !createLiveTarget) {
      setLiveStatus("idle");
      setLiveIssue(undefined);
      return;
    }
    let disposed = false;
    let stop: (() => void) | undefined;
    let unsubscribe: (() => void) | undefined;
    let mountedSession: LiveTargetSession | undefined;
    void createLiveTarget(selectedTarget)
      .then((session) => {
        if (disposed || !liveCanvas.current) {
          session.close();
          return;
        }
        mountedSession = session;
        liveSession.current = session;
        unsubscribe = session.subscribe((next) => {
          setLiveStatus(next.status);
          setLiveIssue(next.issue ? liveIssueMessage(next.issue) : undefined);
        });
        stop = session.mount(liveCanvas.current);
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setLiveStatus("degraded");
          setLiveIssue(liveIssueMessage(errorMessage(error)));
        }
      });
    return () => {
      disposed = true;
      stop?.();
      unsubscribe?.();
      if (liveSession.current === mountedSession) liveSession.current = undefined;
      mountedSession?.close();
    };
  }, [captureReady, platform, productService, selectedTargetId]);

  function sendLiveInput(input: Parameters<LiveTargetSession["input"]>[0]): Promise<void> {
    const queued = liveInputQueue.current
      .catch(() => undefined)
      .then(async () => {
        if (!allowed.has("record")) {
          setLiveIssue("Relay is not ready to record another interaction yet.");
          return;
        }
        const session = liveSession.current;
        if (!session) {
          setLiveIssue("The live target is still connecting.");
          return;
        }
        setLiveInputBusy(true);
        setLiveIssue(undefined);
        try {
          await session.input(input);
          await refreshRecording(queryClient, productService, workflowId);
        } catch (error) {
          setLiveIssue(liveIssueMessage(errorMessage(error)));
        } finally {
          setLiveInputBusy(false);
        }
      });
    liveInputQueue.current = queued;
    return queued;
  }

  return (
    <section className="relay-capture-stage">
      <header className="relay-capture-header relay-electron-drag">
        {exitLink}
        <div className="relay-capture-title">
          <span
            className={captureReady ? "relay-recording-dot" : "relay-recording-idle-dot"}
            aria-hidden="true"
          />
          <div>
            <p>{captureReady ? "Recording" : "Restoring recording"}</p>
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

        {!recording.isPending && snapshot && captureReady ? (
          <div className="relay-capture-workspace">
            <div className="relay-capture-canvas" aria-label="Recording stage">
              {selectedTarget ? (
                <LiveTargetCanvas
                  canvasRef={liveCanvas}
                  status={liveStatus}
                  issue={liveIssue}
                  busy={liveInputBusy}
                  targetTitle={targetLabel(targetPresentation.data?.[0] ?? selectedTarget).title}
                  targetDetail={targetLabel(targetPresentation.data?.[0] ?? selectedTarget).detail}
                  send={sendLiveInput}
                />
              ) : null}
            </div>
            <aside className="relay-capture-timeline" aria-labelledby="capture-timeline-title">
              <div className="relay-capture-timeline-heading">
                <div>
                  <p className="relay-section-label">Journey</p>
                  <h2 id="capture-timeline-title">Captured actions</h2>
                </div>
                <span>{recordedActions.length}</span>
              </div>
              {recordedActions.length ? (
                <ScrollArea className="relay-capture-timeline-scroll">
                  <ol>
                    {recordedActions.map((recorded, index) => (
                      <li key={recorded.id}>
                        {recorded.stepCount === 0 ? (
                          <CheckCircle2 aria-hidden="true" />
                        ) : (
                          <Circle aria-hidden="true" />
                        )}
                        <span>
                          <strong>{recorded.label ?? recorded.intent}</strong>
                          <small>
                            {recorded.stepCount === 0
                              ? "Checkpoint"
                              : `${recorded.stepCount} ${recorded.stepCount === 1 ? "interaction" : "interactions"}`}
                          </small>
                        </span>
                        <span>{index + 1}</span>
                      </li>
                    ))}
                  </ol>
                </ScrollArea>
              ) : (
                <div className="relay-capture-timeline-empty">
                  <Circle aria-hidden="true" />
                  <p>Your clicks, taps, typing, and checkpoints will appear here.</p>
                </div>
              )}
            </aside>
          </div>
        ) : null}
      </div>

      <footer className="relay-capture-controls" aria-label="Recording controls">
        <div className="relay-capture-control-copy">
          <strong>Record the journey naturally</strong>
          <span>Add a checkpoint only when a screen must be verified later.</span>
        </div>
        <div className="relay-capture-control-actions">
          <Dialog open={checkpointOpen} onOpenChange={setCheckpointOpen}>
            <DialogTrigger
              render={
                <Button disabled={!allowed.has("checkpoint") || action.isPending}>
                  <BookmarkPlus aria-hidden="true" />
                  Checkpoint
                </Button>
              }
            />

            <DialogContent showCloseButton={false} className="relay-checkpoint-dialog">
              <DialogTitle>Save a checkpoint</DialogTitle>
              <DialogDescription>
                Mark a state someone should verify when this Test runs.
              </DialogDescription>
              <form onSubmit={saveCheckpoint}>
                <Field>
                  <FieldLabel htmlFor="checkpoint-label">Checkpoint name</FieldLabel>
                  <Input
                    id="checkpoint-label"
                    value={checkpointLabel}
                    onChange={(event) => setCheckpointLabel(event.currentTarget.value)}
                    placeholder="For example, Order confirmation"
                    maxLength={160}
                    autoComplete="off"
                  />
                  <FieldDescription>Optional, but helpful in Reports.</FieldDescription>
                </Field>
                <div className="relay-dialog-actions">
                  <DialogClose render={<Button variant="ghost">Cancel</Button>} />
                  <Button type="submit" variant="default" disabled={action.isPending}>
                    {action.isPending ? "Saving…" : "Save checkpoint"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
          <Button
            variant="default"
            aria-label="Stop recording and review"
            onClick={() => action.mutate({ action: "stop" })}
            disabled={!allowed.has("stop") || action.isPending}
          >
            <Square aria-hidden="true" />
            {action.isPending && action.variables?.action === "stop" ? "Stopping…" : "Stop"}
          </Button>
        </div>
      </footer>
    </section>
  );
}

function liveIssueMessage(message: string): string {
  if (
    /packet|metadata|content type|transport marker|canvas context|codec|decode|base64|targetid|operation/iu.test(
      message,
    )
  ) {
    return "Relay could not show the live view. Reconnect the target, then try again.";
  }
  return message;
}
