import { RecordingTrimPanel } from "./recording-trim-panel";
/** @jsxImportSource react */
import { EditorSaveStatus } from "../components/editor-save-status";
import { WorkbenchPage, PageHeader, WorkbenchPanes } from "../components/page-layout";
import {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@relay/ui-react/components/dialog";
import type { AuthoringRecordingEdit } from "@relay/protocol";
import { Field, FieldDescription, FieldLabel } from "@relay/ui-react/components/field";
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useRouteContext } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowUp,
  Combine,
  Redo2,
  RotateCcw,
  Save,
  Scissors,
  Trash2,
  Undo2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { recordingQueryKeys, refreshRecording } from "../data/recording-queries";
import { clearWorkflowPointerIfCurrent } from "../data/workflow-pointer";
import { PageLoading, RecordingProblem } from "./recording-shared";
import { RecordingActionsPanel, RecordingEvidencePanel } from "./recording-review-panels";
import {
  replayDetail,
  replayTitle,
  reviewInstruction,
  useEvidenceObjectUrl,
} from "./recording-review-presentation";

import { reviewPersistence } from "../data/recording-review-persistence";
import { tryReviewTarget } from "../data/recording-try-target";
import { useRecordingNameDraft } from "../data/use-recording-name-draft";
import { RecordingTargetPicker } from "./recording-target-picker";

type ReviewTransitionIntent =
  | { action: "replay" }
  | { action: "approve"; testName: string }
  | {
      action: "edit";
      edit: AuthoringRecordingEdit;
      history?: { kind: "new" | "undo" | "redo"; fromRevision: number };
    };

