/** @jsxImportSource react */
import { EditorSaveStatus, type EditorSaveState } from "../components/editor-save-status";
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
import { Link, getRouteApi, useNavigate, useRouteContext } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowUp,
  Clock3,
  Combine,
  Redo2,
  RotateCcw,
  Save,
  Scissors,
  Target,
  Trash2,
  Undo2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Breadcrumbs } from "../components/product-patterns";
import { recordingQueryKeys, refreshRecording } from "../data/recording-queries";
import { clearWorkflowPointerIfCurrent } from "../data/workflow-pointer";
import { PageLoading, RecordingProblem } from "./recording-shared";
import { RecordingActionsPanel, RecordingEvidencePanel } from "./recording-review-panels";
import {
  formatDuration,
  replayDetail,
  replayTitle,
  reviewInstruction,
  useEvidenceObjectUrl,
} from "./recording-review-presentation";

const routeApi = getRouteApi("/recordings/$recordingId/review");

type ReviewTransitionIntent =
  | { action: "replay" }
  | { action: "approve"; testName: string }
  | {
      action: "edit";
      edit: AuthoringRecordingEdit;
      history?: { kind: "new" | "undo" | "redo"; fromRevision: number };
    };

export function ReviewRecordingPage() {
  const { productService, platform, queryClient } = useRouteContext({ from: "__root__" });
  const { recordingId } = routeApi.useParams();
  const navigate = useNavigate();
  const workflowId = recordingId;
  const nameDraftKey = `recordingName:${workflowId}`;
  const [testName, setTestName] = useState("");
  const [selectedActionIds, setSelectedActionIds] = useState<readonly string[]>([]);
  const [actionIntent, setActionIntent] = useState("");
  const [replacementLabel, setReplacementLabel] = useState("");
  const [evidenceRole, setEvidenceRole] = useState<"entrance" | "exit">("exit");
  const [trimStartMs, setTrimStartMs] = useState(0);
  const [trimEndMs, setTrimEndMs] = useState(0);
  const [undoStack, setUndoStack] = useState<readonly number[]>([]);
  const [redoStack, setRedoStack] = useState<readonly number[]>([]);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [nameDraftLoaded, setNameDraftLoaded] = useState(false);
  const [nameSaveState, setNameSaveState] = useState<EditorSaveState>("saved");
  const [nameSaveError, setNameSaveError] = useState<string>();
  const [nameSaveAttempt, setNameSaveAttempt] = useState(0);
  const nameEdits = useRef(0);
  const nameWrites = useRef(Promise.resolve());
  const suggestionApplied = useRef(false);
  const historyInitialized = useRef(false);

  useEffect(() => {
    let disposed = false;
    const version = nameEdits.current;
    void Promise.resolve().then(() => platform.storage.get(nameDraftKey)).then((stored) => {
      if (disposed) return;
      if (stored && nameEdits.current === version) {
        setTestName(stored);
        suggestionApplied.current = true;
      }
      setNameDraftLoaded(true);
    }).catch(() => {
      if (!disposed) {
        setNameDraftLoaded(true);
        setNameSaveState("failed");
        setNameSaveError("Could not load the saved name. Keep this page open until you save the Test.");
      }
    });
    return () => {
      disposed = true;
    };
  }, [nameDraftKey, platform]);

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
    if (!nameDraftLoaded || suggestionApplied.current || !snapshot) return;
    suggestionApplied.current = true;
    if (snapshot.title !== "Untitled recording") setTestName(snapshot.title);
  }, [nameDraftLoaded, snapshot]);

  useEffect(() => {
    if (saved || !nameDraftLoaded || nameEdits.current === 0) return;
    let disposed = false;
    setNameSaveState("saving");
    const write = nameWrites.current.catch(() => undefined).then(async () => {
      if (testName) await platform.storage.set(nameDraftKey, testName);
      else await platform.storage.remove?.(nameDraftKey);
    });
    nameWrites.current = write;
    void write.then(() => {
      if (!disposed) { setNameSaveState("saved"); setNameSaveError(undefined); }
    }).catch(() => {
      if (!disposed) {
        setNameSaveState("failed");
        setNameSaveError("Could not save the name on this computer. Your captured steps remain saved; keep this page open to retry.");
      }
    });
    return () => { disposed = true; };
  }, [nameDraftKey, nameDraftLoaded, platform, saved, testName, nameSaveAttempt]);

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
    setReplacementLabel("");
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
    <WorkbenchPage className="relay-review-page relay-recording-review-page">
      <Breadcrumbs items={[{ label: "Tests", to: "/tests" }, { label: "Review" }]} />
      <PageHeader
        title={testName || snapshot?.title || "Review your recording"}
        context={<><span>Review recording</span>{currentRevision ? <span>Revision {currentRevision}</span> : null}</>}
        description={reviewInstruction(review?.replayRequired, canApprove)}
        actions={reviewReady ? <EditorSaveStatus state={transition.isPending ? "saving" : transition.error ? "failed" : nameSaveState} detail={!transition.isPending && !transition.error && nameSaveState === "saved" ? "Recording draft saved" : undefined} /> : undefined}
      />

      {recording.isPending ? <PageLoading label="Loading the reviewed recording…" /> : null}
      <RecordingProblem
        error={recording.error ?? transition.error}
        recovery={transition.data?.recovery ?? state?.recovery}
        onRetry={() => void recording.refetch()}
        retrying={recording.isFetching}
      />

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
          <aside className="relay-recording-inspector" aria-label="Edit, replay, and save">
            <section className="relay-review-editor" aria-labelledby="review-editor-title">
              <div className="relay-recording-panel-heading">
                <div>
                  <p className="relay-section-label">Inspector</p>
                  <h2 id="review-editor-title">
                    {selectedActions.length === 0
                      ? "Select an action"
                      : selectedActions.length === 1
                        ? "Action details"
                        : `${selectedActions.length} actions selected`}
                  </h2>
                </div>
                <div className="relay-recording-history-actions" aria-label="Edit history">
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
                    <FieldDescription>Describe the outcome in plain language.</FieldDescription>
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
                    <Field>
                      <FieldLabel htmlFor="review-replacement-label">Replace target</FieldLabel>
                      <Input
                        id="review-replacement-label"
                        value={replacementLabel}
                        onChange={(event) => setReplacementLabel(event.currentTarget.value)}
                        placeholder="Accessible label"
                        maxLength={160}
                        disabled={!canEdit}
                      />
                      <FieldDescription>Use the target’s stable accessible name.</FieldDescription>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          edit({
                            kind: "replace",
                            actionId: selectedAction.id,
                            interaction: {
                              kind: "tap",
                              target: { label: replacementLabel.trim() },
                            },
                          })
                        }
                        disabled={!canEdit || !replacementLabel.trim()}
                      >
                        <Target aria-hidden="true" /> Replace target
                      </Button>
                    </Field>
                  ) : null}
                  <div className="relay-review-edit-row" aria-label="Reorder action">
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
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        edit({
                          kind: "split",
                          actionId: selectedAction.id,
                          atStep: Math.ceil(selectedAction.stepCount / 2),
                        })
                      }
                      disabled={!canEdit}
                    >
                      <Scissors aria-hidden="true" /> Split action
                    </Button>
                  ) : null}
                </>
              ) : selectedActions.length > 1 ? (
                <Button
                  size="sm"
                  onClick={() =>
                    edit({ kind: "merge", actionIds: selectedActions.map((action) => action.id) })
                  }
                  disabled={!canEdit || !selectionIsContiguous}
                >
                  <Combine aria-hidden="true" /> Merge actions
                </Button>
              ) : (
                <p className="relay-review-editor-help">
                  Choose an action to rename, reorder, replace, split, or remove it.
                </p>
              )}

              {selectedActions.length ? (
                <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                  <DialogTrigger
                    render={
                      <Button
                        size="sm"
                        variant="ghost"
                        className="relay-review-delete"
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
                      This changes the journey and requires a new replay before saving.
                    </DialogDescription>
                    <div className="relay-dialog-actions">
                      <DialogClose render={<Button variant="ghost">Cancel</Button>} />
                      <Button
                        className="relay-review-delete-confirm"
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

            <div className="relay-review-save-panel">
              <Field>
                <FieldLabel htmlFor="review-test-name">Test name</FieldLabel>
                <Input
                  id="review-test-name"
                  value={testName}
                  onChange={(event) => { nameEdits.current += 1; setNameSaveState("dirty"); setTestName(event.currentTarget.value); }}
                  placeholder="For example, Change the app language"
                  maxLength={160}
                  autoComplete="off"
                  spellCheck
                  required
                />
                <FieldDescription>
                  {nameSaveError ?? (nameSaveState === "saving" ? "Saving the name…" : testName ? "Captured steps are saved on the server. The name is kept on this computer until you save the Test." : "Name the outcome a teammate should recognize.")}
                </FieldDescription>
                {nameSaveError && nameEdits.current > 0 ? <Button variant="outline" size="sm" disabled={nameSaveState === "saving"} onClick={() => setNameSaveAttempt((value) => value + 1)}>Retry saving name</Button> : null}
              </Field>
              <div className="relay-replay-status">
                <p className="relay-section-label">Verification</p>
                <h2>
                  {replayTitle(review?.latestReplay?.outcome, review?.replayRequired, canApprove)}
                </h2>
                <p>{replayDetail(review?.latestReplay?.outcome, canApprove)}</p>
              </div>

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
              ) : (
                <p className="relay-review-waiting" role="status">
                  Waiting for Relay to make the next review action available.
                </p>
              )}
              {allowed.has("replay") && review?.replayRequired ? (
                <p className="relay-save-requirement">
                  A passing replay is required before saving.
                </p>
              ) : null}
            </div>
          </aside>
            }
          />


          {review?.timeline ? (
            <section className="relay-recording-trim" aria-labelledby="recording-trim-title">
              <div className="relay-recording-trim-copy">
                <Clock3 aria-hidden="true" />
                <div>
                  <p className="relay-section-label">Time range</p>
                  <h2 id="recording-trim-title">
                    {formatDuration(trimStartMs)} – {formatDuration(trimEndMs)}
                  </h2>
                </div>
              </div>
              <div className="relay-recording-range-fields">
                <label>
                  Start
                  <input
                    type="range"
                    min={0}
                    max={Math.max(1, review.timeline.durationMs)}
                    value={trimStartMs}
                    onChange={(event) =>
                      setTrimStartMs(Math.min(Number(event.currentTarget.value), trimEndMs))
                    }
                    disabled={!canEdit}
                  />
                </label>
                <label>
                  End
                  <input
                    type="range"
                    min={0}
                    max={Math.max(1, review.timeline.durationMs)}
                    value={trimEndMs}
                    onChange={(event) =>
                      setTrimEndMs(Math.max(Number(event.currentTarget.value), trimStartMs))
                    }
                    disabled={!canEdit}
                  />
                </label>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => edit({ kind: "clip", fromMs: trimStartMs, toMs: trimEndMs })}
                disabled={
                  !canEdit ||
                  (trimStartMs === (review.videoClip?.startMs ?? 0) &&
                    trimEndMs === (review.videoClip?.endMs ?? review.timeline.durationMs))
                }
              >
                Apply trim
              </Button>
            </section>
          ) : null}
        </>
      ) : null}
    </WorkbenchPage>
  );
}
