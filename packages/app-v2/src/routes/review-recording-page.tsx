/** @jsxImportSource react */
import type { AuthoringRecordingEdit } from "@relay/protocol";
import {
  Button,
  Checkbox,
  Dialog,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  ScrollArea,
} from "@relay/ui-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useRouteContext } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Combine,
  MoreHorizontal,
  RotateCcw,
  Save,
  Scissors,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Breadcrumbs, EmptyState } from "../components/product-patterns";
import { recordingQueryKeys, refreshRecording } from "../data/recording-queries";
import type { ProductRecordingState } from "../data/recording-product-service";
import { clearWorkflowPointerIfCurrent } from "../data/workflow-pointer";
import { PageLoading, RecordingProblem } from "./recording-shared";

const routeApi = getRouteApi("/recordings/$recordingId/review");

export function ReviewRecordingPage() {
  const { productService, platform, queryClient } = useRouteContext({ from: "__root__" });
  const { recordingId } = routeApi.useParams();
  const workflowId = recordingId;
  const nameDraftKey = `recordingName:${workflowId}`;
  const [testName, setTestName] = useState("");
  const [selectedActionIds, setSelectedActionIds] = useState<readonly string[]>([]);
  const [actionIntent, setActionIntent] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [nameDraftLoaded, setNameDraftLoaded] = useState(false);
  const suggestionApplied = useRef(false);

  useEffect(() => {
    let disposed = false;
    void Promise.resolve(platform.storage.get(nameDraftKey)).then((stored) => {
      if (disposed) return;
      if (stored) {
        setTestName(stored);
        suggestionApplied.current = true;
      }
      setNameDraftLoaded(true);
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
    mutationFn: (
      intent:
        | { action: "replay" }
        | { action: "approve"; testName: string }
        | { action: "edit"; edit: AuthoringRecordingEdit },
    ) => {
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

  useEffect(() => {
    if (!nameDraftLoaded || suggestionApplied.current || !snapshot) return;
    suggestionApplied.current = true;
    if (snapshot.title !== "Untitled recording") setTestName(snapshot.title);
  }, [nameDraftLoaded, snapshot]);

  useEffect(() => {
    if (saved || !nameDraftLoaded) return;
    if (testName) void Promise.resolve(platform.storage.set(nameDraftKey, testName));
    else void Promise.resolve(platform.storage.remove?.(nameDraftKey));
  }, [nameDraftKey, nameDraftLoaded, platform, saved, testName]);

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

  function edit(edit: AuthoringRecordingEdit) {
    transition.mutate({ action: "edit", edit });
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

  if (saved) {
    return (
      <section className="relay-review-page relay-review-complete">
        <div className="relay-review-complete-mark" aria-hidden="true">
          <Check />
        </div>
        <p className="relay-eyebrow">Test saved</p>
        <h1>{snapshot.title}</h1>
        <p>Relay verified the reviewed recording. This Test is ready to run.</p>
        <div className="relay-review-complete-actions">
          {committedTestId ? (
            <Button
              render={<Link to="/tests/$testId" params={{ testId: committedTestId }} />}
              variant="primary"
            >
              Open Test
            </Button>
          ) : null}
          <Button render={<Link to="/tests" />} variant="secondary">
            All Tests
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="relay-review-page">
      <Breadcrumbs items={[{ label: "Tests", to: "/tests" }, { label: "Review" }]} />
      <header className="relay-review-header relay-electron-drag">
        <div>
          <h1>Review your recording</h1>
          <p>{reviewInstruction(review?.replayRequired, canApprove)}</p>
        </div>
      </header>

      {recording.isPending ? <PageLoading label="Loading the reviewed recording…" /> : null}
      <RecordingProblem
        error={recording.error ?? transition.error}
        recovery={transition.data?.recovery ?? state?.recovery}
        onRetry={() => void recording.refetch()}
        retrying={recording.isFetching}
      />

      {!recording.isPending && snapshot && reviewReady ? (
        <div className="relay-review-layout">
          <div className="relay-review-main">
            <div className="relay-review-section-heading">
              <div>
                <p className="relay-section-label">Journey</p>
                <h2>{recordedMomentCount(review?.actionCount ?? 0)}</h2>
              </div>
              <span>{captureSummary(review?.actions ?? [])}</span>
            </div>

            {actions.length ? (
              <ScrollArea className="relay-review-actions-scroll">
                <ol className="relay-review-steps" aria-label="Recorded actions">
                  {actions.map((step, index) => {
                    const copy = reviewActionCopy(step);
                    const ordinal = actions
                      .slice(0, index + 1)
                      .filter((candidate) => reviewActionCopy(candidate).kind !== "pause").length;
                    const selected = selectedActionIds.includes(step.id);
                    return (
                      <li
                        className={`relay-review-step relay-review-step--${copy.kind}${selected ? " relay-review-step--selected" : ""}`}
                        key={step.id}
                      >
                        <Checkbox
                          checked={selected}
                          onCheckedChange={(checked) => toggleAction(step.id, checked)}
                          aria-label={`Select ${copy.title}`}
                        />
                        <span className="relay-review-step-number" aria-hidden="true">
                          {copy.kind === "pause" ? <MoreHorizontal /> : ordinal}
                        </span>
                        <button
                          type="button"
                          className="relay-review-step-copy"
                          onClick={() => setSelectedActionIds([step.id])}
                        >
                          <strong>{copy.title}</strong>
                          <p>{copy.detail}</p>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </ScrollArea>
            ) : (
              <EmptyState
                title="No recorded moments are available"
                detail="Return to recording and interact with the app before saving this Test."
              />
            )}
          </div>

          <aside className="relay-review-sidebar" aria-label="Replay and save">
            <section className="relay-review-editor" aria-labelledby="review-editor-title">
              <div className="relay-review-editor-heading">
                <div>
                  <p className="relay-section-label">Edit</p>
                  <h2 id="review-editor-title">
                    {selectedActions.length === 0
                      ? "Select an action"
                      : selectedActions.length === 1
                        ? "Action details"
                        : `${selectedActions.length} actions selected`}
                  </h2>
                </div>
                {selectedActions.length ? <span>{selectedActions.length} selected</span> : null}
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
                    size="small"
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
                  <div className="relay-review-edit-row" aria-label="Reorder action">
                    <Button
                      size="small"
                      variant="ghost"
                      onClick={() => moveSelected(-1)}
                      disabled={!canEdit || selectedIndex <= 0}
                    >
                      <ArrowUp aria-hidden="true" /> Move up
                    </Button>
                    <Button
                      size="small"
                      variant="ghost"
                      onClick={() => moveSelected(1)}
                      disabled={!canEdit || selectedIndex === actions.length - 1}
                    >
                      <ArrowDown aria-hidden="true" /> Move down
                    </Button>
                  </div>
                  {selectedAction.stepCount > 1 ? (
                    <Button
                      size="small"
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
                  size="small"
                  onClick={() =>
                    edit({ kind: "merge", actionIds: selectedActions.map((action) => action.id) })
                  }
                  disabled={!canEdit || !selectionIsContiguous}
                >
                  <Combine aria-hidden="true" /> Merge actions
                </Button>
              ) : (
                <p className="relay-review-editor-help">
                  Choose an action to rename, reorder, split, or remove it.
                </p>
              )}

              {selectedActions.length ? (
                <Dialog.Root open={deleteOpen} onOpenChange={setDeleteOpen}>
                  <Dialog.Trigger
                    render={
                      <Button
                        size="small"
                        variant="ghost"
                        className="relay-review-delete"
                        disabled={!canEdit}
                      />
                    }
                  >
                    <Trash2 aria-hidden="true" /> Remove{" "}
                    {selectedActions.length === 1 ? "action" : "actions"}
                  </Dialog.Trigger>
                  <Dialog.Portal>
                    <Dialog.Backdrop className="relay-dialog-backdrop" />
                    <Dialog.Viewport className="relay-dialog-viewport">
                      <Dialog.Popup className="relay-overlay-popup relay-dialog-popup">
                        <Dialog.Title>
                          Remove selected {selectedActions.length === 1 ? "action" : "actions"}?
                        </Dialog.Title>
                        <Dialog.Description>
                          This changes the journey and requires a new replay before saving.
                        </Dialog.Description>
                        <div className="relay-dialog-actions">
                          <Dialog.Close render={<Button variant="ghost">Cancel</Button>} />
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
                      </Dialog.Popup>
                    </Dialog.Viewport>
                  </Dialog.Portal>
                </Dialog.Root>
              ) : null}
            </section>

            <div className="relay-review-save-panel">
              <Field>
                <FieldLabel htmlFor="review-test-name">Test name</FieldLabel>
                <Input
                  id="review-test-name"
                  value={testName}
                  onChange={(event) => setTestName(event.currentTarget.value)}
                  placeholder="For example, Change the app language"
                  maxLength={160}
                  autoComplete="off"
                  spellCheck
                  required
                />
                <FieldDescription>Name the outcome a teammate should recognize.</FieldDescription>
              </Field>
              <div className="relay-replay-status">
                <p className="relay-section-label">Replay</p>
                <h2>
                  {replayTitle(review?.latestReplay?.outcome, review?.replayRequired, canApprove)}
                </h2>
                <p>{replayDetail(review?.latestReplay?.outcome, canApprove)}</p>
              </div>

              {canApprove ? (
                <Button
                  variant="primary"
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
                  variant="primary"
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

type ReviewAction = NonNullable<
  NonNullable<ProductRecordingState["snapshot"]>["review"]
>["actions"][number];

function recordedMomentCount(count: number): string {
  return count === 1 ? "1 recorded moment" : `${count} recorded moments`;
}

function reviewActionCopy(action: ReviewAction): {
  title: string;
  detail: string;
  kind: "action" | "checkpoint" | "observation" | "pause";
} {
  const proof = action.proofStatus ? proofLabel(action.proofStatus) : undefined;
  if (isPauseAction(action)) {
    return { title: "Pause", detail: "Relay waited before the next capture.", kind: "pause" };
  }
  if (
    action.stepCount === 0 &&
    (/^0 recorded steps$/iu.test(action.intent) || /^0 recorded steps$/iu.test(action.label ?? ""))
  ) {
    return {
      title: "Screen captured",
      detail: proof ?? "Current state captured",
      kind: "observation",
    };
  }
  if (action.stepCount === 0 && action.label) {
    return {
      title: action.label,
      detail: proof ? `Checkpoint · ${proof}` : "Checkpoint",
      kind: "checkpoint",
    };
  }
  if (action.stepCount === 0 || /^0 recorded steps$/i.test(action.intent)) {
    return {
      title: "Screen captured",
      detail: proof ?? "Current state captured",
      kind: "observation",
    };
  }
  const count = action.stepCount === 1 ? "1 action" : `${action.stepCount} actions`;
  return {
    title: action.label ?? humanActionTitle(action.intent),
    detail: proof ? `${count} · ${proof}` : count,
    kind: "action",
  };
}

function isPauseAction(action: ReviewAction): boolean {
  return /^recorded pause$/iu.test(action.label ?? "") || /^recorded pause$/iu.test(action.intent);
}

function humanActionTitle(intent: string): string {
  const value = intent.trim();
  if (/^(?:tap|click)(?: (?:the|a))? (?:target|captured target)$/iu.test(value)) {
    return "Tap the highlighted target";
  }
  const namedTarget = /^(?:tap|click)\s+[“'"](.+)[”'"]$/iu.exec(value)?.[1]?.trim();
  if (namedTarget) return `Tap ${namedTarget}`;
  const direct = /^(?:tap|click)\s+(?:label|text)\s+(.+)$/iu.exec(value)?.[1]?.trim();
  if (direct) return `Tap ${direct.replace(/^['"]|['"]$/gu, "")}`;
  if (/^(?:scroll|swipe)\b/iu.test(value)) return "Scroll";
  if (/^(?:type|enter text)\b/iu.test(value)) return "Type text";
  if (/^(?:press|key)\s+enter$/iu.test(value)) return "Press Enter";
  if (/identifier|selector|xpath|coordinates?|app:id|\{.+\}/iu.test(value)) {
    return "Recorded interaction";
  }
  return value || "Recorded interaction";
}

function captureSummary(actions: readonly ReviewAction[]): string {
  if (actions.length === 0) return "Nothing captured";
  if (actions.every((action) => action.captureProof === "replay-proved")) {
    return "Verified by Relay";
  }
  if (
    actions.some(
      (action) =>
        action.captureProof === "inferred-unproved" ||
        action.captureProof === "instrumented-unproved",
    )
  ) {
    return "Replay needed";
  }
  return "Captured by Relay";
}

function reviewInstruction(replayRequired: boolean | undefined, canApprove: boolean): string {
  if (canApprove) return "Review what Relay captured, then save the Test when it looks right.";
  if (replayRequired) return "Review what Relay captured, then replay it before saving the Test.";
  return "Review what Relay captured while Relay prepares the next action.";
}

function replayTitle(
  outcome: "passed" | "failed" | "cancelled" | undefined,
  required: boolean | undefined,
  canApprove: boolean,
) {
  if (canApprove) return "Ready to save";
  if (outcome === "passed" && !required) return "Verified";
  if (outcome === "failed") return "Replay needs attention";
  if (outcome === "cancelled") return "Replay was cancelled";
  return "Replay required";
}

function replayDetail(outcome: "passed" | "failed" | "cancelled" | undefined, canApprove: boolean) {
  if (outcome === "passed" && canApprove) {
    return "Relay verified this exact reviewed version. It can now be saved.";
  }
  if (outcome === "passed") return "Relay verified this exact reviewed version.";
  if (outcome === "failed") {
    return "Relay could not verify the recorded journey. Check the target, then replay it again.";
  }
  if (outcome === "cancelled") return "Run the replay again when the target is ready.";
  return "Replay the reviewed steps on the selected target.";
}
