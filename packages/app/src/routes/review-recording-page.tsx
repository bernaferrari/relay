import { RecordingSaveProgress } from "./recording-save-progress";
import { RecordingReviewStatus } from "./recording-review-status";
import { RecordingReviewActions } from "./recording-review-actions";
import {
  blocksReview,
  reviewEditIntent,
  type ReviewTransitionIntent,
} from "./recording-review-state";
import type { ProductRecordingState } from "../data/recording-product-service";
import { AuthoringHeader } from "./authoring-header";
import { RecordingReviewLayout } from "./recording-review-layout";
import { RecordingTrimPanel } from "./recording-trim-panel";
/** @jsxImportSource react */
import { EditorSaveStatus } from "../components/editor-save-status";
import { WorkbenchPage } from "../components/page-layout";
import type { AuthoringRecordingEdit } from "@relay/protocol";
import { Field, FieldDescription, FieldLabel } from "@relay/ui-react/components/field";
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useRouteContext } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { recordingQueryKeys, refreshRecording } from "../data/recording-queries";
import {
  foldRecordingIntoTest,
  forgetRecordingInto,
  readRecordingInto,
} from "../data/record-into-test";
import { clearWorkflowPointerIfCurrent } from "../data/workflow-pointer";
import { PageLoading, targetLabel } from "./recording-shared";
import { RecordingActionsPanel, RecordingEvidencePanel } from "./recording-review-panels";
import { useRecordingReviewEvidence } from "./use-recording-review-evidence";
import { RecordingReviewProblem, useReviewSelection } from "./recording-replay-feedback";
import { reviewPersistence } from "../data/recording-review-persistence";
import { useRecordingNameDraft } from "../data/use-recording-name-draft";
import { RecordingReviewInspector } from "./recording-review-inspector";

export function ReviewRecordingPage({
  recordingId: recordingIdProp,
}: { recordingId?: string } = {}) {
  const params = useParams({ strict: false }) as { recordingId?: string };
  const recordingId = recordingIdProp ?? params.recordingId ?? "";
  return <RecordingReviewDocument key={recordingId} recordingId={recordingId} />;
}

