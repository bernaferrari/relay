import { ScanLine, LoaderCircle } from "lucide-react";
import { AuthoringWorkspace } from "./authoring-workspace";
import { AuthoringHeader } from "./authoring-header";
import { RecordingActionList } from "./recording-action-list";
import { RecordingInputRecovery } from "./recording-input-recovery";
import { RecordingScreenCapture } from "./recording-screen-capture";
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
import { Button } from "@relay/ui-react/components/button";

import { useMutation, useQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate, useRouteContext } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  LiveTargetBrowserContext,
  LiveTargetSession,
  LiveTargetStatus,
} from "../data/live-target-session";
import {
  appendRecordingMutation,
  dispatchRecordingInput,
  mergeHydratedRecordingLedger,
  parseRecordingLedger,
  recordingInputRecoveryMessage,
  recordingLedgerStorageKey,
  recordingRecoveryBlocksSend,
  reconcileRecordingMutationAuthoritatively,
  refreshRecordingEvidence,
  resolveRecordingMutation,
  serializeRecordingLedger,
  unresolvedRecordingMutation,
  type RecordingInputOutcome,
  type RecordingObservedEffect,
  type RecordingRecoveryLedger,
} from "../data/recording-input-outcome";
import { recordingQueryKeys, refreshRecording } from "../data/recording-queries";
import { reviewDocumentLocation } from "../data/test-document-surface";
import { clearWorkflowPointerIfCurrent, writeWorkflowPointer } from "../data/workflow-pointer";
import { LiveTargetCanvas } from "./live-target-canvas";
import { PageLoading, RecordingProblem, errorMessage, targetLabel } from "./recording-shared";
import { TalkBackModeSelect, TalkBackOverlay, useTalkBackReview } from "./talkback-review-panel";

const testRouteApi = getRouteApi("/tests/$testId/record");
const recordingRouteApi = getRouteApi("/recordings/$recordingId");

