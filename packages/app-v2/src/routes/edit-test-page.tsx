/** @jsxImportSource react */
import type { AppMapScenarioTestStep, AppMapTestStepPlacement } from "@relay/protocol";
import { Badge } from "@relay/ui-react/components/badge";
import { Button } from "@relay/ui-react/components/button";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useNavigate, useRouteContext } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Check, ChevronRight, GripVertical, Redo2, Undo2 } from "lucide-react";
import { useMemo, useRef, useState, type CSSProperties } from "react";
import { Breadcrumbs, EmptyState } from "../components/product-patterns";
import { TestEditorEvidencePanel } from "../components/test-editor-evidence-panel";
import {
  SelectedStepEditor,
  type EditTransaction,
  type StepEntry,
} from "../components/test-editor-step";
import type {
  ProductTestEditorDocument,
  ProductTestRepair,
} from "../data/test-editor-product-service";
import type { LiveTestEditorSession } from "../data/live-test-editor-product-service";
import { useLatestTestReport } from "../hooks/use-latest-test-report";
import { LiveTestEditorPane } from "./live-test-editor-pane";
import { PageLoading, RecordingProblem } from "./recording-shared";
import { HistorySection, RepairSection } from "./test-editor-context-panels";
import { branchLabel, collectStepEntries, stepKindLabel } from "./test-editor-route-helpers";
import { useTestStepDrafts } from "./use-test-step-drafts";

const routeApi = getRouteApi("/tests/$testId/edit");

export function EditTestPage() {
  const { testId } = routeApi.useParams();
  return <TestEditorDocument key={testId} />;
}