function RecordingReviewDocument({ recordingId }: { recordingId: string }) {
  const { productService, platform, queryClient, testEditorService } = useRouteContext({
    from: "__root__",
  });
  const navigate = useNavigate();
  const workflowId = recordingId;
  const into = useQuery({
    queryKey: ["recording-into", recordingId],
    queryFn: async () => (await readRecordingInto(platform, recordingId)) ?? null,
    staleTime: Infinity,
  });
  const fold = useMutation({
    mutationFn: async (recordedTestId: string) => {
      const target = into.data!;
      const firstStepId = await foldRecordingIntoTest(testEditorService, {
        recordedTestId,
        into: target,
      });
      await forgetRecordingInto(platform, recordingId);
      await queryClient.invalidateQueries({ queryKey: ["test-editor", target.testId] });
      await queryClient.invalidateQueries({ queryKey: ["catalog", "tests"] });
      return { testId: target.testId, firstStepId };
    },
    onSuccess: ({ testId, firstStepId }) =>
      void navigate({
        to: "/tests/$testId",
        params: { testId },
        search: firstStepId ? { step: firstStepId } : {},
        replace: true,
      }),
  });
  const nameDraftKey = `recordingName:${workflowId}`;
  const [selectedActionIds, setSelectedActionIds] = useState<readonly string[]>([]);
  const [actionIntent, setActionIntent] = useState("");
  const [splitAfterStep, setSplitAfterStep] = useState(1);
  const [evidenceRole, setEvidenceRole] = useState<"entrance" | "exit">("exit");
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string>();
  const [trimStartMs, setTrimStartMs] = useState(0);
  const [trimEndMs, setTrimEndMs] = useState(0);
  const [undoStack, setUndoStack] = useState<readonly number[]>([]);
  const [redoStack, setRedoStack] = useState<readonly number[]>([]);
  const [editing, setEditing] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const historyInitialized = useRef(false);
  const [savePhase, setSavePhase] = useState<"checking" | "saving">();

  const recording = useQuery({
    queryKey: recordingQueryKeys.workflow(workflowId),
    queryFn: () => productService.inspect(workflowId),
    staleTime: 0,
  });
  const transition = useMutation({
    mutationFn: async (intent: ReviewTransitionIntent) => {
      if (intent.action === "replay") return productService.replay();
      if (intent.action === "edit") return productService.edit(intent.edit);
      await nameWrites.current;
      if (!productService.save || currentRevision === undefined)
        return productService.approve(intent.testName);
      setSavePhase(runsBeforeSave ? "checking" : "saving");
      try {
        return await productService.save({
          testName: intent.testName,
          reviewRevision: currentRevision,
          ...(selectedAction && actionIntent.trim() && actionIntent.trim() !== selectedAction.intent
            ? { rename: { actionId: selectedAction.id, intent: actionIntent.trim() } }
            : {}),
          onProgress: setSavePhase,
        });
      } finally {
        setSavePhase(undefined);
      }
    },
    onSuccess: async (_state, intent) => {
      const canonical = await refreshRecording(queryClient, productService, workflowId);
      if (blocksReview(canonical)) return;
      if (
        intent.action === "approve" &&
        _state.recovery &&
        canonical.snapshot?.stage !== "committed"
      )
        return;
      // The fresh durable snapshot supersedes a transient transport warning.
      transition.reset();
      if (intent.action === "edit") {
        const nextIds = canonical.snapshot?.review?.actions.map((action) => action.id) ?? [];
        setSelectedActionIds((current) => current.filter((id) => nextIds.includes(id)).slice(0, 1));
        if (intent.history?.kind === "new") {
          setUndoStack((current) => [...current, intent.history!.fromRevision]);
          setRedoStack([]);
        } else if (intent.history?.kind === "undo") {
          setUndoStack((current) => current.slice(0, -1));
          setRedoStack((current) => [...current, intent.history!.fromRevision]);
        } else if (intent.history?.kind === "redo") {
          setRedoStack((current) => current.slice(0, -1));
          setUndoStack((current) => [...current, intent.history!.fromRevision]);
        }
      }
      if (intent.action === "approve" && canonical.snapshot?.stage === "committed") {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["catalog", "tests"] }),
          queryClient.invalidateQueries({ queryKey: recordingQueryKeys.apps }),
        ]);
        await nameWrites.current.catch(() => undefined);
        await Promise.resolve(platform.storage.remove?.(nameDraftKey));
        if (await clearWorkflowPointerIfCurrent(platform, workflowId)) {
          queryClient.setQueryData<string | null>(recordingQueryKeys.pointer, null);
          queryClient.setQueryData<string | null>(recordingQueryKeys.reconciledPointer, null);
        }
      }
    },
  });

  const recoverReview = useMutation({
    mutationFn: async () => {
      const sessionId = recording.data?.snapshot?.authoring?.sessionId;
      if (!sessionId || !productService.recoverForReview)
        throw new Error("The saved steps are unavailable. Check the connection and try again.");
      return productService.recoverForReview(sessionId);
    },
    onSuccess: async () => {
      const canonical = await refreshRecording(queryClient, productService, workflowId);
      if (!blocksReview(canonical)) transition.reset();
    },
  });

  const restartEmpty = useMutation({
    mutationFn: async () => {
      if (!productService.cancel)
        throw new Error("Starting over is unavailable. Return to Tests and try again.");
      const result = await productService.cancel();
      if (result.snapshot?.stage !== "cancelled")
        throw new Error("Could not close the empty recording. Try again.");
      await clearWorkflowPointerIfCurrent(platform, workflowId);
      queryClient.setQueryData(recordingQueryKeys.pointer, null);
      queryClient.setQueryData(recordingQueryKeys.reconciledPointer, null);
    },
    onSuccess: () =>
      navigate({ to: "/tests/new", search: { app: recording.data?.snapshot?.frozen?.appMapId } }),
  });

  const leaveDraft = useMutation({
    mutationFn: async () => {
      await nameWrites.current;
      if (pendingInstruction && !productService.saveDraft)
        throw new Error("Save the instruction before closing this draft.");
      const persisted =
        productService.saveDraft && currentRevision !== undefined
          ? await productService.saveDraft({
              reviewRevision: currentRevision,
              ...(pendingInstruction ? { rename: pendingInstruction } : {}),
            })
          : await productService.inspect(workflowId);
      if (blocksReview(persisted) || !persisted.snapshot?.review)
        throw new Error("Could not confirm the saved draft. Keep this page open and try again.");
      return persisted;
    },
    onSuccess: async (persisted) => {
      await queryClient.invalidateQueries({ queryKey: recordingQueryKeys.drafts });
      await navigate({
        to: "/tests",
        search: { app: persisted.snapshot?.frozen?.appMapId, view: "drafts" },
      });
    },
  });

  const state = recording.data;
  const snapshot = state?.snapshot;
  const replayTarget = snapshot?.frozen?.target;
  const replayPresentation = useQuery({
    queryKey: recordingQueryKeys.targetPresentation(replayTarget?.targetId ?? "unselected"),
    queryFn: () => productService.presentTargets([replayTarget!]),
    enabled: Boolean(replayTarget),
    staleTime: 30_000,
  });
  const replayDeviceName = replayTarget
    ? targetLabel(replayPresentation.data?.[0] ?? replayTarget).title
    : "recorded device";
  const review = snapshot?.review;
  const reviewReady = Boolean(
    snapshot && !blocksReview(state) && !recording.error && !blocksReview(transition.data),
  );
  const allowed = new Set(reviewReady ? (snapshot?.allowedNextActions ?? []) : []);
  const canRecoverReview = Boolean(
    snapshot?.review &&
    snapshot.stage === "reviewing" &&
    snapshot.review.recovery === "observe" &&
    state?.recovery?.code === "mutation-outcome-unknown" &&
    productService.recoverForReview,
  );
  const actions = useMemo(() => review?.actions ?? [], [review?.actions]);
  const selectedActions = useMemo(
    () => actions.filter((action) => selectedActionIds.includes(action.id)),
    [actions, selectedActionIds],
  );
  const selectedAction = selectedActions.length === 1 ? selectedActions[0] : undefined;
  const selectedIndex = selectedAction
    ? actions.findIndex((action) => action.id === selectedAction.id)
    : -1;
  const selectionIsContiguous = selectedActions.every(
    (action, index) => actions.indexOf(action) === actions.indexOf(selectedActions[0]!) + index,
  );
  const canEdit = allowed.has("edit") && !transition.isPending;
  const canApprove = allowed.has("approve") && actions.length > 0;
  const committedTestId = snapshot?.authoring?.committedTestId;
  const saved = reviewReady && snapshot?.stage === "committed";
  const {
    testName,
    setTestName,
    nameEdits,
    nameWrites,
    nameSaveState,
    setNameSaveState,
    nameSaveError,
    setNameSaveAttempt,
  } = useRecordingNameDraft({ platform, nameDraftKey, saved, snapshot });
  const persistence = reviewPersistence({
    nameSaveState,
    nameChanged: Boolean(testName.trim() && snapshot?.title && testName.trim() !== snapshot.title),
    canApprove,
    replayRequired: review?.replayRequired,
    replayOutcome: review?.latestReplay?.outcome,
    transitionPending: transition.isPending,
    leavePending: leaveDraft.isPending,
    failed: Boolean(transition.error || leaveDraft.error),
    failureDetail: leaveDraft.error ? "Could not confirm the saved draft" : undefined,
  });
  const currentRevision = review?.currentRevision;
  const pendingInstruction =
    selectedAction && actionIntent.trim() && actionIntent.trim() !== selectedAction.intent
      ? { actionId: selectedAction.id, intent: actionIntent.trim() }
      : undefined;
  const runsBeforeSave = !canApprove || Boolean(pendingInstruction);
  const runsOnSave = Boolean(
    productService.save && currentRevision !== undefined && runsBeforeSave,
  );
  const sessionId = snapshot?.authoring?.sessionId;
  const optimization = useQuery({
    queryKey: ["recording-optimization", sessionId ?? "unselected", currentRevision ?? 0],
    queryFn: () => productService.getOptimization(sessionId!),
    enabled: false,
  });
  const failedReplay = reviewReady ? review?.latestReplay?.failedAction : undefined;
  const {
    matchingEvidence,
    evidence,
    evidencePreview,
    evidenceUrl,
    failureEvidence,
    showingReplayFailure,
  } = useRecordingReviewEvidence({
    service: productService,
    sessionId,
    action: selectedAction,
    evidenceRole,
    selectedEvidenceId,
    failure: failedReplay,
  });

  useEffect(() => {
    if (!saved) return;
    void clearWorkflowPointerIfCurrent(platform, workflowId).then((cleared) => {
      if (cleared) {
        queryClient.setQueryData<string | null>(recordingQueryKeys.pointer, null);
        queryClient.setQueryData<string | null>(recordingQueryKeys.reconciledPointer, null);
      }
    });
  }, [platform, queryClient, saved, workflowId]);

  const inspectFailedStep = useReviewSelection(
    actions,
    reviewReady ? review?.latestReplay : undefined,
    setSelectedActionIds,
    setSelectedEvidenceId,
    setEditing,
  );
  useEffect(() => {
    setActionIntent(selectedAction?.intent ?? "");
  }, [selectedAction?.id, selectedAction?.intent]);
  useEffect(() => {
    if (!review?.timeline) return;
    setTrimStartMs(review.videoClip?.startMs ?? 0);
    setTrimEndMs(review.videoClip?.endMs ?? review.timeline.durationMs);
  }, [review?.currentRevision, review?.timeline, review?.videoClip]);

  useEffect(() => {
    historyInitialized.current = false;
    setUndoStack([]);
    setRedoStack([]);
  }, [workflowId]);

  useEffect(() => {
    if (historyInitialized.current || !currentRevision) return;
    historyInitialized.current = true;
    setUndoStack(Array.from({ length: Math.max(0, currentRevision - 1) }, (_, index) => index + 1));
  }, [currentRevision]);

  function edit(edit: AuthoringRecordingEdit) {
    transition.mutate(reviewEditIntent(edit, currentRevision));
  }

  function restore(kind: "undo" | "redo") {
    if (!currentRevision) return;
    const sourceRevision = (kind === "undo" ? undoStack : redoStack).at(-1);
    if (sourceRevision === undefined) return;
    transition.mutate({
      action: "edit",
      edit: { kind: "restore", sourceRevision },
      history: { kind, fromRevision: currentRevision },
    });
  }

  function moveSelected(offset: -1 | 1) {
    if (!selectedAction || selectedIndex < 0) return;
    const destination = selectedIndex + offset;
    if (destination < 0 || destination >= actions.length) return;
    const actionIds = actions.map((action) => action.id);
    [actionIds[selectedIndex], actionIds[destination]] = [
      actionIds[destination]!,
      actionIds[selectedIndex]!,
    ];
    edit({ kind: "reorder", actionIds });
  }

  function toggleAction(actionId: string, checked: boolean) {
    setSelectedActionIds((current) =>
      checked ? [...new Set([...current, actionId])] : current.filter((id) => id !== actionId),
    );
  }

  useEffect(() => {
    if (!saved || !committedTestId || into.isPending) return;
    if (into.data) {
      if (fold.isIdle) fold.mutate(committedTestId);
      return;
    }
    void navigate({
      to: "/tests/$testId",
      params: { testId: committedTestId },
      search: { target: replayTarget?.targetId },
      replace: true,
    });
  }, [saved, committedTestId, replayTarget?.targetId, navigate, into.data, into.isPending, fold]);

  if (saved)
    return (
      <RecordingSaveProgress
        error={fold.error}
        intoName={into.data?.testName}
        retrying={fold.isPending}
        onRetry={() => {
          if (committedTestId) fold.mutate(committedTestId);
        }}
      />
    );

  const reviewStatus = (
    <RecordingReviewStatus
      canApprove={canApprove}
      runsBeforeSave={runsOnSave}
      pendingAction={transition.isPending ? transition.variables?.action : undefined}
      savePhase={savePhase}
      deviceName={replayDeviceName}
      deviceDetail={replayPresentation.data?.[0]?.detail}
      replayOutcome={review?.latestReplay?.outcome}
      verificationSource={review?.latestReplay?.source}
    />
  );

  return (
    <WorkbenchPage className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-card !p-0">
      <AuthoringHeader
        phase="review"
        back={
          reviewReady ? (
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2"
              title={productService.saveDraft && !saved ? "Save draft and close" : undefined}
              disabled={
                transition.isPending ||
                leaveDraft.isPending ||
                nameSaveState === "saving" ||
                nameSaveState === "failed"
              }
              onClick={() => leaveDraft.mutate()}
            >
              <ArrowLeft aria-hidden="true" />{" "}
              {leaveDraft.isPending
                ? "Saving draft…"
                : productService.saveDraft && !saved
                  ? "Save draft"
                  : "Back to Tests"}
            </Button>
          ) : null
        }
        title="Review test"
        actions={
          reviewReady ? (
            <>
              {!actions.length && productService.cancel ? (
                <Button onClick={() => restartEmpty.mutate()} disabled={restartEmpty.isPending}>
                  {restartEmpty.isPending ? "Starting over…" : "Start new recording"}
                </Button>
              ) : null}
              {restartEmpty.error ? <p role="alert">{restartEmpty.error.message}</p> : null}
              <RecordingReviewActions
                editing={editing}
                pending={transition.isPending || leaveDraft.isPending}
                canEdit={canEdit}
                canUndo={undoStack.length > 0}
                canRedo={redoStack.length > 0}
                canSave={
                  canApprove ||
                  Boolean(
                    productService.save &&
                    currentRevision !== undefined &&
                    allowed.has("replay") &&
                    actions.length,
                  )
                }
                canReplay={allowed.has("replay") && actions.length > 0}
                autoSave={Boolean(productService.save && currentRevision !== undefined)}
                runsBeforeSave={runsOnSave}
                saveDisabled={!into.data && !testName.trim()}
                intoTestName={into.data?.testName}
                saving={
                  transition.isPending && transition.variables?.action === "approve"
                    ? (savePhase ?? "saving")
                    : undefined
                }
                replaying={transition.isPending && transition.variables?.action === "replay"}
                deviceName={replayDeviceName}
                onSaveDraft={
                  productService.saveDraft && !saved ? () => leaveDraft.mutate() : undefined
                }
                onUndo={() => restore("undo")}
                onRedo={() => restore("redo")}
                onEdit={() => {
                  setEditing((open) => !open);
                  setSelecting(false);
                }}
                onReplay={() => transition.mutate({ action: "replay" })}
                onSave={() =>
                  transition.mutate({
                    action: "approve",
                    testName: into.data ? `${into.data.testName} · added steps` : testName.trim(),
                  })
                }
              />

              {nameSaveState === "saving" && !transition.isPending ? (
                <EditorSaveStatus state="saving" />
              ) : null}
              {persistence.editorState === "failed" ? (
                <EditorSaveStatus state={persistence.editorState} detail={persistence.label} />
              ) : null}
            </>
          ) : undefined
        }
      >
        {reviewReady && into.data ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-muted-foreground">
              These steps will be added to{" "}
              <strong className="font-medium text-foreground">{into.data.testName}</strong>.
            </p>
            {reviewStatus}
          </div>
        ) : reviewReady ? (
          <div className="flex flex-wrap items-center gap-3">
            <Field className="min-w-48 max-w-lg flex-1">
              <FieldLabel className="sr-only" htmlFor="review-test-name">
                Test name
              </FieldLabel>
              <Input
                id="review-test-name"
                value={testName}
                disabled={leaveDraft.isPending || transition.isPending}
                onChange={(event) => {
                  nameEdits.current += 1;
                  setNameSaveState("dirty");
                  setTestName(event.currentTarget.value);
                }}
                placeholder="Name this Test"
                maxLength={160}
                autoComplete="off"
                spellCheck
                required
              />
              {nameSaveError ? <FieldDescription>{nameSaveError}</FieldDescription> : null}
              {nameSaveError && nameEdits.current > 0 ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={nameSaveState === "saving"}
                  onClick={() => setNameSaveAttempt((value) => value + 1)}
                >
                  Retry saving name
                </Button>
              ) : null}
            </Field>
            {reviewStatus}
          </div>
        ) : null}
      </AuthoringHeader>

      {recording.isPending ? <PageLoading label="Loading the reviewed recording…" /> : null}
      <RecordingReviewProblem
        review={review}
        failure={failedReplay}
        canEdit={canEdit}
        onEditFailure={inspectFailedStep}
        error={recording.error ?? transition.error ?? recoverReview.error ?? leaveDraft.error}
        recovery={
          transition.isPending || recoverReview.error
            ? undefined
            : (transition.data?.recovery ?? state?.recovery)
        }
        onRetry={() => {
          void recording.refetch().then((result) => {
            if (!result.error && result.data && !blocksReview(result.data)) transition.reset();
          });
        }}
        retrying={recording.isFetching}
        recover={
          canRecoverReview
            ? { pending: recoverReview.isPending, onRecover: () => recoverReview.mutate() }
            : undefined
        }
      />

      {leaveDraft.error ? (
        <p role="alert" className="m-0 rounded-lg border border-border p-3 text-sm">
          Could not confirm the saved draft. Your work is still open here. Try saving the draft
          again when the connection returns.
        </p>
      ) : null}

      {!recording.isPending && snapshot && review ? (
        <>
          <RecordingReviewLayout
            outline={
              <RecordingActionsPanel
                actions={actions}
                selectedActionIds={selectedActionIds}
                optimization={{
                  isFetching: optimization.isFetching,
                  isFetched: optimization.isFetched,
                  suggestions: optimization.data?.proposal?.suggestions ?? [],
                }}
                canOptimize={Boolean(sessionId)}
                editing={editing}
                selecting={selecting}
                onSelectionModeChange={(active) => {
                  setSelecting(active);
                  if (active) {
                    setEditing(true);
                    setSelectedActionIds([]);
                  }
                }}
                onOptimize={() => void optimization.refetch()}
                onSelect={(actionId) => {
                  if (selecting) toggleAction(actionId, !selectedActionIds.includes(actionId));
                  else {
                    setSelectedActionIds([actionId]);
                    setSelectedEvidenceId(undefined);
                  }
                }}
                onToggle={toggleAction}
                failedActionId={failedReplay?.actionId}
              />
            }
            stage={
              <RecordingEvidencePanel
                action={selectedAction}
                stepNumber={selectedIndex >= 0 ? selectedIndex + 1 : undefined}
                exactMoment={Boolean(matchingEvidence)}
                controls={evidencePreview.data?.controls ?? []}
                evidenceRole={evidenceRole}
                previewUrl={evidenceUrl}
                loading={Boolean(
                  evidence && !evidencePreview.error && (!evidencePreview.data || !evidenceUrl),
                )}
                fullPage={evidencePreview.data?.fullPage}
                onEvidenceSelect={(id) => setSelectedEvidenceId(id)}
                failureEvidence={Boolean(failureEvidence)}
                showingReplayFailure={showingReplayFailure}
                onShowReplayFailure={() => setSelectedEvidenceId(failureEvidence?.id)}
                onEvidenceRoleChange={(role) => {
                  setSelectedEvidenceId(undefined);
                  setEvidenceRole(role);
                }}
              />
            }
            inspector={
              editing ? (
                <RecordingReviewInspector
                  actions={actions}
                  selectedActions={selectedActions}
                  selectedAction={selectedAction}
                  selectedIndex={selectedIndex}
                  actionIntent={actionIntent}
                  setActionIntent={setActionIntent}
                  splitAfterStep={splitAfterStep}
                  setSplitAfterStep={setSplitAfterStep}
                  canEdit={canEdit}
                  selectionIsContiguous={selectionIsContiguous}
                  onEdit={edit}
                  onSaveWait={async (edit) => {
                    const result = await transition.mutateAsync(
                      reviewEditIntent(edit, currentRevision),
                    );
                    if (blocksReview(result))
                      throw new Error("Could not save wait conditions. Try again.");
                  }}
                  onMoveSelected={moveSelected}
                  state={state}
                  productService={productService}
                  controls={evidencePreview.data?.controls ?? []}
                  previewUrl={evidenceUrl}
                />
              ) : undefined
            }
          />

          {editing && review?.timeline ? (
            <RecordingTrimPanel
              durationMs={review.timeline.durationMs}
              moments={actions.map((action) => ({
                id: action.id,
                label: action.intent,
                timeMs: Math.max(
                  0,
                  (action.startedAt ?? review.timeline!.startedAt) - review.timeline!.startedAt,
                ),
              }))}
              selectedId={selectedAction?.id}
              onSelect={(id) => setSelectedActionIds([id])}
              savedStartMs={review.videoClip?.startMs}
              savedEndMs={review.videoClip?.endMs}
              trimStartMs={trimStartMs}
              trimEndMs={trimEndMs}
              setTrimStartMs={setTrimStartMs}
              setTrimEndMs={setTrimEndMs}
              canEdit={canEdit}
              onApply={(fromMs, toMs) => edit({ kind: "clip", fromMs, toMs })}
            />
          ) : null}
        </>
      ) : null}
    </WorkbenchPage>
  );
}
