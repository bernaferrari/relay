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
import {
  TalkBackIssueList,
  TalkBackModeSelect,
  TalkBackOverlay,
  useTalkBackReview,
  visibleTalkBackOverlayItems,
} from "./talkback-review-panel";

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
        await navigate(reviewDocumentLocation(exitDestination));
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
    void navigate({ ...reviewDocumentLocation(exitDestination), replace: true });
  }, [exitDestination, navigate, recording.data?.recovery, recording.error, snapshot?.stage]);

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
  }, [captureReady, platform, productService, selectedTargetId]);

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
    <section className="grid h-full min-h-0 w-full grid-rows-[auto_minmax(0,1fr)_auto] bg-background">
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
                <>
                  <LiveTargetCanvas
                    canvasRef={liveCanvas}
                    status={liveStatus}
                    issue={liveIssue}
                    busy={liveInputBusy}
                    targetTitle={targetLabel(targetPresentation.data?.[0] ?? selectedTarget).title}
                    targetDetail={
                      targetLabel(targetPresentation.data?.[0] ?? selectedTarget).detail
                    }
                    browserContext={browserContext}
                    send={sendLiveInput}
                    overlay={
                      talkBack.on && talkBack.mode !== "off" ? (
                        <TalkBackOverlay
                          canvasRef={liveCanvas}
                          items={visibleTalkBackOverlayItems(
                            talkBack.result,
                            selectedTarget?.targetId,
                          )}
                          mode={talkBack.mode}
                        />
                      ) : null
                    }
                    toolbar={
                      <TalkBackModeSelect
                        mode={talkBack.mode}
                        loading={talkBack.loading}
                        onModeChange={(mode) => talkBack.setMode(mode)}
                      />
                    }
                  />
                  {selectedTarget.platform === "android" && talkBack.on ? (
                    <div className="border-t border-border px-3 py-3">
                      <TalkBackIssueList
                        review={talkBack.result?.review}
                        inspectable={talkBack.result?.inspectable}
                        message={talkBack.issue ?? talkBack.result?.message}
                      />
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <footer className="flex items-center justify-end gap-2" aria-label="Recording controls">
        {recoveryKind === "unknown" ? (
          <div
            className="mr-auto flex min-w-0 flex-wrap items-center gap-2"
            role="group"
            aria-label="Observe the last interaction"
          >
            <p className="max-w-xl text-sm text-muted-foreground">
              {liveIssue ??
                "Relay could not confirm whether the last interaction reached the app. Observe the app before sending more input."}
            </p>
            <Button
              variant="outline"
              disabled={liveInputBusy}
              onClick={() => void observeLastUnknownMutation("applied")}
            >
              It applied
            </Button>
            <Button
              variant="outline"
              disabled={liveInputBusy}
              onClick={() => void observeLastUnknownMutation("not-observed")}
            >
              It did not apply
            </Button>
            <Button
              variant="outline"
              disabled={liveInputBusy}
              onClick={() => void observeLastUnknownMutation("uncertain")}
            >
              Not sure
            </Button>
          </div>
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
