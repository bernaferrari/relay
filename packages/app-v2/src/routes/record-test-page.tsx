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
import { Field, FieldLabel } from "@relay/ui-react/components/field";
import { Button } from "@relay/ui-react/components/button";
import { PageHeader } from "../components/page-layout";

import { Input } from "@relay/ui-react/components/input";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useNavigate, useRouteContext } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, BookmarkPlus, CheckCircle2, Circle } from "lucide-react";
import type {
  LiveTargetBrowserContext,
  LiveTargetSession,
  LiveTargetStatus,
} from "../data/live-target-session";
import { recordingQueryKeys, refreshRecording } from "../data/recording-queries";
import { clearWorkflowPointerIfCurrent, writeWorkflowPointer } from "../data/workflow-pointer";
import { LiveTargetCanvas } from "./live-target-canvas";
import { PageLoading, RecordingProblem, errorMessage, targetLabel } from "./recording-shared";

const testRouteApi = getRouteApi("/tests/$testId/record");
const recordingRouteApi = getRouteApi("/recordings/$recordingId");

type CaptureAction = { action: "checkpoint"; label?: string } | { action: "stop" };

export function RecordTestPage() {
  const { testId } = testRouteApi.useParams();
  return <RecordingWorkspace workflowId={testId} exitDestination={{ kind: "test", testId }} />;
}

/** The recording-owned route is used while a new Test has no Test ID yet. It
 * intentionally shares the exact recorder workspace with true Test recording
 * instead of teaching two route-specific UIs the same workflow behavior. */
export function RecordingPage() {
  const { recordingId } = recordingRouteApi.useParams();
  return <RecordingWorkspace workflowId={recordingId} exitDestination={{ kind: "new" }} />;
}

