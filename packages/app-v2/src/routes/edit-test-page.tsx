/** @jsxImportSource react */
import { EditorSaveStatus } from "../components/editor-save-status";
import { WorkbenchPage, PageHeader, WorkbenchPanes } from "../components/page-layout";
import type { AppMapScenarioTestStep, AppMapTestStepPlacement } from "@relay/protocol";
import { ApiError } from "@relay/client";
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useNavigate, useRouteContext } from "@tanstack/react-router";
import { Redo2, Undo2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "../components/product-patterns";
import { TestEditorEvidencePanel } from "../components/test-editor-evidence-panel";
import {
  SelectedStepEditor,
  validationDraft,
  type EditTransaction,
  type StepEntry,
} from "../components/test-editor-step";
import { TestEditorStepOutline } from "../components/test-editor-step-list";
import type {
  ProductTestEditorDocument,
  ProductTestRepair,
} from "../data/test-editor-product-service";
import type { LiveTestEditorSession } from "../data/live-test-editor-product-service";
import { useLatestTestReport } from "../hooks/use-latest-test-report";
import { LiveTestEditorPane } from "./live-test-editor-pane";
import { PageLoading, RecordingProblem } from "./recording-shared";
import { HistorySection, RepairSection } from "./test-editor-context-panels";
import { collectStepEntries } from "./test-editor-route-helpers";
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsName, setSettingsName] = useState("");
  const [settingsOrigin, setSettingsOrigin] = useState("");
  useEffect(() => {
    setSettingsName(editorDocument?.test.name ?? "");
    setSettingsOrigin(editorDocument?.test.originApplication ?? "");
  }, [editorDocument?.test.name, editorDocument?.test.originApplication]);
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
            ...(edit.patch.binding?.status === "resolved" &&
            (edit.patch.binding.kind === "assertion" || edit.patch.binding.kind === "recipe-step")
              ? {
                  expected: validationDraft({
                    id: edit.stepId,
                    kind: "validation",
                    intent: savedIntent,
                    binding: edit.patch.binding,
                  }),
                }
              : {}),
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
    onError: (error) => {
      selectAfterSave.current = undefined;
      setSaveNotice(
        error instanceof ApiError && error.status === 409
          ? "Revision changed. Your draft is preserved."
          : "Could not save",
      );
      void queryClient.invalidateQueries({ queryKey: sessionId ? liveQueryKey : queryKey });
    },
  });
  const settings = useMutation({
    mutationFn: async () => {
      const current = currentDocument();
      if (!current || !testEditorService.saveSettings)
        throw new TypeError("Reload this saved Test before changing settings.");
      return testEditorService.saveSettings({
        document: current,
        name: settingsName,
        originApplication: settingsOrigin,
      });
    },
    onMutate: () => setSaveNotice("Saving…"),
    onSuccess: (next) => {
      saveDocument(next);
      setSettingsOpen(false);
      setSaveNotice("Saved");
    },
    onError: () => setSaveNotice("Could not save settings"),
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

  function addStepAt(
    placement: AppMapTestStepPlacement | undefined,
    index: number,
    label: string,
    kind: "instruction" | "validation" = "instruction",
  ) {
    const id = `step-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
    const step: AppMapScenarioTestStep =
      kind === "validation"
        ? {
            id,
            kind: "validation",
            intent: "Prove the result",
            capture: true,
            binding: {
              status: "unresolved",
              reason: "Choose what Relay should prove after this step.",
            },
          }
        : {
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

  function addCheckpoint() {
    addStepAt(
      selected?.placement,
      selected ? selected.index + 1 : entries.length,
      "Added a checkpoint",
      "validation",
    );
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
  const stepEditor = editorDocument ? (
    <aside
      className={`${sessionId ? "" : "sticky top-0 "}min-w-0 rounded-xl border border-border bg-card shadow-sm`}
      aria-label="Selected step editor"
    >
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
          platformBlocker={editorDocument.stepPlatformBlockers?.[selected.step.id]}
        />
      ) : (
        <EmptyState
          title="Choose a step"
          detail="Select a step to edit its instruction, note, and evidence capture."
        />
      )}
    </aside>
  ) : null;

  return (
    <WorkbenchPage
      className="relay-test-editor-page"
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
      <PageHeader
        crumbs={[
          { label: "Tests", to: "/tests" },
          { label: editorDocument?.test.name ?? "Test" },
          { label: "Edit" },
        ]}
        title={editorDocument?.test.name ?? "Edit Test"}
        description={editorDocument?.appName}
        actions={
          <>
            <EditorSaveStatus
              state={
                edit.isPending || historyAction.isPending
                  ? "saving"
                  : saveNotice.startsWith("Revision changed")
                    ? "conflicted"
                    : saveNotice.startsWith("Could not") ||
                        saveNotice.toLowerCase().includes("failed") ||
                        saveNotice.includes("unavailable")
                      ? "failed"
                      : hasUnsavedDrafts
                        ? "dirty"
                        : "saved"
              }
              detail={hasUnsavedDrafts && saveNotice === "Saved" ? "Unsaved draft" : saveNotice}
            />
            {!sessionId ? (
              <Button size="sm" variant="outline" onClick={() => setSettingsOpen((open) => !open)}>
                Test settings
              </Button>
            ) : null}
            <Button
              nativeButton={false}
              variant="default"
              render={<Link to="/tests/$testId" params={{ testId }} />}
            >
              Done editing
            </Button>
          </>
        }
      />
      {settingsOpen && !sessionId ? (
        <section
          className="mx-4 mb-4 grid max-w-xl gap-3 rounded-lg border border-border bg-card p-4"
          aria-label="Test settings"
        >
          <div>
            <h2 className="text-sm font-semibold">Test settings</h2>
            <p className="text-xs text-muted-foreground">
              Update the saved Test identity and origin package.
            </p>
          </div>
          <label className="grid gap-1 text-xs font-medium">
            Name
            <Input value={settingsName} onChange={(event) => setSettingsName(event.target.value)} />
          </label>
          <label className="grid gap-1 text-xs font-medium">
            Origin application
            <Input
              placeholder="com.example.app"
              value={settingsOrigin}
              onChange={(event) => setSettingsOrigin(event.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <Button
              onClick={() => settings.mutate()}
              disabled={!settingsName.trim() || settings.isPending}
            >
              Save settings
            </Button>
            <Button variant="ghost" onClick={() => setSettingsOpen(false)}>
              Cancel
            </Button>
          </div>
          <RecordingProblem
            error={settings.error}
            onRetry={() => settings.mutate()}
            retrying={settings.isPending}
          />
        </section>
      ) : null}

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
            <Link
              className="relay-inline-link focus-visible:outline-2 focus-visible:outline-[var(--relay-focus-ring)] focus-visible:outline-offset-2 inline-flex min-h-11 items-center text-[var(--text-interactive-base)] font-semibold underline decoration-[color-mix(in_srgb,currentColor_45%,transparent)] underline-offset-[3px]"
              to="/tests"
            >
              Browse saved Tests
            </Link>
          }
        />
      ) : null}

      {editorDocument ? (
        <>
          <div className="flex flex-wrap items-center gap-2" aria-label="Editing history">
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
              <span className="text-xs text-muted-foreground">
                Last saved change: {latestHistory.summary}
              </span>
            ) : null}
          </div>

          <WorkbenchPanes
            inspectorKind={sessionId ? "device" : "form"}
            outline={
              <TestEditorStepOutline
                test={editorDocument.test}
                recordedPlatforms={editorDocument.recordedPlatforms}
                stepPlatformBlockers={editorDocument.stepPlatformBlockers}
                entries={entries}
                selectedStepId={selected?.step.id}
                busy={edit.isPending || repair.isPending}
                draggedStepId={draggedStepId}
                onAdd={addStep}
                onAddCheckpoint={addCheckpoint}
                onSelect={selectStep}
                onMove={move}
                onDrop={dropOn}
              />
            }
            stage={
              <div className="grid min-w-0 gap-3.5">
                {sessionId ? stepEditor : null}
                {sessionId ? null : (
                  <TestEditorEvidencePanel
                    step={selected?.step}
                    report={latestReport.data}
                    hasRuns={Boolean(recentRuns.data?.length)}
                    loading={reportLoading}
                  />
                )}
              </div>
            }
            inspector={
              sessionId ? (
                <LiveTestEditorPane
                  session={liveEditor.data}
                  loading={liveEditor.isPending}
                  error={liveEditor.error}
                />
              ) : (
                stepEditor
              )
            }
          />

          {editorDocument.repairs.length || editorDocument.history.length ? (
            <div className="mt-10 grid gap-7 border-t border-border pt-6 md:grid-cols-2">
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
    </WorkbenchPage>
  );
}
