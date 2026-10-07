import { ScanLine } from "lucide-react";
import { AuthoringWorkspace } from "./authoring-workspace";
import { RecordTestHeader } from "./record-test-header";
import { RecordingScreenCapture } from "./recording-screen-capture";
import {
  RecordingCondition as RecordingConditionDialog,
  conditionFailureMessage,
} from "./recording-condition";
import type { RecordingCondition } from "../data/recording-product-service";
import { RecordingTimelineSidebar } from "./recording-timeline-sidebar";
/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";

import { useMutation, useQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate, useRouteContext } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { LiveTargetSession } from "../data/live-target-session";
import { useRecordingLivePreview } from "./recording-live-preview";
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
import { clearWorkflowPointerIfCurrent, writeWorkflowPointer } from "../data/workflow-pointer";
import { LiveTargetCanvas } from "./live-target-canvas";
import {
  PageLoading,
  ReconnectLiveViewButton,
  errorMessage,
  targetLabel,
} from "./recording-shared";
import { TalkBackModeSelect, TalkBackOverlay, useTalkBackReview } from "./talkback-review-panel";
import { currentAccessibilityInspection } from "../data/talkback-overlay";
import { conditionTextSuggestions } from "../data/recording-condition-suggestions";
import { useRecordingInputReceipt } from "./use-recording-input-receipt";
import { prepareRecordingStop, recordingStopBlockedReason } from "../data/recording-stop-state";

const testRouteApi = getRouteApi("/tests/$testId/record");
const recordingRouteApi = getRouteApi("/recordings/$recordingId");

type CaptureAction =
  | { action: "full-page" }
  | { action: "recover" }
  | { action: "checkpoint"; label?: string }
  | { action: "condition"; condition: RecordingCondition }
  | { action: "stop" }
  | { action: "cancel" };

export function RecordTestPage() {
  const { testId } = testRouteApi.useParams();
  return <RecordingWorkspace workflowId={testId} />;
}

/** The recording-owned route is used while a new Test has no Test ID yet. It
 * intentionally shares the exact recorder workspace with true Test recording
 * instead of teaching two route-specific UIs the same workflow behavior. */
export function RecordingPage() {
  const { recordingId } = recordingRouteApi.useParams();
  return <RecordingWorkspace workflowId={recordingId} />;
}