function RecordingWorkspace({
  workflowId,
  exitDestination,
}: {
  workflowId: string;
  exitDestination: { kind: "new" } | { kind: "test"; testId: string };
}) {
  const { productService, platform, queryClient } = useRouteContext({ from: "__root__" });
  const navigate = useNavigate();
  const [checkpointOpen, setCheckpointOpen] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [checkpointLabel, setCheckpointLabel] = useState("");
  const liveCanvas = useRef<HTMLCanvasElement>(null);
  const [liveStatus, setLiveStatus] = useState<LiveTargetStatus>("idle");
  const [browserContext, setBrowserContext] = useState<LiveTargetBrowserContext>();
  const [liveIssue, setLiveIssue] = useState<string>();
  const [liveInputBusy, setLiveInputBusy] = useState(false);
  const [stopWaitingForInput, setStopWaitingForInput] = useState(false);
  const liveSession = useRef<LiveTargetSession | undefined>(undefined);
  const liveInputQueue = useRef<Promise<boolean>>(Promise.resolve(true));

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
    setBrowserContext(undefined);
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
          setBrowserContext(next.browserContext);
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

  function sendLiveInput(input: Parameters<LiveTargetSession["input"]>[0]): Promise<boolean> {
    const queued = liveInputQueue.current
      .catch(() => true)
      .then(async () => {
        if (!allowed.has("record")) {
          setLiveIssue("Relay is not ready to record another interaction yet.");
          return false;
        }
        const session = liveSession.current;
        if (!session) {
          setLiveIssue("The live view is still connecting.");
          return false;
        }
        setLiveInputBusy(true);
        setLiveIssue(undefined);
        try {
          await session.input(input);
          await refreshRecording(queryClient, productService, workflowId);
          return true;
        } catch (error) {
          setLiveIssue(liveIssueMessage(errorMessage(error)));
          return false;
        } finally {
          setLiveInputBusy(false);
        }
      });
    liveInputQueue.current = queued;
    return queued;
  }

  async function stopAfterInputDrain() {
    if (!allowed.has("stop") || action.isPending || stopWaitingForInput) return;
    setStopWaitingForInput(true);
    try {
      const delivered = await liveInputQueue.current.catch(() => false);
      if (!delivered) {
        setLiveIssue("The last interaction was not confirmed. Try it again before stopping.");
        return;
      }
      const latest = await refreshRecording(queryClient, productService, workflowId);
      const latestAllowed = new Set(latest.snapshot?.allowedNextActions ?? []);
      if (latest.recovery || latest.status !== "recording" || !latestAllowed.has("stop")) {
        setLiveIssue(
          "The recording changed while the interaction was finishing. Refresh before stopping.",
        );
        return;
      }
      action.mutate({ action: "stop" });
    } finally {
      setStopWaitingForInput(false);
    }
  }

  return (
    <section className="grid h-dvh w-full grid-rows-[auto_minmax(0,1fr)_auto] bg-background">
      <div className="border-b border-border px-5 py-2 relay-electron-drag [-webkit-app-region:drag] [&_.relay-workspace-header]:mb-0 [&_.relay-workspace-header]:mt-0">
        <Dialog open={exitOpen} onOpenChange={setExitOpen}>
          <DialogContent showCloseButton={false}>
            <DialogTitle>Leave this recording?</DialogTitle>
            <DialogDescription>
              Keep recording and come back later, or stop now to review the steps. Leaving does not
              discard your work.
            </DialogDescription>
            <div className="relay-dialog-actions flex flex-wrap items-center justify-end gap-2.5">
              <DialogClose render={<Button variant="ghost">Keep recording</Button>} />
              <Button
                variant="outline"
                nativeButton={false}
                render={
                  exitDestination.kind === "new" ? (
                    <Link to="/sessions" />
                  ) : (
                    <Link to="/tests/$testId" params={{ testId: exitDestination.testId }} />
                  )
                }
                onClick={() => setExitOpen(false)}
              >
                Leave running
              </Button>
              <Button
                variant="default"
                onClick={() => {
                  setExitOpen(false);
                  void stopAfterInputDrain();
                }}
                disabled={!allowed.has("stop") || action.isPending || stopWaitingForInput}
              >
                {stopWaitingForInput ? "Finishing interaction…" : "Stop"}
              </Button>
            </div>
          </DialogContent>
          <PageHeader
            crumbs={[
              { label: "Tests", to: "/tests" },
              {
                label: snapshot?.title ?? (exitDestination.kind === "new" ? "Record Test" : "Test"),
              },
              { label: "Record" },
            ]}
            title={snapshot?.title ?? "Preparing Test"}
            description={
              <span className="inline-flex items-center gap-1.5">
                <span
                  className={captureReady ? "relay-recording-dot" : "relay-recording-idle-dot"}
                  aria-hidden="true"
                />
                {captureReady ? "Recording" : "Restoring recording"}
                {snapshot?.progress.label ? ` · ${snapshot.progress.label}` : ""}
              </span>
            }
            actions={
              <>
                <DialogTrigger
                  render={
                    <Button
                      className="inline-flex min-h-11 w-fit text-muted-foreground relay-electron-no-drag [-webkit-app-region:no-drag]"
                      variant="ghost"
                      size="sm"
                    />
                  }
                >
                  <ArrowLeft aria-hidden="true" />
                  Leave
                </DialogTrigger>
                <Button
                  className="relay-electron-no-drag [-webkit-app-region:no-drag]"
                  variant="default"
                  size="sm"
                  onClick={() => void stopAfterInputDrain()}
                  disabled={!allowed.has("stop") || action.isPending || stopWaitingForInput}
                >
                  {stopWaitingForInput ? "Finishing interaction…" : "Stop"}
                </Button>
              </>
            }
          />
        </Dialog>
      </div>

      <div className="min-h-0 overflow-auto p-[clamp(20px,4vw,44px)]">
        {recording.isPending ? <PageLoading label="Restoring the recording…" /> : null}
        <RecordingProblem
          error={recording.error ?? action.error}
          recovery={action.data?.recovery ?? recording.data?.recovery}
          onRetry={() => void recording.refetch()}
          retrying={recording.isFetching}
        />

        {!recording.isPending && snapshot && captureReady ? (
          <div className="grid h-full min-h-[360px] w-full grid-cols-[minmax(240px,280px)_minmax(0,1fr)] gap-3.5 max-[980px]:grid-cols-1">
            <aside
              className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-xl border border-border bg-card max-[980px]:order-last"
              aria-labelledby="capture-timeline-title"
            >
              <div className="flex items-center justify-between gap-3 border-b border-border p-3.5">
                <h2 id="capture-timeline-title" className="text-[13px] font-medium">
                  Steps
                </h2>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {recordedActions.length}
                </span>
              </div>
              {recordedActions.length ? (
                <ScrollArea className="min-h-0">
                  <ol className="grid list-none gap-1.5 p-3">
                    {recordedActions.map((recorded, index) => (
                      <li
                        className="grid grid-cols-[18px_minmax(0,1fr)_auto] items-start gap-2 rounded-md px-1 py-1.5"
                        key={recorded.id}
                      >
                        {recorded.stepCount === 0 ? (
                          <CheckCircle2 aria-hidden="true" />
                        ) : (
                          <Circle aria-hidden="true" />
                        )}
                        <span className="grid min-w-0 gap-0.5">
                          <strong className="break-words text-sm font-medium leading-snug">
                            {recorded.label ?? recorded.intent}
                          </strong>
                          <small className="text-xs text-muted-foreground">
                            {recorded.stepCount === 0
                              ? "Marked screen"
                              : `${recorded.stepCount} ${recorded.stepCount === 1 ? "step" : "steps"}`}
                          </small>
                        </span>
                        <span className="pt-0.5 text-xs tabular-nums text-muted-foreground">
                          {index + 1}
                        </span>
                      </li>
                    ))}
                  </ol>
                </ScrollArea>
              ) : (
                <div className="grid min-h-[180px] place-items-center px-4 text-center text-sm text-muted-foreground">
                  <p>Taps and typing appear here.</p>
                </div>
              )}
            </aside>
            <div
              className="block min-h-[360px] w-full overflow-hidden rounded-xl border border-border bg-muted"
              aria-label="Recording stage"
            >
              {selectedTarget ? (
                <LiveTargetCanvas
                  canvasRef={liveCanvas}
                  status={liveStatus}
                  issue={liveIssue}
                  busy={liveInputBusy}
                  targetTitle={targetLabel(targetPresentation.data?.[0] ?? selectedTarget).title}
                  targetDetail={targetLabel(targetPresentation.data?.[0] ?? selectedTarget).detail}
                  browserContext={browserContext}
                  send={sendLiveInput}
                />
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <footer className="flex items-center justify-end gap-2" aria-label="Recording controls">
        <Dialog open={checkpointOpen} onOpenChange={setCheckpointOpen}>
          <DialogTrigger
            render={
              <Button variant="outline" disabled={!allowed.has("checkpoint") || action.isPending}>
                <BookmarkPlus aria-hidden="true" />
                Mark screen
              </Button>
            }
          />
          <DialogContent
            showCloseButton={false}
            className="max-h-[min(720px,calc(100dvh-32px))] overflow-auto"
          >
            <DialogTitle>Mark this screen</DialogTitle>
            <DialogDescription>Name a screen this Test should verify later.</DialogDescription>
            <form onSubmit={saveCheckpoint}>
              <Field>
                <FieldLabel htmlFor="checkpoint-label">Name</FieldLabel>
                <Input
                  id="checkpoint-label"
                  value={checkpointLabel}
                  onChange={(event) => setCheckpointLabel(event.currentTarget.value)}
                  placeholder="For example, Order confirmation"
                  maxLength={160}
                  autoComplete="off"
                />
              </Field>
              <div className="relay-dialog-actions flex flex-wrap items-center justify-end gap-2.5">
                <DialogClose render={<Button variant="ghost">Cancel</Button>} />
                <Button type="submit" variant="default" disabled={action.isPending}>
                  {action.isPending ? "Saving…" : "Save"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
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
    return "Relay could not show the live view. Reconnect, then try again.";
  }
  return message;
}