export function ReviewRecordingPage({
  recordingId: recordingIdProp,
}: { recordingId?: string } = {}) {
  const { productService, platform, queryClient } = useRouteContext({ from: "__root__" });
  const params = useParams({ strict: false }) as { recordingId?: string };
  const recordingId = recordingIdProp ?? params.recordingId ?? "";
  const navigate = useNavigate();
  const workflowId = recordingId;
  const nameDraftKey = `recordingName:${workflowId}`;
  const [selectedActionIds, setSelectedActionIds] = useState<readonly string[]>([]);
  const [actionIntent, setActionIntent] = useState("");
  const [splitAfterStep, setSplitAfterStep] = useState(1);
  const [evidenceRole, setEvidenceRole] = useState<"entrance" | "exit">("exit");
  const [trimStartMs, setTrimStartMs] = useState(0);
  const [trimEndMs, setTrimEndMs] = useState(0);
  const [undoStack, setUndoStack] = useState<readonly number[]>([]);
  const [redoStack, setRedoStack] = useState<readonly number[]>([]);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const historyInitialized = useRef(false);

  const recording = useQuery({
    queryKey: recordingQueryKeys.workflow(workflowId),
    queryFn: () => productService.inspect(workflowId),
    staleTime: 0,
  });
  const transition = useMutation({
    mutationFn: (intent: ReviewTransitionIntent) => {
      if (intent.action === "replay") return productService.replay();
      if (intent.action === "edit") return productService.edit(intent.edit);
      return productService.approve(intent.testName);
    },
    onSuccess: async (state, intent) => {
      const canonical = await refreshRecording(queryClient, productService, workflowId);
      if (state.recovery || canonical.recovery) return;
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
        await Promise.resolve(platform.storage.remove?.(nameDraftKey));
        if (await clearWorkflowPointerIfCurrent(platform, workflowId)) {
          queryClient.setQueryData<string | null>(recordingQueryKeys.pointer, null);
          queryClient.setQueryData<string | null>(recordingQueryKeys.reconciledPointer, null);
        }
      }
    },
  });

  const leaveDraft = useMutation({
    mutationFn: async () => {
      await nameWrites.current;
      const persisted = await productService.inspect(workflowId);
      if (persisted.recovery || !persisted.snapshot?.review)
        throw new Error("Could not confirm the saved draft. Keep this page open and try again.");
      return persisted;
    },
    onSuccess: async () => {
      await navigate({ to: "/tests" });
    },
  });

  const state = recording.data;
  const snapshot = state?.snapshot;
  const review = snapshot?.review;
  const reviewReady = Boolean(
    snapshot && !state?.recovery && !recording.error && !transition.data?.recovery,
  );
  const allowed = new Set(reviewReady ? (snapshot?.allowedNextActions ?? []) : []);
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
  const canApprove = allowed.has("approve");
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
  const sessionId = snapshot?.authoring?.sessionId;
  const optimization = useQuery({
    queryKey: ["recording-optimization", sessionId ?? "unselected", currentRevision ?? 0],
    queryFn: () => productService.getOptimization(sessionId!),
    enabled: false,
  });
  const evidence =
    selectedAction?.evidence?.find(
      (candidate) => candidate.kind === "screenshot" && candidate.roles.includes(evidenceRole),
    ) ?? selectedAction?.evidence?.find((candidate) => candidate.kind === "screenshot");
  const evidencePreview = useQuery({
    queryKey: ["recording-evidence-preview", sessionId ?? "unselected", evidence?.id ?? "none"],
    queryFn: () => productService.getEvidencePreview(sessionId!, evidence!.id),
    enabled: Boolean(sessionId && evidence),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const evidenceUrl = useEvidenceObjectUrl(evidencePreview.data);

  useEffect(() => {
    if (!saved) return;
    void clearWorkflowPointerIfCurrent(platform, workflowId).then((cleared) => {
      if (cleared) {
        queryClient.setQueryData<string | null>(recordingQueryKeys.pointer, null);
        queryClient.setQueryData<string | null>(recordingQueryKeys.reconciledPointer, null);
      }
    });
  }, [platform, queryClient, saved, workflowId]);

  useEffect(() => {
    if (actions.length === 0) {
      setSelectedActionIds([]);
      return;
    }
    setSelectedActionIds((current) =>
      current.some((id) => actions.some((action) => action.id === id)) ? current : [actions[0]!.id],
    );
  }, [actions]);

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
    transition.mutate({
      action: "edit",
      edit,
      ...(currentRevision
        ? { history: { kind: "new" as const, fromRevision: currentRevision } }
        : {}),
    });
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
    if (saved && committedTestId) {
      void navigate({ to: "/tests/$testId", params: { testId: committedTestId }, replace: true });
    }
  }, [saved, committedTestId, navigate]);

  if (saved) {
    return <PageLoading label="Opening the saved Test…" />;
  }

  return (
    <WorkbenchPage className="w-full max-w-[1480px] px-[clamp(22px,3vw,42px)] py-[clamp(22px,3vw,42px)]">
      <PageHeader
        crumbs={[{ label: "Tests", to: "/tests" }, { label: "Review" }]}
        title={testName || snapshot?.title || "Review your recording"}
        description={reviewInstruction(review?.replayRequired, canApprove)}
        actions={
          reviewReady ? (
            <>
              {canApprove ? (
                <Button
                  variant="default"
                  onClick={() =>
                    transition.mutate({ action: "approve", testName: testName.trim() })
                  }
                  disabled={transition.isPending || !testName.trim()}
                >
                  <Save aria-hidden="true" />
                  {transition.isPending && transition.variables?.action === "approve"
                    ? "Saving…"
                    : "Save Test"}
                </Button>
              ) : allowed.has("replay") ? (
                <Button
                  variant="default"
                  onClick={() => transition.mutate({ action: "replay" })}
                  disabled={transition.isPending}
                >
                  <RotateCcw aria-hidden="true" />
                  {transition.isPending ? "Replaying…" : "Replay recording"}
                </Button>
              ) : null}
              <Button variant="ghost" onClick={() => setEditing((open) => !open)}>
                {editing ? "Done" : "Edit"}
              </Button>
              <Button
                variant="ghost"
                disabled={
                  transition.isPending ||
                  leaveDraft.isPending ||
                  nameSaveState === "saving" ||
                  nameSaveState === "failed"
                }
                onClick={() => leaveDraft.mutate()}
              >
                {leaveDraft.isPending ? "Leaving…" : "Back to Tests"}
              </Button>
              <EditorSaveStatus state={persistence.editorState} detail={persistence.label} />
            </>
          ) : undefined
        }
      >
        {reviewReady ? (
          <div className="grid max-w-xl gap-3">
            <Field>
              <FieldLabel htmlFor="review-test-name">Test name</FieldLabel>
              <Input
                id="review-test-name"
                value={testName}
                disabled={leaveDraft.isPending || transition.isPending}
                onChange={(event) => {
                  nameEdits.current += 1;
                  setNameSaveState("dirty");
                  setTestName(event.currentTarget.value);
                }}
                placeholder="For example, Change the app language"
                maxLength={160}
                autoComplete="off"
                spellCheck
                required
              />
              <FieldDescription>
                {nameSaveError ??
                  (persistence.kind === "name-only"
                    ? persistence.detail
                    : testName
                      ? "The name is kept on this computer. It does not change the recorded steps."
                      : "Name the outcome a teammate should recognize.")}
              </FieldDescription>
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
            <p
              className="text-xs text-muted-foreground"
              role="status"
              aria-label="Verification status"
            >
              {replayTitle(review?.latestReplay?.outcome, review?.replayRequired, canApprove)}
            </p>
            <p className="text-xs leading-normal text-muted-foreground">
              {replayDetail(review?.latestReplay?.outcome, canApprove)}
            </p>
          </div>
        ) : null}
      </PageHeader>

      {recording.isPending ? <PageLoading label="Loading the reviewed recording…" /> : null}
      <RecordingProblem
        error={recording.error ?? transition.error ?? leaveDraft.error}
        recovery={transition.data?.recovery ?? state?.recovery}
        onRetry={() => void recording.refetch()}
        retrying={recording.isFetching}
      />

      {leaveDraft.error ? (
        <p role="alert" className="m-0 rounded-lg border border-border p-3 text-[13px]">
          Could not confirm the saved draft. Your work is still open here. Try Back to Tests again
          when the connection returns.
        </p>
      ) : null}

      {!recording.isPending && snapshot && reviewReady ? (
        <>
          <WorkbenchPanes
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
                onOptimize={() => void optimization.refetch()}
                onSelect={(actionId) => setSelectedActionIds([actionId])}
                onToggle={toggleAction}
              />
            }
            stage={
              <RecordingEvidencePanel
                action={selectedAction}
                evidenceRole={evidenceRole}
                previewUrl={evidenceUrl}
                onEvidenceRoleChange={setEvidenceRole}
              />
            }
            inspector={
              editing ? (
                <aside
                  className="flex min-w-0 flex-col gap-[18px] self-start rounded-xl border border-border bg-card p-[18px] text-card-foreground shadow-sm"
                  aria-label="Edit steps"
                >
                  <section className="grid gap-3.5" aria-labelledby="review-editor-title">
                    <div className="flex flex-wrap items-center justify-between gap-3.5">
                      <div>
                        <h2 id="review-editor-title">
                          {selectedActions.length === 0
                            ? "Select a step"
                            : selectedActions.length === 1
                              ? "Step details"
                              : `${selectedActions.length} steps selected`}
                        </h2>
                      </div>
                      <div className="flex items-center gap-2" aria-label="Edit history">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => restore("undo")}
                          disabled={!canEdit || undoStack.length === 0}
                        >
                          <Undo2 aria-hidden="true" /> Undo
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => restore("redo")}
                          disabled={!canEdit || redoStack.length === 0}
                        >
                          <Redo2 aria-hidden="true" /> Redo
                        </Button>
                      </div>
                    </div>

                    {selectedAction ? (
                      <>
                        <Field>
                          <FieldLabel htmlFor="review-action-intent">Instruction</FieldLabel>
                          <Input
                            id="review-action-intent"
                            value={actionIntent}
                            onChange={(event) => setActionIntent(event.currentTarget.value)}
                            maxLength={240}
                            disabled={!canEdit}
                          />
                          <FieldDescription>
                            Describe the outcome in plain language.
                          </FieldDescription>
                        </Field>
                        <Button
                          size="sm"
                          onClick={() =>
                            edit({
                              kind: "rename",
                              actionId: selectedAction.id,
                              intent: actionIntent.trim(),
                            })
                          }
                          disabled={
                            !canEdit ||
                            !actionIntent.trim() ||
                            actionIntent.trim() === selectedAction.intent
                          }
                        >
                          Save instruction
                        </Button>
                        {selectedAction.kind === "tap" ? (
                          <RecordingTargetPicker
                            controls={evidencePreview.data?.controls ?? []}
                            canEdit={canEdit}
                            previewUrl={evidenceUrl}
                            onTry={(control) =>
                              tryReviewTarget({
                                previewTarget: productService.previewTarget,
                                selectedTarget: state?.selectedTarget,
                                control,
                              })
                            }
                            onKeep={(target) =>
                              edit({
                                kind: "replace",
                                actionId: selectedAction.id,
                                interaction: { kind: "tap", target },
                              })
                            }
                          />
                        ) : null}
                        <div
                          className="flex flex-wrap items-center gap-2"
                          aria-label="Reorder action"
                        >
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => moveSelected(-1)}
                            disabled={!canEdit || selectedIndex <= 0}
                          >
                            <ArrowUp aria-hidden="true" /> Move up
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => moveSelected(1)}
                            disabled={!canEdit || selectedIndex === actions.length - 1}
                          >
                            <ArrowDown aria-hidden="true" /> Move down
                          </Button>
                        </div>
                        {selectedAction.stepCount > 1 ? (
                          <label className="grid gap-1 text-sm">
                            <span className="text-xs text-muted-foreground">
                              Split after selected step
                            </span>
                            <select
                              className="min-h-10 rounded-md border border-border bg-background px-3"
                              value={Math.min(splitAfterStep, selectedAction.stepCount - 1)}
                              onChange={(event) =>
                                setSplitAfterStep(Number.parseInt(event.target.value, 10))
                              }
                              disabled={!canEdit}
                            >
                              {Array.from(
                                { length: selectedAction.stepCount - 1 },
                                (_, index) => index + 1,
                              ).map((step) => (
                                <option key={step} value={step}>
                                  After step {step}
                                </option>
                              ))}
                            </select>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                edit({
                                  kind: "split",
                                  actionId: selectedAction.id,
                                  atStep: Math.min(splitAfterStep, selectedAction.stepCount - 1),
                                })
                              }
                              disabled={!canEdit}
                            >
                              <Scissors aria-hidden="true" /> Split action
                            </Button>
                          </label>
                        ) : null}
                      </>
                    ) : selectedActions.length > 1 ? (
                      <Button
                        size="sm"
                        onClick={() =>
                          edit({
                            kind: "merge",
                            actionIds: selectedActions.map((action) => action.id),
                          })
                        }
                        disabled={!canEdit || !selectionIsContiguous}
                      >
                        <Combine aria-hidden="true" /> Merge actions
                      </Button>
                    ) : (
                      <p className="text-xs leading-normal text-muted-foreground">
                        Choose a step to rename, reorder, replace, split, or remove it.
                      </p>
                    )}

                    {selectedActions.length ? (
                      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                        <DialogTrigger
                          render={
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive"
                              disabled={!canEdit}
                            />
                          }
                        >
                          <Trash2 aria-hidden="true" /> Remove{" "}
                          {selectedActions.length === 1 ? "action" : "actions"}
                        </DialogTrigger>

                        <DialogContent showCloseButton={false}>
                          <DialogTitle>
                            Remove selected {selectedActions.length === 1 ? "action" : "actions"}?
                          </DialogTitle>
                          <DialogDescription>
                            This changes the steps and requires a new replay before saving.
                          </DialogDescription>
                          <div className="relay-dialog-actions flex flex-wrap items-center justify-end gap-2.5">
                            <DialogClose render={<Button variant="ghost">Cancel</Button>} />
                            <Button
                              className="grid gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3"
                              onClick={() => {
                                setDeleteOpen(false);
                                edit({
                                  kind: "remove",
                                  actionIds: selectedActions.map((action) => action.id),
                                });
                              }}
                            >
                              Remove
                            </Button>
                          </div>
                        </DialogContent>
                      </Dialog>
                    ) : null}
                  </section>

                  <div className="grid gap-3.5">
                    <p className="text-xs leading-normal text-muted-foreground">
                      {replayDetail(review?.latestReplay?.outcome, canApprove)}
                    </p>
                    {allowed.has("replay") && review?.replayRequired ? (
                      <p className="text-xs text-muted-foreground">
                        A passing replay is required before saving.
                      </p>
                    ) : null}
                  </div>
                </aside>
              ) : undefined
            }
          />

          {editing && review?.timeline ? (
            <RecordingTrimPanel
              durationMs={review.timeline.durationMs}
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