function TestEditorDocument() {
  const { testEditorService, liveTestEditorService, runService, queryClient, platform } =
    useRouteContext({
      from: "__root__",
    });
  const { testId } = routeApi.useParams();
  const search = routeApi.useSearch() as { step?: unknown; session?: unknown };
  const sessionId = typeof search.session === "string" ? search.session : undefined;
  const navigate = useNavigate({ from: "/tests/$testId/edit" });
  const queryKey = useMemo(() => ["test-editor", testId] as const, [testId]);
  const liveQueryKey = useMemo(
    () => ["live-test-editor", testId, sessionId] as const,
    [sessionId, testId],
  );
  const document = useQuery({
    queryKey,
    queryFn: () => testEditorService.get(testId),
    staleTime: 5_000,
    enabled: !sessionId,
  });
  const liveEditor = useQuery({
    queryKey: liveQueryKey,
    queryFn: () => liveTestEditorService.open({ testId, sessionId: sessionId! }),
    staleTime: Number.POSITIVE_INFINITY,
    enabled: Boolean(sessionId),
  });
  const editorDocument = liveEditor.data?.test ?? document.data;
  const entries = useMemo(
    () => collectStepEntries(editorDocument?.test.steps ?? []),
    [editorDocument],
  );
  const requestedStepId = typeof search.step === "string" ? search.step : undefined;
  const selected =
    entries.find((entry) => entry.step.id === requestedStepId) ?? entries.at(0) ?? undefined;
  const {
    recentRuns,
    latestReport,
    loading: reportLoading,
  } = useLatestTestReport(runService, testId);
  const [saveNotice, setSaveNotice] = useState("Saved");
  const { stepDrafts, updateStepDraft, clearStepDraftIfUnchanged } = useTestStepDrafts(
    platform,
    testId,
    setSaveNotice,
  );
  const draggedStepId = useRef<string | undefined>(undefined);
  const selectAfterSave = useRef<string | null | undefined>(undefined);

  function currentLiveEditor(): LiveTestEditorSession | undefined {
    return queryClient.getQueryData<LiveTestEditorSession | undefined>(liveQueryKey);
  }

  function currentDocument(): ProductTestEditorDocument | undefined {
    return currentLiveEditor()?.test ?? queryClient.getQueryData(queryKey);
  }

  function saveDocument(next: ProductTestEditorDocument | LiveTestEditorSession) {
    if ("liveTarget" in next) queryClient.setQueryData(liveQueryKey, next);
    else queryClient.setQueryData(queryKey, next);
  }

  const edit = useMutation({
    mutationFn: async (transaction: EditTransaction) => {
      const live = currentLiveEditor();
      if (live) return liveTestEditorService.edit({ current: live, edits: transaction.forward });
      const current = currentDocument();
      if (!current) throw new TypeError("Reload this Test before saving more changes.");
      return testEditorService.edit({ document: current, edits: transaction.forward });
    },
    onMutate: () => setSaveNotice("Saving…"),
    onSuccess: (next, transaction) => {
      saveDocument(next);
      for (const edit of transaction.forward) {
        if (edit.kind !== "step.patch") continue;
        const savedIntent = edit.patch.intent;
        const savedNote = edit.patch.note;
        const savedCapture = edit.patch.capture;
        if (savedIntent !== undefined && savedNote !== undefined && savedCapture !== undefined) {
          clearStepDraftIfUnchanged(edit.stepId, {
            intent: savedIntent,
            note: savedNote ?? "",
            capture: savedCapture,
          });
        }
      }
      setSaveNotice("Saved");
      const nextSelection = selectAfterSave.current;
      selectAfterSave.current = undefined;
      if (nextSelection === null) {
        void navigate({ search: (previous) => ({ ...previous, step: undefined }), replace: true });
      } else if (nextSelection) {
        selectStep(nextSelection);
      }
    },
    onError: () => {
      selectAfterSave.current = undefined;
      setSaveNotice("Could not save");
      void queryClient.invalidateQueries({ queryKey: sessionId ? liveQueryKey : queryKey });
    },
  });

  const historyAction = useMutation({
    mutationFn: async (direction: "undo" | "redo") => {
      const live = currentLiveEditor();
      if (live) return liveTestEditorService[direction]({ current: live });
      const current = currentDocument();
      if (!current) throw new TypeError("Reload this Test before changing its history.");
      const operation = testEditorService[direction];
      if (!operation) throw new TypeError("Saved history is not available on this Relay server.");
      return operation({ document: current });
    },
    onMutate: () => setSaveNotice("Saving…"),
    onSuccess: (next) => {
      saveDocument(next);
      setSaveNotice("Saved");
    },
    onError: () => {
      setSaveNotice("Could not save");
      void queryClient.invalidateQueries({ queryKey: sessionId ? liveQueryKey : queryKey });
    },
  });

  const repair = useMutation({
    mutationFn: async ({
      proposal,
      decision,
    }: {
      proposal: ProductTestRepair;
      decision: "approve" | "reject" | "revert";
    }) => {
      const live = currentLiveEditor();
      if (live) {
        return liveTestEditorService.decideRepair({
          current: live,
          proposalId: proposal.id,
          decision,
        });
      }
      const current = currentDocument();
      if (!current) throw new TypeError("Reload this Test before reviewing a repair.");
      return testEditorService.decideRepair({
        document: current,
        proposalId: proposal.id,
        decision,
      });
    },
    onSuccess: (next) => {
      saveDocument(next);
      setSaveNotice("Saved");
    },
    onError: () =>
      void queryClient.invalidateQueries({ queryKey: sessionId ? liveQueryKey : queryKey }),
  });

  function selectStep(stepId: string) {
    void navigate({ search: (previous) => ({ ...previous, step: stepId }), replace: true });
  }

  function apply(transaction: EditTransaction, nextSelection?: string | null) {
    if (edit.isPending || repair.isPending) return;
    selectAfterSave.current = nextSelection;
    edit.mutate(transaction);
  }

  function addStepAt(placement: AppMapTestStepPlacement | undefined, index: number, label: string) {
    const id = `step-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
    const step: AppMapScenarioTestStep = {
      id,
      kind: "instruction",
      intent: "Describe the next action",
      binding: {
        status: "unresolved",
        reason: "Choose a saved action for this step before running the Test.",
      },
    };
    apply(
      {
        label,
        forward: [
          {
            kind: "step.add",
            step,
            ...(placement ? { placement } : {}),
            index,
          },
        ],
        reverse: [{ kind: "step.remove", stepId: id }],
      },
      id,
    );
  }

  function addStep() {
    addStepAt(selected?.placement, selected ? selected.index + 1 : entries.length, "Added a step");
  }

  function addChildStep(entry: StepEntry, branch: "then" | "else" | "steps") {
    const children =
      entry.step.kind === "decision"
        ? branch === "then"
          ? entry.step.thenSteps
          : branch === "else"
            ? (entry.step.elseSteps ?? [])
            : undefined
        : entry.step.kind === "loop" && branch === "steps"
          ? entry.step.steps
          : undefined;
    if (!children) return;
    addStepAt(
      { parentStepId: entry.step.id, branch },
      children.length,
      `Added a step to the ${branch === "steps" ? "repeat" : branch} branch`,
    );
  }

  function removeStep(entry: StepEntry) {
    const nextSelection =
      entry.siblingIds[entry.index + 1] ??
      entry.siblingIds[entry.index - 1] ??
      entry.placement?.parentStepId ??
      null;
    apply(
      {
        label: `Removed ${entry.step.intent}`,
        forward: [{ kind: "step.remove", stepId: entry.step.id }],
        reverse: [
          {
            kind: "step.add",
            step: structuredClone(entry.step),
            ...(entry.placement ? { placement: entry.placement } : {}),
            index: entry.index,
          },
        ],
      },
      nextSelection,
    );
  }

  function move(entry: StepEntry, delta: -1 | 1) {
    const nextIndex = entry.index + delta;
    if (nextIndex < 0 || nextIndex >= entry.siblingIds.length) return;
    const orderedStepIds = [...entry.siblingIds];
    [orderedStepIds[entry.index], orderedStepIds[nextIndex]] = [
      orderedStepIds[nextIndex]!,
      orderedStepIds[entry.index]!,
    ];
    apply({
      label: `Moved ${entry.step.intent}`,
      forward: [
        {
          kind: "step.reorder",
          orderedStepIds,
          ...(entry.placement ? { placement: entry.placement } : {}),
        },
      ],
      reverse: [
        {
          kind: "step.reorder",
          orderedStepIds: [...entry.siblingIds],
          ...(entry.placement ? { placement: entry.placement } : {}),
        },
      ],
    });
    queueMicrotask(() => globalThis.document.getElementById(`test-step-${entry.step.id}`)?.focus());
  }

  function dropOn(target: StepEntry, after: boolean) {
    const sourceId = draggedStepId.current;
    draggedStepId.current = undefined;
    if (!sourceId || sourceId === target.step.id || !target.siblingIds.includes(sourceId)) return;
    const orderedStepIds = target.siblingIds.filter((id) => id !== sourceId);
    const targetIndex = orderedStepIds.indexOf(target.step.id);
    orderedStepIds.splice(targetIndex + (after ? 1 : 0), 0, sourceId);
    apply({
      label: "Reordered steps",
      forward: [
        {
          kind: "step.reorder",
          orderedStepIds,
          ...(target.placement ? { placement: target.placement } : {}),
        },
      ],
      reverse: [
        {
          kind: "step.reorder",
          orderedStepIds: [...target.siblingIds],
          ...(target.placement ? { placement: target.placement } : {}),
        },
      ],
    });
  }

  function undo() {
    if (canUndo && !edit.isPending) historyAction.mutate("undo");
  }

  function redo() {
    if (canRedo && !edit.isPending) historyAction.mutate("redo");
  }

  const latestHistory = editorDocument?.history[0];
  const hasUnsavedDrafts = Object.keys(stepDrafts).length > 0;
  const canRedo = latestHistory?.eventType === "test.undone" && Boolean(testEditorService.redo);
  const canUndo =
    Boolean(testEditorService.undo) &&
    Boolean(editorDocument?.history.some((item) => item.eventType !== "test.redone"));

  return (
    <section
      className="relay-page relay-test-editor-page"
      onKeyDown={(event) => {
        const target = event.target as HTMLElement;
        const typing =
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
        if (typing || (!event.metaKey && !event.ctrlKey)) return;
        if (event.key.toLowerCase() === "z") {
          event.preventDefault();
          if (event.shiftKey) redo();
          else undo();
        } else if (event.key.toLowerCase() === "y") {
          event.preventDefault();
          redo();
        }
      }}
    >
      <Breadcrumbs
        items={[
          { label: "Tests", to: "/tests" },
          { label: editorDocument?.test.name ?? "Test" },
          { label: "Edit" },
        ]}
      />
      <header className="relay-page-header relay-test-editor-header">
        <div>
          <div className="relay-entity-context">
            <Badge
              variant="default"
              className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
            >
              Saved Test
            </Badge>
            {editorDocument ? <span>{editorDocument.appName}</span> : null}
            {sessionId ? <Badge variant="secondary">Live Session</Badge> : null}
          </div>
          <h1>{editorDocument?.test.name ?? "Edit Test"}</h1>
          <p className="relay-page-description">
            Refine what Relay does and checks, one step at a time.
          </p>
        </div>
        <div className="relay-editor-header-actions">
          <span
            className="relay-save-state"
            data-state={
              saveNotice.includes("failed") || saveNotice === "Could not save" ? "error" : "saved"
            }
            aria-live="polite"
          >
            {saveNotice === "Saved" && !hasUnsavedDrafts ? <Check aria-hidden="true" /> : null}
            {hasUnsavedDrafts && saveNotice === "Saved" ? "Unsaved draft" : saveNotice}
          </span>
          <Button
            nativeButton={false}
            variant="default"
            render={<Link to="/tests/$testId" params={{ testId }} />}
          >
            Done editing
          </Button>
        </div>
      </header>

      {(sessionId ? liveEditor.isPending : document.isPending) ? (
        <PageLoading label="Loading Test steps…" />
      ) : null}
      <RecordingProblem
        error={
          liveEditor.error ?? document.error ?? edit.error ?? historyAction.error ?? repair.error
        }
        onRetry={() => void (sessionId ? liveEditor.refetch() : document.refetch())}
        retrying={sessionId ? liveEditor.isFetching : document.isFetching}
      />
      {!(sessionId ? liveEditor.isPending : document.isPending) &&
      !editorDocument &&
      !(sessionId ? liveEditor.isError : document.isError) ? (
        <EmptyState
          title="This Test is not available"
          detail="It may have been removed or may belong to another app. Choose a saved Test to continue."
          action={
            <Link className="relay-inline-link" to="/tests">
              Browse saved Tests
            </Link>
          }
        />
      ) : null}

      {editorDocument ? (
        <>
          <div className="relay-editor-toolbar" aria-label="Editing history">
            <Button
              variant="ghost"
              size="sm"
              onClick={undo}
              disabled={!canUndo || edit.isPending || historyAction.isPending}
              aria-label="Undo last saved change"
            >
              <Undo2 aria-hidden="true" /> Undo
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={redo}
              disabled={!canRedo || edit.isPending || historyAction.isPending}
              aria-label="Redo last undone change"
            >
              <Redo2 aria-hidden="true" /> Redo
            </Button>
            {latestHistory ? (
              <span className="relay-editor-last-change">
                Last saved change: {latestHistory.summary}
              </span>
            ) : null}
          </div>

          <div className="relay-test-editor-layout">
            <section className="relay-editor-outline" aria-labelledby="test-steps-title">
              <div className="relay-section-heading">
                <div>
                  <p className="relay-section-label">Journey</p>
                  <h2 id="test-steps-title">Steps</h2>
                </div>
                <div className="relay-editor-outline-actions">
                  <span>{entries.length === 1 ? "1 step" : `${entries.length} steps`}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={addStep}
                    disabled={edit.isPending || repair.isPending}
                  >
                    Add step
                  </Button>
                </div>
              </div>
              <p className="relay-editor-help">
                Drag within a group, use the arrow buttons, or press Alt + ↑/↓ on a step.
              </p>
              {entries.length ? (
                <ol className="relay-editor-step-list">
                  {entries.map((entry) => (
                    <li
                      key={entry.step.id}
                      style={{ "--step-depth": entry.depth } as CSSProperties}
                    >
                      <div
                        id={`test-step-${entry.step.id}`}
                        className="relay-editor-step-row"
                        data-selected={selected?.step.id === entry.step.id}
                        draggable={!edit.isPending}
                        tabIndex={0}
                        onDragStart={() => {
                          draggedStepId.current = entry.step.id;
                        }}
                        onDragEnd={() => {
                          draggedStepId.current = undefined;
                        }}
                        onDragOver={(event) => {
                          if (
                            draggedStepId.current &&
                            entry.siblingIds.includes(draggedStepId.current)
                          )
                            event.preventDefault();
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          const bounds = event.currentTarget.getBoundingClientRect();
                          dropOn(entry, event.clientY > bounds.top + bounds.height / 2);
                        }}
                        onKeyDown={(event) => {
                          if (!event.altKey) return;
                          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                            event.preventDefault();
                            move(entry, event.key === "ArrowUp" ? -1 : 1);
                          }
                        }}
                      >
                        <button
                          className="relay-editor-step-select"
                          type="button"
                          onClick={() => selectStep(entry.step.id)}
                          aria-pressed={selected?.step.id === entry.step.id}
                        >
                          <GripVertical className="relay-editor-grip" aria-hidden="true" />
                          <span className="relay-editor-step-number">{entry.number}</span>
                          <span className="relay-editor-step-copy">
                            <strong>{entry.step.intent}</strong>
                            <small>
                              {entry.placement ? `${branchLabel(entry.placement)} · ` : ""}
                              {stepKindLabel(entry.step)} ·{" "}
                              {entry.step.binding.status === "resolved" ? "Ready" : "Needs review"}
                            </small>
                          </span>
                          <ChevronRight aria-hidden="true" />
                        </button>
                        <span className="relay-editor-reorder-actions">
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => move(entry, -1)}
                            disabled={entry.index === 0 || edit.isPending}
                            aria-label={`Move ${entry.step.intent} up`}
                          >
                            <ArrowUp aria-hidden="true" />
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => move(entry, 1)}
                            disabled={entry.index === entry.siblingIds.length - 1 || edit.isPending}
                            aria-label={`Move ${entry.step.intent} down`}
                          >
                            <ArrowDown aria-hidden="true" />
                          </Button>
                        </span>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <EmptyState
                  title="This Test has no steps"
                  detail="Record this journey again to give Relay a reviewed path to repeat."
                />
              )}
            </section>

            <aside className="relay-editor-inspector" aria-label="Selected step editor">
              {selected ? (
                <SelectedStepEditor
                  key={`${selected.step.id}:${editorDocument.revision}`}
                  entry={selected}
                  draft={stepDrafts[selected.step.id]}
                  onDraftChange={(draft) => updateStepDraft(selected.step.id, draft)}
                  busy={edit.isPending}
                  onSave={apply}
                  onBind={(transaction) => apply(transaction)}
                  onRemove={() => removeStep(selected)}
                  onAddChild={(branch) => addChildStep(selected, branch)}
                />
              ) : (
                <EmptyState
                  title="Choose a step"
                  detail="Select a step to edit its instruction, note, and evidence capture."
                />
              )}
            </aside>

            <div className="relay-editor-stage-evidence">
              {sessionId ? (
                <LiveTestEditorPane
                  session={liveEditor.data}
                  loading={liveEditor.isPending}
                  error={liveEditor.error}
                />
              ) : null}
              <TestEditorEvidencePanel
                step={selected?.step}
                report={latestReport.data}
                hasRuns={Boolean(recentRuns.data?.length)}
                loading={reportLoading}
              />
            </div>
          </div>

          {editorDocument.repairs.length || editorDocument.history.length ? (
            <div className="relay-test-editor-context">
              {editorDocument.repairs.length ? (
                <RepairSection
                  repairs={editorDocument.repairs}
                  busy={repair.isPending}
                  onDecision={(proposal, decision) => repair.mutate({ proposal, decision })}
                />
              ) : null}
              {editorDocument.history.length ? (
                <HistorySection items={editorDocument.history} />
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
