/** @jsxImportSource react */
import { TestEditorBrowserPane } from "./test-editor-browser-pane";
import { TestEditorSelectedStep } from "./test-editor-selected-step";
import { TestEditorChrome } from "./test-editor-chrome";
import { TestEditorWorkspace } from "./test-editor-workspace";
import { testEditorSaveState } from "./test-editor-save-state";
import { recentAccountIds } from "./test-editor-recent-accounts";
export { recentAccountIds } from "./test-editor-recent-accounts";
import { EditorSaveStatus } from "../components/editor-save-status";
import { WorkbenchPage } from "../components/page-layout";
import type { AppMapScenarioTestStep, AppMapTestStepPlacement } from "@relay/protocol";
import { ApiError } from "@relay/client";
import { Button } from "@relay/ui-react/components/button";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useRouteContext } from "@tanstack/react-router";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "../components/product-patterns";
import { TestEditorEvidencePanel } from "../components/test-editor-evidence-panel";
import {
  validationDraft,
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
import {
  collectStepEntries,
  insertPendingCheckpoint,
  type PendingCheckpointDraft,
} from "./test-editor-route-helpers";
import { useTestStepDrafts } from "./use-test-step-drafts";
import { productLinkClassName } from "../lib/class-names";

export { EditTestPage } from "./edit-test-route";

export function TestEditor(props: {
  testId: string;
  appMapId?: string;
  stepId?: string;
  sessionId?: string;
  onStepChange(stepId: string | undefined): void;
  /** Embedded in the Test page: no page header; `stage` fills the right side. */
  stage?: ReactNode;
  onSelectedStepChange?(stepId: string | undefined): void;
  onEditingStateChange?(state: "loading" | "dirty" | "saving" | "saved" | "failed"): void;
}) {
  return <TestEditorDocument {...props} />;
}

function TestEditorDocument({
  testId,
  appMapId,
  stepId: requestedStepIdProp,
  sessionId,
  onStepChange,
  stage,
  onSelectedStepChange,
  onEditingStateChange,
}: {
  testId: string;
  appMapId?: string;
  stepId?: string;
  sessionId?: string;
  onStepChange(stepId: string | undefined): void;
  stage?: ReactNode;
  onSelectedStepChange?(stepId: string | undefined): void;
  onEditingStateChange?(state: "loading" | "dirty" | "saving" | "saved" | "failed"): void;
}) {
  const { testEditorService, liveTestEditorService, runService, queryClient, platform } =
    useRouteContext({
      from: "__root__",
    });
  const embedded = stage !== undefined;
  const [editorExpanded, setEditorExpanded] = useState(Boolean(requestedStepIdProp || sessionId));
  const navigate = useNavigate();
  const queryKey = useMemo(() => ["test-editor", testId, appMapId] as const, [testId, appMapId]);
  const liveQueryKey = useMemo(
    () => ["live-test-editor", testId, sessionId] as const,
    [sessionId, testId],
  );
  const document = useQuery({
    queryKey,
    queryFn: () => testEditorService.get(testId, appMapId),
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
  const [pendingCheckpoint, setPendingCheckpoint] = useState<PendingCheckpointDraft | null>(null);
  const entries = useMemo(() => {
    const saved = editorDocument?.test.steps ?? [];
    return collectStepEntries(
      pendingCheckpoint ? insertPendingCheckpoint(saved, pendingCheckpoint) : saved,
    );
  }, [editorDocument, pendingCheckpoint]);
  const requestedStepId = requestedStepIdProp;
  const selected =
    entries.find((entry) => entry.step.id === requestedStepId) ?? entries.at(0) ?? undefined;
  const selectedStepId = selected?.step.id;
  useEffect(() => {
    onSelectedStepChange?.(selectedStepId);
  }, [onSelectedStepChange, selectedStepId]);
  const {
    recentRuns,
    latestReport,
    loading: reportLoading,
  } = useLatestTestReport(runService, testId, appMapId);
  const [saveNotice, setSaveNotice] = useState("Saved");
  const [workspaceView, setWorkspaceView] = useState<"steps" | "browser">("browser");
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
    appMapId,
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
    onMutate: () => {
      onEditingStateChange?.("saving");
      setSaveNotice("Saving…");
    },
    onSuccess: (next, transaction) => {
      saveDocument(next);
      for (const edit of transaction.forward) {
        if (edit.kind === "step.add") {
          clearStepDraftIfUnchanged(edit.step.id, {
            intent: edit.step.intent,
            note: edit.step.note ?? "",
            capture: edit.step.capture === true,
            expected: validationDraft(edit.step),
          });
          continue;
        }
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
      if (
        pendingCheckpoint &&
        transaction.forward.some(
          (item) => item.kind === "step.add" && item.step.id === pendingCheckpoint.step.id,
        )
      ) {
        setPendingCheckpoint(null);
      }
      setSaveNotice("Saved");
      const nextSelection = selectAfterSave.current;
      selectAfterSave.current = undefined;
      if (nextSelection === null) {
        onStepChange(undefined);
      } else if (nextSelection) {
        selectStep(nextSelection);
      }
    },
    onError: (error) => {
      selectAfterSave.current = undefined;
      setSaveNotice(
        error instanceof ApiError && error.status === 409
          ? "Conflict — your changes are preserved"
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
    setEditorExpanded(true);
    onStepChange(stepId);
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
    if (pendingCheckpoint) {
      selectStep(pendingCheckpoint.step.id);
      return;
    }
    const id = `step-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
    setPendingCheckpoint({
      step: {
        id,
        kind: "validation",
        intent: "Prove the result",
        capture: true,
        binding: {
          status: "unresolved",
          reason: "Choose what Relay should prove after this step.",
        },
      },
      ...(selected?.placement ? { placement: selected.placement } : {}),
      index: selected ? selected.index + 1 : entries.length,
    });
    selectStep(id);
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
  const hasUnsavedDrafts = Object.keys(stepDrafts).length > 0 || Boolean(pendingCheckpoint);
  useEffect(() => {
    onEditingStateChange?.(
      edit.isPending || historyAction.isPending || settings.isPending || repair.isPending
        ? "saving"
        : document.isError ||
            liveEditor.isError ||
            /Conflict|Could not|failed|unavailable/iu.test(saveNotice)
          ? "failed"
          : hasUnsavedDrafts ||
              settingsName !== (editorDocument?.test.name ?? "") ||
              settingsOrigin !== (editorDocument?.test.originApplication ?? "")
            ? "dirty"
            : editorDocument
              ? "saved"
              : "loading",
    );
  }, [
    document.isError,
    edit.isPending,
    editorDocument,
    hasUnsavedDrafts,
    historyAction.isPending,
    liveEditor.isError,
    onEditingStateChange,
    repair.isPending,
    saveNotice,
    settings.isPending,
    settingsName,
    settingsOrigin,
  ]);
  const canRedo = latestHistory?.eventType === "test.undone" && Boolean(testEditorService.redo);
  const canUndo =
    Boolean(testEditorService.undo) &&
    Boolean(editorDocument?.history.some((item) => item.eventType !== "test.redone"));
  const stepEditor = editorDocument ? (
    <TestEditorSelectedStep
      editorDocument={editorDocument}
      selected={selected}
      stepDrafts={stepDrafts}
      onEditingStateChange={onEditingStateChange}
      updateStepDraft={updateStepDraft}
      busy={edit.isPending}
      pendingCheckpoint={pendingCheckpoint}
      apply={apply}
      onClearPending={() => setPendingCheckpoint(null)}
      selectStep={selectStep}
      onStepChange={onStepChange}
      onRemoveStep={removeStep}
      onAddChildStep={addChildStep}
    />
  ) : null;

  const saveState = (
    <EditorSaveStatus
      {...testEditorSaveState(
        edit.isPending || historyAction.isPending,
        saveNotice,
        hasUnsavedDrafts,
      )}
    />
  );
  const Frame = embedded ? EmbeddedFrame : WorkbenchPage;
  return (
    <Frame
      className={
        embedded
          ? "flex min-h-0 flex-1 flex-col"
          : "flex h-full min-h-0 max-w-none flex-col px-0! pt-0! pb-0!"
      }
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
      <TestEditorChrome
        embedded={embedded}
        sessionId={sessionId}
        editorDocument={editorDocument}
        saveState={saveState}
        saving={edit.isPending || historyAction.isPending || settings.isPending || repair.isPending}
        hasUnsavedChanges={
          hasUnsavedDrafts ||
          settingsName !== (editorDocument?.test.name ?? "") ||
          settingsOrigin !== (editorDocument?.test.originApplication ?? "")
        }
        hasUnsavedCheckpoint={Boolean(pendingCheckpoint)}
        onLeave={() => void navigate({ to: "/tests/$testId", params: { testId } })}
        settingsName={settingsName}
        settingsOrigin={settingsOrigin}
        settingsOpen={settingsOpen}
        settingsSaving={settings.isPending}
        settingsError={settings.error}
        onNameChange={(name) => {
          onEditingStateChange?.("dirty");
          setSettingsName(name);
        }}
        onOriginChange={(origin) => {
          onEditingStateChange?.("dirty");
          setSettingsOrigin(origin);
        }}
        onSettingsOpenChange={setSettingsOpen}
        onSaveSettings={() => settings.mutate()}
      />

      {(sessionId ? liveEditor.isPending : document.isPending) ? (
        <PageLoading label="Loading Test steps…" />
      ) : null}
      <RecordingProblem
        className="mx-4 mb-4"
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
            <Link className={productLinkClassName} to="/tests">
              Browse saved Tests
            </Link>
          }
        />
      ) : null}

      {editorDocument ? (
        <TestEditorWorkspace
          editorDocument={editorDocument}
          embedded={embedded}
          workspaceView={workspaceView}
          onWorkspaceViewChange={setWorkspaceView}
          saveState={saveState}
          settingsOpen={settingsOpen}
          onToggleSettings={() => setSettingsOpen((open) => !open)}
          editorExpanded={editorExpanded}
          hasPendingCheckpoint={Boolean(pendingCheckpoint)}
          stepEditor={stepEditor}
          entries={entries}
          selected={selected}
          editPending={edit.isPending}
          repairPending={repair.isPending}
          draggedStepId={draggedStepId}
          addStep={addStep}
          addCheckpoint={addCheckpoint}
          onSelectStep={selectStep}
          onCollapseEditor={() => setEditorExpanded(false)}
          move={move}
          dropOn={dropOn}
          onRepairDecision={(proposal, decision) => repair.mutate({ proposal, decision })}
          canUndo={canUndo}
          canRedo={canRedo}
          historyPending={historyAction.isPending}
          latestSummary={latestHistory?.summary}
          undo={undo}
          redo={redo}
          testId={testId}
          inspectorKind={liveEditor.data ? "device" : "browser"}
          browserPane={
            embedded ? (
              stage
            ) : sessionId ? (
              <LiveTestEditorPane
                session={liveEditor.data}
                loading={liveEditor.isPending}
                error={liveEditor.error}
              />
            ) : (
              <TestEditorBrowserPane
                appMapId={editorDocument.appMapId}
                startUrl={editorDocument.test.originApplication}
                browserTargetIds={editorDocument.browserTargetIds}
                recentAccountIds={recentAccountIds(recentRuns.data)}
              />
            )
          }
          latestEvidence={
            !embedded && !sessionId && recentRuns.data?.length ? (
              <details className="mt-4 text-sm text-muted-foreground">
                <summary className="cursor-pointer py-2">Latest result</summary>
                <TestEditorEvidencePanel
                  step={selected?.step}
                  report={latestReport.data}
                  hasRuns
                  loading={reportLoading}
                />
              </details>
            ) : null
          }
        />
      ) : null}
    </Frame>
  );
}

function EmbeddedFrame(props: import("react").ComponentProps<"div">) {
  return <div {...props} />;
}
