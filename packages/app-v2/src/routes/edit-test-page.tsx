/** @jsxImportSource react */
import type { AppMapScenarioTestStep, AppMapTestStepPlacement } from "@relay/protocol";
import { Badge, Button, IconButton } from "@relay/ui-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useNavigate, useRouteContext } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  CircleDot,
  GripVertical,
  History,
  Redo2,
  Sparkles,
  Undo2,
} from "lucide-react";
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
import { useLatestTestReport } from "../hooks/use-latest-test-report";
import { PageLoading, RecordingProblem } from "./recording-shared";

const routeApi = getRouteApi("/tests/$testId/edit");

export function EditTestPage() {
  const { testEditorService, runService, queryClient } = useRouteContext({ from: "__root__" });
  const { testId } = routeApi.useParams();
  const search = routeApi.useSearch() as { step?: unknown };
  const navigate = useNavigate({ from: "/tests/$testId/edit" });
  const queryKey = useMemo(() => ["test-editor", testId] as const, [testId]);
  const document = useQuery({
    queryKey,
    queryFn: () => testEditorService.get(testId),
    staleTime: 5_000,
  });
  const entries = useMemo(
    () => collectStepEntries(document.data?.test.steps ?? []),
    [document.data],
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
  const draggedStepId = useRef<string | undefined>(undefined);
  const selectAfterSave = useRef<string | null | undefined>(undefined);

  const edit = useMutation({
    mutationFn: async (transaction: EditTransaction) => {
      const current = queryClient.getQueryData<ProductTestEditorDocument | undefined>(queryKey);
      if (!current) throw new TypeError("Reload this Test before saving more changes.");
      return testEditorService.edit({ document: current, edits: transaction.forward });
    },
    onMutate: () => setSaveNotice("Saving…"),
    onSuccess: (next) => {
      queryClient.setQueryData(queryKey, next);
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
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  const historyAction = useMutation({
    mutationFn: async (direction: "undo" | "redo") => {
      const current = queryClient.getQueryData<ProductTestEditorDocument | undefined>(queryKey);
      if (!current) throw new TypeError("Reload this Test before changing its history.");
      const operation = testEditorService[direction];
      if (!operation) throw new TypeError("Saved history is not available on this Relay server.");
      return operation({ document: current });
    },
    onMutate: () => setSaveNotice("Saving…"),
    onSuccess: (next) => {
      queryClient.setQueryData(queryKey, next);
      setSaveNotice("Saved");
    },
    onError: () => {
      setSaveNotice("Could not save");
      void queryClient.invalidateQueries({ queryKey });
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
      const current = queryClient.getQueryData<ProductTestEditorDocument | undefined>(queryKey);
      if (!current) throw new TypeError("Reload this Test before reviewing a repair.");
      return testEditorService.decideRepair({
        document: current,
        proposalId: proposal.id,
        decision,
      });
    },
    onSuccess: (next) => {
      queryClient.setQueryData(queryKey, next);
      setSaveNotice("Saved");
    },
    onError: () => void queryClient.invalidateQueries({ queryKey }),
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

  const latestHistory = document.data?.history[0];
  const canRedo = latestHistory?.eventType === "test.undone" && Boolean(testEditorService.redo);
  const canUndo =
    Boolean(testEditorService.undo) &&
    Boolean(document.data?.history.some((item) => item.eventType !== "test.redone"));

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
          { label: document.data?.test.name ?? "Test" },
          { label: "Edit" },
        ]}
      />
      <header className="relay-page-header relay-test-editor-header">
        <div>
          <div className="relay-entity-context">
            <Badge variant="success">Saved Test</Badge>
            {document.data ? <span>{document.data.appName}</span> : null}
          </div>
          <h1>{document.data?.test.name ?? "Edit Test"}</h1>
          <p className="relay-page-description">
            Refine what Relay does and checks, one step at a time.
          </p>
        </div>
        <div className="relay-editor-header-actions">
          <span
            className="relay-save-state"
            data-state={saveNotice === "Could not save" ? "error" : "saved"}
            aria-live="polite"
          >
            {saveNotice === "Saved" ? <Check aria-hidden="true" /> : null}
            {saveNotice}
          </span>
          <Button variant="primary" render={<Link to="/tests/$testId" params={{ testId }} />}>
            Done editing
          </Button>
        </div>
      </header>

      {document.isPending ? <PageLoading label="Loading Test steps…" /> : null}
      <RecordingProblem
        error={document.error ?? edit.error ?? historyAction.error ?? repair.error}
        onRetry={() => void document.refetch()}
        retrying={document.isFetching}
      />
      {!document.isPending && !document.data && !document.isError ? (
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

      {document.data ? (
        <>
          <div className="relay-editor-toolbar" aria-label="Editing history">
            <Button
              variant="ghost"
              size="small"
              onClick={undo}
              disabled={!canUndo || edit.isPending || historyAction.isPending}
              aria-label="Undo last saved change"
            >
              <Undo2 aria-hidden="true" /> Undo
            </Button>
            <Button
              variant="ghost"
              size="small"
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
                    size="small"
                    variant="secondary"
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
                          <IconButton
                            size="small"
                            onClick={() => move(entry, -1)}
                            disabled={entry.index === 0 || edit.isPending}
                            aria-label={`Move ${entry.step.intent} up`}
                          >
                            <ArrowUp aria-hidden="true" />
                          </IconButton>
                          <IconButton
                            size="small"
                            onClick={() => move(entry, 1)}
                            disabled={entry.index === entry.siblingIds.length - 1 || edit.isPending}
                            aria-label={`Move ${entry.step.intent} down`}
                          >
                            <ArrowDown aria-hidden="true" />
                          </IconButton>
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
                  key={`${selected.step.id}:${document.data.revision}`}
                  entry={selected}
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

            <TestEditorEvidencePanel
              step={selected?.step}
              report={latestReport.data}
              hasRuns={Boolean(recentRuns.data?.length)}
              loading={reportLoading}
            />
          </div>

          {document.data.repairs.length || document.data.history.length ? (
            <div className="relay-test-editor-context">
              {document.data.repairs.length ? (
                <RepairSection
                  repairs={document.data.repairs}
                  busy={repair.isPending}
                  onDecision={(proposal, decision) => repair.mutate({ proposal, decision })}
                />
              ) : null}
              {document.data.history.length ? (
                <HistorySection items={document.data.history} />
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function RepairSection({
  repairs,
  busy,
  onDecision,
}: {
  repairs: readonly ProductTestRepair[];
  busy: boolean;
  onDecision(repair: ProductTestRepair, decision: "approve" | "reject" | "revert"): void;
}) {
  return (
    <section className="relay-editor-context-panel" aria-labelledby="repairs-title">
      <div className="relay-context-heading">
        <Sparkles aria-hidden="true" />
        <div>
          <p className="relay-section-label">Review</p>
          <h2 id="repairs-title">Suggested repairs</h2>
        </div>
      </div>
      {repairs.length ? (
        <ul className="relay-editor-context-list">
          {repairs.map((proposal) => (
            <li key={proposal.id}>
              <div>
                <strong>{proposal.title}</strong>
                <p>
                  {proposal.description ??
                    `${proposal.editCount} suggested ${proposal.editCount === 1 ? "change" : "changes"}`}
                </p>
              </div>
              <div>
                {proposal.status === "pending" ? (
                  <>
                    <Button
                      size="small"
                      variant="primary"
                      disabled={busy}
                      onClick={() => onDecision(proposal, "approve")}
                    >
                      Apply repair
                    </Button>
                    <Button
                      size="small"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => onDecision(proposal, "reject")}
                    >
                      Dismiss
                    </Button>
                  </>
                ) : (
                  <Button
                    size="small"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => onDecision(proposal, "revert")}
                  >
                    Revert repair
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="relay-context-empty">
          <Check aria-hidden="true" /> No repairs are waiting for review.
        </p>
      )}
    </section>
  );
}

function HistorySection({ items }: { items: ProductTestEditorDocument["history"] }) {
  return (
    <section className="relay-editor-context-panel" aria-labelledby="history-title">
      <div className="relay-context-heading">
        <History aria-hidden="true" />
        <div>
          <p className="relay-section-label">Saved activity</p>
          <h2 id="history-title">History</h2>
        </div>
      </div>
      {items.length ? (
        <ol className="relay-editor-history-list">
          {items.slice(0, 8).map((item) => (
            <li key={item.id}>
              <CircleDot aria-hidden="true" />
              <div>
                <strong>{item.summary}</strong>
                <span>
                  {item.actorKind === "human" ? "You" : "Agent"} · {relativeTime(item.at)}
                </span>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="relay-context-empty">Saved edits will appear here.</p>
      )}
    </section>
  );
}

function collectStepEntries(steps: readonly AppMapScenarioTestStep[]): StepEntry[] {
  const entries: StepEntry[] = [];
  function visit(
    siblings: readonly AppMapScenarioTestStep[],
    depth: number,
    prefix: string,
    placement?: AppMapTestStepPlacement,
  ) {
    const siblingIds = siblings.map((step) => step.id);
    siblings.forEach((step, index) => {
      const number = prefix ? `${prefix}.${index + 1}` : String(index + 1);
      entries.push({ step, depth, number, placement, siblingIds, index });
      if (step.kind === "decision") {
        visit(step.thenSteps, depth + 1, number, { parentStepId: step.id, branch: "then" });
        if (step.elseSteps?.length)
          visit(step.elseSteps, depth + 1, `${number}b`, { parentStepId: step.id, branch: "else" });
      } else if (step.kind === "loop") {
        visit(step.steps, depth + 1, number, { parentStepId: step.id, branch: "steps" });
      }
    });
  }
  visit(steps, 0, "");
  return entries;
}

function stepKindLabel(step: AppMapScenarioTestStep): string {
  if (step.kind === "validation") return "Checkpoint";
  if (step.kind === "instruction") return "Action";
  if (step.kind === "manual") return "Human check";
  if (step.kind === "extraction") return "Remember value";
  if (step.kind === "module") return "Saved section";
  if (step.kind === "decision") return "Decision";
  if (step.kind === "loop") return "Repeat";
  return "Script";
}

function branchLabel(placement: AppMapTestStepPlacement): string {
  if (placement.branch === "then") return "Then branch";
  if (placement.branch === "else") return "Else branch";
  if (placement.branch === "steps") return "Repeated steps";
  return "Main path";
}

function relativeTime(value: number): string {
  const elapsed = Math.max(0, Date.now() - value);
  if (elapsed < 60_000) return "Just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(value);
}