type CaptureAction =
  | { action: "full-page" }
  | { action: "recover" }
  | { action: "checkpoint"; label?: string }
  | { action: "stop" }
  | { action: "cancel" };

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
  const [recoveryKind, setRecoveryKind] = useState<RecordingInputOutcome["kind"]>("confirmed");
  const [liveInputBusy, setLiveInputBusy] = useState(false);
  const [talkBackRefresh, setTalkBackRefresh] = useState(0);
  const [stopWaitingForInput, setStopWaitingForInput] = useState(false);
  const liveSession = useRef<LiveTargetSession | undefined>(undefined);
  const liveInputQueue = useRef<Promise<boolean>>(Promise.resolve(true));

  const recording = useQuery({
    queryKey: recordingQueryKeys.workflow(workflowId),
    queryFn: () => productService.inspect(workflowId),
    staleTime: 0,
    // Focus can return while native input or a capture is being committed.
    // Those operations explicitly refresh once their durable result exists.
    refetchOnWindowFocus: false,
    refetchInterval: (query) =>
      query.state.data?.snapshot?.progress.label === "Finishing interaction…" ? 750 : false,
  });

  useEffect(() => {
    void writeWorkflowPointer(platform, workflowId).then(() => {
      queryClient.setQueryData<string | null>(recordingQueryKeys.pointer, workflowId);
      queryClient.setQueryData<string | null>(recordingQueryKeys.reconciledPointer, workflowId);
    });
  }, [platform, queryClient, workflowId]);

  const action = useMutation({
    mutationFn: async (intent: CaptureAction) => {
      if (intent.action === "recover") {
        const sessionId = recording.data?.snapshot?.authoring?.sessionId;
        if (!sessionId || !productService.recoverForReview)
          throw new Error("The saved recording is unavailable.");
        return productService.recoverForReview(sessionId);
      }
      if (intent.action === "full-page") {
        if (!productService.captureFullPage) throw new Error("Full-page capture is unavailable.");
        return productService.captureFullPage();
      }
      if (intent.action === "checkpoint") return productService.checkpoint(intent.label);
      if (intent.action === "cancel") {
        if (!productService.cancel) throw new Error("Cancel recording is unavailable.");
        await liveInputQueue.current;
        return productService.cancel();
      }
      return productService.stop();
    },
    onSuccess: async (state, intent) => {
      const canonical = await refreshRecording(queryClient, productService, workflowId);
      if (state.recovery || canonical.recovery) return;
      if (intent.action === "cancel" && canonical.snapshot?.stage === "cancelled") {
        await clearWorkflowPointerIfCurrent(platform, workflowId);
        queryClient.setQueryData(recordingQueryKeys.pointer, null);
        queryClient.setQueryData(recordingQueryKeys.reconciledPointer, null);
        await navigate({ to: "/tests" });
        return;
      }
      if (intent.action === "checkpoint") {
        setCheckpointLabel("");
        setCheckpointOpen(false);
      }
      if (intent.action === "stop" && canonical.snapshot?.stage === "reviewing") {
        await navigate(reviewDocumentLocation(exitDestination));
      }
    },
  });

  const snapshot = recording.data?.snapshot;
  const captureReady = recording.data?.status === "recording" && !recording.data.recovery;
  const previewAvailable = Boolean(
    snapshot &&
    snapshot.stage !== "cancelled" &&
    (snapshot.frozen?.target || recording.data?.selectedTarget || snapshot.review?.actionCount),
  );
  const allowed = new Set(captureReady ? (snapshot?.allowedNextActions ?? []) : []);
  const recordedActions = snapshot?.review?.actions ?? [];

  useEffect(() => {
    if (recording.data?.recovery || recording.error) return;
    if (snapshot?.stage !== "reviewing" && snapshot?.stage !== "committed") return;
    void navigate({ ...reviewDocumentLocation(exitDestination), replace: true });
  }, [exitDestination, navigate, recording.data?.recovery, recording.error, snapshot?.stage]);

  useEffect(() => {
    if (snapshot?.stage !== "cancelled") return;
    void clearWorkflowPointerIfCurrent(platform, workflowId).then((cleared) => {
      if (cleared) {
        queryClient.setQueryData<string | null>(recordingQueryKeys.pointer, null);
        queryClient.setQueryData<string | null>(recordingQueryKeys.reconciledPointer, null);
      }
      void navigate({ to: "/tests" });
    });
  }, [navigate, platform, queryClient, snapshot?.stage, workflowId]);

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
  const talkBack = useTalkBackReview({
    enabled: Boolean(selectedTargetId),
    serial: selectedTargetId,
    capture: productService.reviewTalkBack,
    refreshKey: talkBackRefresh,
    platform,
  });
  const targetPresentation = useQuery({
    queryKey: recordingQueryKeys.targetPresentation(selectedTargetId ?? "unselected"),
    queryFn: () => productService.presentTargets([selectedTarget!]),
    enabled: Boolean(selectedTarget),
    staleTime: 30_000,
  });

  useEffect(() => {
    const createLiveTarget = productService.liveTarget;
    if (!previewAvailable || !selectedTarget || !liveCanvas.current || !createLiveTarget) {
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
          setBrowserContext(next.browserContext);
          if (recordingRecoveryBlocksSend(recordingLedger.current)) return;
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
  }, [previewAvailable, platform, productService, selectedTargetId]);

  const liveInputOutcome = useRef<Promise<RecordingInputOutcome>>(
    Promise.resolve({ kind: "confirmed" }),
  );
  const recordingLedger = useRef<RecordingRecoveryLedger>({ mutations: [] });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const projection = parseRecordingLedger(
        await Promise.resolve(platform.storage.get(recordingLedgerStorageKey(workflowId))),
      );
      const health =
        productService.inspectTargetHealth && selectedTarget
          ? await productService.inspectTargetHealth(selectedTarget.targetId).catch(() => undefined)
          : undefined;
      if (cancelled) return;
      const view = mergeHydratedRecordingLedger({
        stored: projection,
        inMemory: recordingLedger.current,
        ...(health ? { health } : {}),
      });
      persistLedger(view.ledger);
      setRecoveryKind(view.recoveryKind);
      if (view.issue) setLiveIssue(view.issue);
    })();
    return () => {
      cancelled = true;
    };
  }, [platform, productService, selectedTargetId, workflowId]);

  function persistLedger(ledger: RecordingRecoveryLedger): void {
    recordingLedger.current = ledger;
    void platform.storage.set(
      recordingLedgerStorageKey(workflowId),
      serializeRecordingLedger(ledger),
    );
  }

  function rememberOutcome(outcome: RecordingInputOutcome): RecordingInputOutcome {
    persistLedger(appendRecordingMutation(recordingLedger.current, outcome));
    setRecoveryKind(outcome.kind);
    const recovery = recordingInputRecoveryMessage(outcome);
    if (recovery) setLiveIssue(recovery);
    return outcome;
  }

  function sendLiveInput(input: Parameters<LiveTargetSession["input"]>[0]): Promise<boolean> {
    const queued = liveInputOutcome.current
      .catch(() => ({ kind: "confirmed" as const }))
      .then(async () => {
        if (recordingRecoveryBlocksSend(recordingLedger.current)) {
          const unresolved =
            unresolvedRecordingMutation(recordingLedger.current, "unknown") ??
            unresolvedRecordingMutation(recordingLedger.current, "refresh-failed");
          setRecoveryKind(unresolved?.kind ?? "unknown");
          setLiveIssue(
            (unresolved ? recordingInputRecoveryMessage(unresolved) : undefined) ??
              "An earlier interaction is still unconfirmed. Observe the app before sending more input.",
          );
          return {
            kind: "unknown" as const,
            mutationId: unresolved?.mutationId,
            message:
              "An earlier interaction is still unconfirmed. Observe the app before sending more input.",
          };
        }
        setLiveInputBusy(true);
        try {
          const outcome = await dispatchRecordingInput({
            ledger: recordingLedger.current,
            preflight: () => {
              if (!allowed.has("record")) {
                return { ok: false, message: "Relay is not ready to record." };
              }
              if (!liveSession.current) {
                return { ok: false, message: "The live view is still connecting." };
              }
              return { ok: true };
            },
            send: () => liveSession.current!.input(input),
            refresh: async () => {
              await refreshRecording(queryClient, productService, workflowId);
            },
          });
          rememberOutcome(outcome);
          if (outcome.kind === "confirmed") setTalkBackRefresh((count) => count + 1);
          return outcome;
        } finally {
          setLiveInputBusy(false);
        }
      });
    liveInputOutcome.current = queued;
    liveInputQueue.current = queued.then((outcome) => outcome.kind === "confirmed");
    return liveInputQueue.current;
  }

  async function observeLastUnknownMutation(observed: RecordingObservedEffect) {
    const unresolved = unresolvedRecordingMutation(recordingLedger.current, "unknown");
    if (!unresolved?.mutationId) return;
    if (!productService.reconcileInput || !selectedTarget) {
      setLiveIssue("Relay cannot record this observation on the Device.");
      return;
    }
    setLiveInputBusy(true);
    try {
      const connection = await platform.getServerConnection?.();
      persistLedger(
        await reconcileRecordingMutationAuthoritatively({
          ledger: recordingLedger.current,
          mutationId: unresolved.mutationId,
          observed,
          authority: {
            serial: selectedTarget.targetId,
            ...(connection?.actorId ? { actor: connection.actorId } : {}),
            reconcile: (input) => productService.reconcileInput!(input),
            ...(productService.fetchReconcileReceipt
              ? { fetchReceipt: (input) => productService.fetchReconcileReceipt!(input) }
              : {}),
          },
        }),
      );
      const resolved = recordingLedger.current.mutations.find(
        (mutation) => mutation.mutationId === unresolved.mutationId,
      );
      setRecoveryKind(
        resolved?.observed === "applied" ? "confirmed" : (resolved?.kind ?? "confirmed"),
      );
      setLiveIssue(
        resolved?.observed === "applied"
          ? undefined
          : resolved?.observed === "not-observed" || resolved?.observed === "uncertain"
            ? resolved.kind === "confirmed"
              ? undefined
              : resolved.message
            : resolved
              ? recordingInputRecoveryMessage(resolved)
              : undefined,
      );
    } catch (error) {
      setLiveIssue(
        error instanceof Error && error.message.trim()
          ? error.message
          : "Relay could not record that observation on the Device.",
      );
    } finally {
      setLiveInputBusy(false);
    }
  }

  async function recoverRecordingRefreshOnly() {
    const unresolved = unresolvedRecordingMutation(recordingLedger.current, "refresh-failed");
    if (!unresolved?.mutationId) return;
    setLiveInputBusy(true);
    try {
      const recovered = await refreshRecordingEvidence({
        mutationId: unresolved.mutationId,
        refresh: async () => {
          await refreshRecording(queryClient, productService, workflowId);
        },
      });
      persistLedger(
        resolveRecordingMutation(recordingLedger.current, unresolved.mutationId, recovered),
      );
      setRecoveryKind(recovered.kind);
      const recovery = recordingInputRecoveryMessage(recovered);
      setLiveIssue(recovery);
    } finally {
      setLiveInputBusy(false);
    }
  }

  async function stopAfterInputDrain() {
    if (!allowed.has("stop") || action.isPending || stopWaitingForInput) return;
    setStopWaitingForInput(true);
    try {
      const outcome = await liveInputOutcome.current.catch(
        (): RecordingInputOutcome => ({
          kind: "unknown",
          message: "The last interaction did not finish cleanly.",
        }),
      );
      if (outcome.kind === "refresh-failed") {
        await recoverRecordingRefreshOnly();
      }
      const latestOutcome = recordingLedger.current.mutations.at(-1) ?? outcome;
      if (latestOutcome.kind !== "confirmed" && latestOutcome.kind !== "not-dispatched") {
        setLiveIssue(
          recordingInputRecoveryMessage(latestOutcome) ??
            "Relay could not confirm the last interaction.",
        );
        return;
      }
      if (recordingRecoveryBlocksSend(recordingLedger.current)) {
        setLiveIssue(
          "An earlier interaction is still unconfirmed. Observe the app before stopping.",
        );
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
    <section className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-card">
      <div className="min-w-0">
        <Dialog open={exitOpen} onOpenChange={setExitOpen}>
          <DialogContent showCloseButton={false}>
            <DialogTitle>Cancel recording?</DialogTitle>
            <DialogDescription>
              End this recording without saving a Test. Captured evidence remains available in
              Activity. To keep the steps as a Test, choose Stop and review instead.
            </DialogDescription>
            <div className="flex justify-end gap-2 pt-4">
              <DialogClose render={<Button variant="outline">Keep recording</Button>} />
              <Button
                variant="destructive"
                disabled={action.isPending || liveInputBusy || !productService.cancel}
                onClick={() => {
                  setExitOpen(false);
                  action.mutate({ action: "cancel" });
                }}
              >
                Cancel recording
              </Button>
            </div>
          </DialogContent>
          <AuthoringHeader
            title={
              recording.isError || recording.data?.recovery
                ? "Recording interrupted"
                : "Record test"
            }
            back={
              <DialogTrigger
                render={
                  <Button
                    className="inline-flex w-fit text-muted-foreground relay-electron-no-drag [-webkit-app-region:no-drag]"
                    variant="ghost"
                    size="sm"
                  />
                }
              >
                Cancel
              </DialogTrigger>
            }
            actions={
              <>
                <Button
                  className="relay-electron-no-drag [-webkit-app-region:no-drag]"
                  variant="default"
                  size="sm"
                  onClick={() =>
                    snapshot?.stage === "failed"
                      ? action.mutate({ action: "recover" })
                      : void stopAfterInputDrain()
                  }
                  disabled={
                    (!allowed.has("stop") &&
                      !(snapshot?.stage === "failed" && productService.recoverForReview)) ||
                    action.isPending ||
                    stopWaitingForInput
                  }
                >
                  {snapshot?.stage === "failed"
                    ? action.isPending
                      ? "Opening saved steps…"
                      : "Review saved steps"
                    : stopWaitingForInput
                      ? "Finishing interaction…"
                      : "Stop and review"}
                </Button>
              </>
            }
          />
        </Dialog>
      </div>

      <div className="flex min-h-0 flex-col overflow-auto">
        {recording.isPending ? <PageLoading label="Restoring the recording…" /> : null}
        {(recording.isError || recording.data?.recovery) && !previewAvailable ? (
          <div className="m-auto grid w-full max-w-sm justify-items-center gap-3 px-6 py-10 text-center">
            <h2 className="text-lg font-semibold">Connection lost</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Reconnect to reopen your recording and saved steps.
            </p>
            <div className="flex gap-2">
              <Button disabled={recording.isFetching} onClick={() => void recording.refetch()}>
                {recording.isFetching ? "Reconnecting…" : "Reconnect"}
              </Button>
              <Button variant="outline" onClick={() => void navigate({ to: "/tests" })}>
                Back to Tests
              </Button>
            </div>
          </div>
        ) : null}

        {!recording.isPending && snapshot && previewAvailable ? (
          <AuthoringWorkspace
            tools={
              <aside
                className="grid min-h-0 min-w-0 grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden rounded-lg border border-border bg-card h-full"
                aria-labelledby="capture-timeline-title"
              >
                <div className="flex items-center justify-between gap-3 border-b border-border p-3.5">
                  <h2 id="capture-timeline-title" className="text-[13px] font-medium">
                    Recorded steps
                    {liveInputBusy || action.isPending ? (
                      <LoaderCircle
                        className="ms-2 inline size-3.5 animate-spin text-muted-foreground motion-reduce:animate-none"
                        aria-label="Saving step"
                      />
                    ) : null}
                  </h2>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {recordedActions.length}
                  </span>
                </div>
                <div>
                  {captureReady &&
                  (recoveryKind === "unknown" || recoveryKind === "refresh-failed") ? (
                    <div className="m-3 grid gap-3" aria-label="Recording controls">
                      {recoveryKind === "unknown" ? (
                        <RecordingInputRecovery
                          issue={liveIssue}
                          failure={unresolvedRecordingMutation(recordingLedger.current, "unknown")}
                          busy={liveInputBusy || action.isPending || !allowed.has("record")}
                          onObserve={observeLastUnknownMutation}
                        />
                      ) : null}
                      {recoveryKind === "refresh-failed" ? (
                        <Button
                          variant="outline"
                          disabled={liveInputBusy}
                          onClick={() => void recoverRecordingRefreshOnly()}
                        >
                          Refresh recording
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                  {recording.error ||
                  action.error ||
                  action.data?.recovery ||
                  recording.data?.recovery ? (
                    <RecordingProblem
                      className="m-3"
                      error={recording.error ?? action.error}
                      recovery={action.data?.recovery ?? recording.data?.recovery}
                      onRetry={() => void recording.refetch()}
                      retrying={recording.isFetching}
                    />
                  ) : (
                    <span />
                  )}
                </div>
                {recordedActions.length ? (
                  <ScrollArea className="min-h-0">
                    <RecordingActionList actions={recordedActions} />
                  </ScrollArea>
                ) : (
                  <div className="grid min-h-[180px] place-items-center px-4 text-center text-sm text-muted-foreground">
                    <p>Taps and typing appear here.</p>
                  </div>
                )}
              </aside>
            }
            stage={
              <div
                className="grid h-full min-h-0 w-full grid-rows-[minmax(0,1fr)] overflow-hidden"
                aria-label="Recording stage"
              >
                {selectedTarget ? (
                  <>
                    <LiveTargetCanvas
                      canvasRef={liveCanvas}
                      status={liveStatus}
                      issue={recoveryKind === "unknown" ? undefined : liveIssue}
                      busy={liveInputBusy || action.isPending || !allowed.has("record")}
                      targetTitle={
                        targetLabel(targetPresentation.data?.[0] ?? selectedTarget).title
                      }
                      targetDetail={
                        targetLabel(targetPresentation.data?.[0] ?? selectedTarget).detail
                      }
                      browserContext={browserContext}
                      showTargetDetails={false}
                      targetPlatform={selectedTarget?.platform}
                      helpText=""
                      send={sendLiveInput}
                      overlay={
                        talkBack.on && talkBack.mode !== "off" ? (
                          <TalkBackOverlay
                            canvasRef={liveCanvas}
                            items={talkBack.inspection.overlayItems}
                            bounds={talkBack.inspection.bounds}
                            mode={talkBack.mode}
                          />
                        ) : null
                      }
                      toolbar={
                        <>
                          <TalkBackModeSelect
                            mode={talkBack.mode}
                            loading={talkBack.loading}
                            onModeChange={(mode) => talkBack.setMode(mode)}
                          />
                          {selectedTarget.kind === "device" && productService.captureFullPage ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Capture the scrollable page and return to this position"
                              disabled={!allowed.has("record") || action.isPending || liveInputBusy}
                              onClick={() => action.mutate({ action: "full-page" })}
                            >
                              <ScanLine className="size-4" aria-hidden="true" />
                              {action.isPending && action.variables?.action === "full-page"
                                ? "Capturing…"
                                : "Full page"}
                            </Button>
                          ) : null}
                          <RecordingScreenCapture
                            open={checkpointOpen}
                            onOpenChange={setCheckpointOpen}
                            disabled={
                              !allowed.has("checkpoint") ||
                              action.isPending ||
                              liveInputBusy ||
                              recoveryKind === "unknown"
                            }
                            pending={action.isPending}
                            label={checkpointLabel}
                            onLabelChange={setCheckpointLabel}
                            onSubmit={saveCheckpoint}
                          />
                        </>
                      }
                    />
                  </>
                ) : null}
              </div>
            }
          />
        ) : null}
      </div>
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