function RecordingWorkspace({ workflowId }: { workflowId: string }) {
  const { productService, platform, queryClient } = useRouteContext({ from: "__root__" });
  const navigate = useNavigate();
  const [checkpointOpen, setCheckpointOpen] = useState(false);
  const [conditionOpen, setConditionOpen] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [checkpointLabel, setCheckpointLabel] = useState("");
  const [liveIssue, setLiveIssue] = useState<string>();
  const [recoveryKind, setRecoveryKind] = useState<RecordingInputOutcome["kind"]>("confirmed");
  const [liveInputBusy, setLiveInputBusy] = useState(false);
  const [talkBackRefresh, setTalkBackRefresh] = useState(0);
  const [stopWaitingForInput, setStopWaitingForInput] = useState(false);
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
      if (intent.action === "condition") {
        if (!productService.recordCondition) throw new Error("Waits are unavailable here.");
        const result = await productService.recordCondition(intent.condition);
        // A command can return an unsuccessful outcome while a later inspection
        // is healthy. Keep that outcome in the form; inspection is not proof
        // that the requested condition was recorded.
        if (result.recovery) throw Object.assign(new Error(result.recovery.title), result.recovery);
        return result;
      }
      if (intent.action === "cancel") {
        if (!productService.cancel) throw new Error("Cancel recording is unavailable.");
        await liveInputQueue.current;
        return productService.cancel();
      }
      return productService.stop();
    },
    onError: async (_error, intent) => {
      if (intent.action === "condition")
        await refreshRecording(queryClient, productService, workflowId).catch(() => undefined);
    },
    onSuccess: async (_state, intent) => {
      const canonical = await refreshRecording(queryClient, productService, workflowId);
      if (canonical.recovery) return;
      action.reset();
      if (intent.action === "cancel" && canonical.snapshot?.stage === "cancelled") {
        await clearWorkflowPointerIfCurrent(platform, workflowId);
        queryClient.setQueryData(recordingQueryKeys.pointer, null);
        queryClient.setQueryData(recordingQueryKeys.reconciledPointer, null);
        await navigate({
          to: "/tests",
          search: canonical.snapshot.frozen?.appMapId
            ? { app: canonical.snapshot.frozen.appMapId }
            : {},
        });
        return;
      }
      if (intent.action === "checkpoint") {
        setCheckpointLabel("");
        setCheckpointOpen(false);
      }
      if (intent.action === "condition") setConditionOpen(false);
      if (intent.action === "stop" && canonical.snapshot?.stage === "reviewing") {
        // Review is a mode of this recording document, not a different
        // application: keep the recording-owned URL through record → stop →
        // review so the identity the user is looking at never churns.
        await navigate({
          to: "/recordings/$recordingId/review",
          params: { recordingId: workflowId },
        });
      }
    },
  });

  useEffect(() => {
    if (
      !action.isPending &&
      action.data?.recovery &&
      recording.data &&
      !recording.data.recovery &&
      !recording.isError &&
      recording.dataUpdatedAt > action.submittedAt
    )
      action.reset();
  }, [
    action.isPending,
    action.data,
    action.submittedAt,
    action.reset,
    recording.data,
    recording.dataUpdatedAt,
    recording.isError,
  ]);

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
      void navigate({
        to: "/tests",
        search: snapshot.frozen?.appMapId ? { app: snapshot.frozen.appMapId } : {},
      });
    });
  }, [navigate, platform, queryClient, snapshot?.stage, snapshot?.frozen?.appMapId, workflowId]);

  function saveCheckpoint(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (liveToolsDisabled || !allowed.has("checkpoint")) return;
    action.mutate({
      action: "checkpoint",
      ...(checkpointLabel.trim() ? { label: checkpointLabel.trim() } : {}),
    });
  }

  const selectedTarget = recording.data?.selectedTarget ?? snapshot?.frozen?.target;
  const selectedTargetId = selectedTarget?.targetId;
  const talkBack = useTalkBackReview({
    enabled: Boolean(selectedTargetId) && selectedTarget?.kind !== "browser",
    serial: selectedTargetId,
    capture: productService.reviewTalkBack,
    refreshKey: talkBackRefresh * 2 + Number(conditionOpen),
    platform,
  });
  const {
    liveCanvas,
    liveSession,
    liveStatus,
    browserContext,
    browserAccessibility,
    previewIssue,
    reconnect,
  } = useRecordingLivePreview({
    enabled: previewAvailable,
    selectedTarget,
    createLiveTarget: productService.liveTarget,
    inspectAccessibility: talkBack.on,
  });
  const liveToolsDisabled =
    liveStatus !== "streaming" || action.isPending || liveInputBusy || recoveryKind === "unknown";
  // Browser inspection belongs to the exact frame/page/sequence on screen;
  // a separate SDK snapshot reports content extents, not the video viewport.
  const inspection =
    selectedTarget?.kind === "browser"
      ? currentAccessibilityInspection(talkBack.on ? browserAccessibility : undefined)
      : talkBack.inspection;
  const targetPresentation = useQuery({
    queryKey: recordingQueryKeys.targetPresentation(selectedTargetId ?? "unselected"),
    queryFn: () => productService.presentTargets([selectedTarget!]),
    enabled: Boolean(selectedTarget),
    staleTime: 30_000,
  });

  const liveInputOutcome = useRef<Promise<RecordingInputOutcome>>(
    Promise.resolve({ kind: "confirmed" }),
  );
  const recordingLedger = useRef<RecordingRecoveryLedger>({ mutations: [] });

  useRecordingInputReceipt({
    failure: unresolvedRecordingMutation(recordingLedger.current, "unknown"),
    workflowId,
    target: selectedTarget,
    service: productService,
    onConfirmed: async (failure, isCurrent) => {
      const refreshed = await refreshRecordingEvidence({
        refresh: async () => {
          await refreshRecording(queryClient, productService, workflowId);
        },
        mutationId: failure.mutationId,
      });
      const latest = unresolvedRecordingMutation(recordingLedger.current, "unknown");
      if (!isCurrent() || latest !== failure) return;
      persistLedger(
        resolveRecordingMutation(recordingLedger.current, failure.mutationId!, refreshed),
      );
      setRecoveryKind(refreshed.kind);
      setLiveIssue(recordingInputRecoveryMessage(refreshed));
      setTalkBackRefresh((count) => count + 1);
    },
  });

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
    setLiveIssue(recovery);
    return outcome;
  }

  // Physical devices expose inspection through reviewTalkBack rather than the
  // browser live transport. Refresh when opening the picker and use that same
  // current inspection for both hover labels and condition suggestions.
  const screenText =
    inspection.conditionSuggestions ?? conditionTextSuggestions(inspection.overlayItems);

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
            platform: selectedTarget.platform,
            // A signed-in browser tracks its inputs under that login's key.
            serial:
              selectedTarget.kind === "browser" && selectedTarget.authenticationFixtureId
                ? `${selectedTarget.targetId}#${selectedTarget.authenticationFixtureId}`
                : selectedTarget.targetId,
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
      const blocked = await prepareRecordingStop({
        outcome: liveInputOutcome.current,
        ledger: () => recordingLedger.current,
        refreshOnly: recoverRecordingRefreshOnly,
        inspect: () => refreshRecording(queryClient, productService, workflowId),
      });
      if (blocked) {
        setLiveIssue(blocked);
        return;
      }
      action.mutate({ action: "stop" });
    } finally {
      setStopWaitingForInput(false);
    }
  }

  const stopBlockedReason =
    snapshot?.stage === "failed" ? undefined : recordingStopBlockedReason(recordingLedger.current);

  return (
    <section className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-card">
      <RecordTestHeader
        open={exitOpen}
        onOpenChange={setExitOpen}
        interrupted={Boolean(recording.isError || recording.data?.recovery)}
        cancelDisabled={action.isPending || liveInputBusy || !productService.cancel}
        stopDisabled={
          (!allowed.has("stop") &&
            !(snapshot?.stage === "failed" && productService.recoverForReview)) ||
          action.isPending ||
          stopWaitingForInput ||
          Boolean(stopBlockedReason)
        }
        stopBlockedReason={stopBlockedReason}
        failed={snapshot?.stage === "failed"}
        pending={action.isPending}
        stopping={stopWaitingForInput}
        onLeave={() =>
          void navigate({
            to: "/tests",
            search: snapshot?.frozen?.appMapId ? { app: snapshot.frozen.appMapId } : {},
          })
        }
        onCancel={() => {
          setExitOpen(false);
          action.mutate({ action: "cancel" });
        }}
        onStop={() =>
          snapshot?.stage === "failed"
            ? action.mutate({ action: "recover" })
            : void stopAfterInputDrain()
        }
      />

      <div className="flex min-h-0 flex-col overflow-auto">
        {recording.isPending ? <PageLoading label="Restoring the recording…" /> : null}
        {(recording.isError || recording.data?.recovery) && !previewAvailable ? (
          <div className="m-auto grid w-full max-w-sm justify-items-center gap-3 px-6 py-10 text-center">
            <h2 className="text-lg font-semibold">Relay session unavailable</h2>
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
              <RecordingTimelineSidebar
                captureReady={captureReady}
                recoveryKind={recoveryKind}
                liveIssue={liveIssue}
                failure={unresolvedRecordingMutation(recordingLedger.current, "unknown")}
                liveInputBusy={liveInputBusy || action.isPending}
                canRecord={allowed.has("record")}
                onObserve={observeLastUnknownMutation}
                onRefresh={() => void recoverRecordingRefreshOnly()}
                recordingError={recording.error}
                actionError={
                  conditionOpen && action.variables?.action === "condition"
                    ? undefined
                    : action.error
                }
                recovery={action.data?.recovery ?? recording.data?.recovery}
                onRetry={() => void recording.refetch()}
                retrying={recording.isFetching}
                checking={action.isPending || snapshot?.progress.label === "Finishing interaction…"}
                recordedActions={recordedActions}
              />
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
                      issue={previewIssue ?? (recoveryKind === "unknown" ? undefined : liveIssue)}
                      recoveryAction={
                        <ReconnectLiveViewButton
                          disabled={liveInputBusy || action.isPending}
                          onClick={reconnect}
                        />
                      }
                      busy={liveInputBusy || action.isPending || !allowed.has("record")}
                      targetTitle={
                        targetLabel(targetPresentation.data?.[0] ?? selectedTarget).title
                      }
                      targetDetail={
                        targetLabel(targetPresentation.data?.[0] ?? selectedTarget).detail
                      }
                      browserContext={browserContext}
                      directBrowser={selectedTarget.kind === "browser"}
                      showTargetDetails={false}
                      targetPlatform={selectedTarget?.platform}
                      helpText=""
                      send={sendLiveInput}
                      overlay={
                        talkBack.on && talkBack.mode !== "off" ? (
                          <TalkBackOverlay
                            canvasRef={liveCanvas}
                            items={inspection.overlayItems}
                            bounds={inspection.bounds}
                            mode={talkBack.mode}
                          />
                        ) : null
                      }
                      toolbar={
                        <>
                          <TalkBackModeSelect
                            mode={talkBack.mode}
                            loading={talkBack.loading}
                            disabled={liveToolsDisabled}
                            onModeChange={(mode) => talkBack.setMode(mode)}
                          />
                          {selectedTarget.kind === "device" && productService.captureFullPage ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Capture the scrollable page and return to this position"
                              disabled={!allowed.has("record") || liveToolsDisabled}
                              onClick={() => action.mutate({ action: "full-page" })}
                            >
                              <ScanLine className="size-4" aria-hidden="true" />
                              {action.isPending && action.variables?.action === "full-page"
                                ? "Capturing…"
                                : "Full page"}
                            </Button>
                          ) : null}
                          {productService.recordCondition ? (
                            <RecordingConditionDialog
                              open={conditionOpen}
                              onOpenChange={setConditionOpen}
                              disabled={!allowed.has("checkpoint") || liveToolsDisabled}
                              pending={action.isPending && action.variables?.action === "condition"}
                              error={
                                action.isError && action.variables?.action === "condition"
                                  ? conditionFailureMessage(
                                      action.variables.condition,
                                      action.error,
                                    )
                                  : undefined
                              }
                              suggestions={screenText}
                              onSubmit={(condition) =>
                                action.mutate({ action: "condition", condition })
                              }
                            />
                          ) : null}
                          <RecordingScreenCapture
                            open={checkpointOpen}
                            onOpenChange={setCheckpointOpen}
                            disabled={!allowed.has("checkpoint") || liveToolsDisabled}
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
