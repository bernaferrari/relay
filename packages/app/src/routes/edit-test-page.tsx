/** @jsxImportSource react */
import { TestEditorBrowserPane } from "./test-editor-browser-pane";
import { TestEditorDoneButton } from "./test-editor-done-button";
import { EditorSaveStatus } from "../components/editor-save-status";
import { WorkbenchPage } from "../components/page-layout";
import type { AppMapScenarioTestStep, AppMapTestStepPlacement } from "@relay/protocol";
import { ApiError } from "@relay/client";
import { Button } from "@relay/ui-react/components/button";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useNavigate, useRouteContext } from "@tanstack/react-router";
import { Settings2 } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
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
import { TestEditorHistoryBar, TestEditorSettingsPanel } from "./test-editor-page-sections";
import {
  collectStepEntries,
  insertPendingCheckpoint,
  type PendingCheckpointDraft,
} from "./test-editor-route-helpers";
import { useTestStepDrafts } from "./use-test-step-drafts";
import { productLinkClassName } from "../lib/class-names";

const routeApi = getRouteApi("/tests/$testId/edit");

/** Editing lives on the Test page. This route only hosts live device sessions. */
export function EditTestPage() {
  const { testId } = routeApi.useParams();
  const search = routeApi.useSearch() as { step?: unknown; session?: unknown; app?: unknown };
  const navigate = useNavigate({ from: "/tests/$testId/edit" });
  const sessionId = typeof search.session === "string" ? search.session : undefined;
  const stepId = typeof search.step === "string" ? search.step : undefined;
  const appMapId = typeof search.app === "string" ? search.app : undefined;
  useEffect(() => {
    if (sessionId) return;
    void navigate({
      to: "/tests/$testId",
      params: { testId },
      search: { ...(stepId ? { step: stepId } : {}), ...(appMapId ? { app: appMapId } : {}) },
      replace: true,
    });
  }, [appMapId, navigate, sessionId, stepId, testId]);
  if (!sessionId) return <PageLoading label="Opening the Test…" />;
  return (
    <TestEditor
      key={`${appMapId ?? "unscoped"}:${testId}`}
      testId={testId}
      appMapId={appMapId}
      sessionId={sessionId}
      stepId={stepId}
      onStepChange={(step) =>
        void navigate({ search: (previous) => ({ ...previous, step }), replace: true })
      }
    />
  );
}

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
    <aside className="min-w-0" aria-label="Selected step editor">
      {selected ? (
        <SelectedStepEditor
          key={`${selected.step.id}:${editorDocument.revision}`}
          entry={selected}
          savedPaths={editorDocument.savedPaths}
          appMapId={editorDocument.appMapId}
          draft={stepDrafts[selected.step.id]}
          onDraftChange={(draft) => {
            onEditingStateChange?.("dirty");
            updateStepDraft(selected.step.id, draft);
          }}
          busy={edit.isPending}
          unsavedCheckpoint={pendingCheckpoint?.step.id === selected.step.id}
          onSave={(transaction) => {
            if (pendingCheckpoint?.step.id !== selected.step.id) {
              apply(transaction);
              return;
            }
            const patch = transaction.forward.find((item) => item.kind === "step.patch");
            if (!patch || patch.kind !== "step.patch") return;
            const binding = patch.patch.binding;
            if (
              !binding ||
              binding.status !== "resolved" ||
              (binding.kind !== "assertion" && binding.kind !== "recipe-step")
            )
              return;
            apply({
              label: "Added a checkpoint",
              forward: [
                {
                  kind: "step.add",
                  step: {
                    ...pendingCheckpoint.step,
                    ...(patch.patch.intent === undefined ? {} : { intent: patch.patch.intent }),
                    ...(patch.patch.note === undefined
                      ? {}
                      : patch.patch.note === null
                        ? { note: undefined }
                        : { note: patch.patch.note }),
                    ...(patch.patch.capture === undefined ? {} : { capture: patch.patch.capture }),
                    binding,
                  },
                  ...(pendingCheckpoint.placement
                    ? { placement: pendingCheckpoint.placement }
                    : {}),
                  index: pendingCheckpoint.index,
                },
              ],
              reverse: [{ kind: "step.remove", stepId: pendingCheckpoint.step.id }],
            });
          }}
          onBind={(transaction) => {
            if (pendingCheckpoint?.step.id === selected.step.id) return;
            apply(transaction);
          }}
          onRemove={() => {
            if (pendingCheckpoint?.step.id === selected.step.id) {
              const previous =
                selected.siblingIds[selected.index - 1] ?? selected.placement?.parentStepId ?? null;
              setPendingCheckpoint(null);
              if (previous) selectStep(previous);
              else onStepChange(undefined);
              return;
            }
            removeStep(selected);
          }}
          onAddChild={(branch) => addChildStep(selected, branch)}
          platformBlocker={editorDocument.stepPlatformBlockers?.[selected.step.id]}
          hasRememberableReply={editorDocument.hasRememberableReply === true}
        />
      ) : (
        <EmptyState
          title="Choose a step"
          detail="Select a step to edit its instruction, note, and evidence capture."
        />
      )}
    </aside>
  ) : null;

  const saveState = (
    <EditorSaveStatus
      state={
        edit.isPending || historyAction.isPending
          ? "saving"
          : saveNotice.startsWith("Conflict")
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
      {embedded ? (
        <TestEditorDoneButton
          saving={
            edit.isPending || historyAction.isPending || settings.isPending || repair.isPending
          }
          hasUnsavedChanges={
            hasUnsavedDrafts ||
            settingsName !== (editorDocument?.test.name ?? "") ||
            settingsOrigin !== (editorDocument?.test.originApplication ?? "")
          }
          hasUnsavedCheckpoint={Boolean(pendingCheckpoint)}
          onLeave={() => void navigate({ to: "/tests/$testId", params: { testId } })}
          showDoneButton={false}
        />
      ) : null}
      {embedded ? null : (
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold" title={editorDocument?.test.name}>
              {editorDocument?.test.name ?? "Edit Test"}
            </h1>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {editorDocument?.appName}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {saveState}
            {!sessionId ? (
              <Button
                size="icon-sm"
                aria-label="Test settings"
                title="Test settings"
                variant="ghost"
                onClick={() => setSettingsOpen((open) => !open)}
              >
                <Settings2 aria-hidden="true" />
              </Button>
            ) : null}
            <TestEditorDoneButton
              saving={
                edit.isPending || historyAction.isPending || settings.isPending || repair.isPending
              }
              hasUnsavedChanges={
                hasUnsavedDrafts ||
                settingsName !== (editorDocument?.test.name ?? "") ||
                settingsOrigin !== (editorDocument?.test.originApplication ?? "")
              }
              hasUnsavedCheckpoint={Boolean(pendingCheckpoint)}
              onLeave={() => void navigate({ to: "/tests/$testId", params: { testId } })}
            />
          </div>
        </header>
      )}
      {!sessionId ? (
        <TestEditorSettingsPanel
          name={settingsName}
          originApplication={settingsOrigin}
          open={settingsOpen}
          saving={settings.isPending}
          error={settings.error}
          onNameChange={(name) => {
            onEditingStateChange?.("dirty");
            setSettingsName(name);
          }}
          onOriginChange={(origin) => {
            onEditingStateChange?.("dirty");
            setSettingsOrigin(origin);
          }}
          onOpenChange={setSettingsOpen}
          onRetry={() => settings.mutate()}
          onSave={() => settings.mutate()}
        />
      ) : null}

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
        <>
          <div
            className="flex shrink-0 gap-1 border-b border-border px-3 py-2 min-[1100px]:hidden"
            aria-label="Editor view"
          >
            {(["steps", "browser"] as const).map((view) => (
              <Button
                key={view}
                size="sm"
                variant={workspaceView === view ? "secondary" : "ghost"}
                aria-pressed={workspaceView === view}
                onClick={() => setWorkspaceView(view)}
              >
                {view === "steps" ? "Steps" : "Browser"}
              </Button>
            ))}
          </div>
          <div
            className={`grid min-h-0 flex-1 ${embedded ? "min-[1100px]:grid-cols-[340px_minmax(0,1fr)]" : "min-[1100px]:grid-cols-[280px_minmax(0,1fr)]"}`}
          >
            <div
              className={`${workspaceView === "steps" ? "flex" : "hidden"} min-h-0 min-w-0 flex-col min-[1100px]:flex min-[1100px]:border-r min-[1100px]:border-border`}
            >
              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
                <TestEditorStepOutline
                  headerAside={
                    embedded ? (
                      <>
                        {saveState}
                        <Button
                          size="icon-sm"
                          aria-label="Test settings"
                          title="Name and details"
                          variant="ghost"
                          onClick={() => setSettingsOpen((open) => !open)}
                        >
                          <Settings2 aria-hidden="true" />
                        </Button>
                      </>
                    ) : undefined
                  }
                  showDetails={settingsOpen}
                  selectedEditor={editorExpanded || pendingCheckpoint ? stepEditor : null}
                  test={editorDocument.test}
                  recordedPlatforms={editorDocument.recordedPlatforms}
                  routePlatformBlockers={editorDocument.routePlatformBlockers}
                  stepPlatformBlockers={editorDocument.stepPlatformBlockers}
                  originEvidenceMissing={editorDocument.originEvidenceMissing}
                  entries={entries}
                  selectedStepId={
                    editorExpanded || pendingCheckpoint ? selected?.step.id : undefined
                  }
                  busy={edit.isPending || repair.isPending}
                  draggedStepId={draggedStepId}
                  onAdd={addStep}
                  onAddCheckpoint={addCheckpoint}
                  onSelect={(id) => {
                    if (id === selected?.step.id && editorExpanded) setEditorExpanded(false);
                    else selectStep(id);
                  }}
                  onMove={move}
                  onDrop={dropOn}
                />
                {editorDocument.repairs.length ? (
                  <RepairSection
                    repairs={editorDocument.repairs}
                    busy={repair.isPending}
                    onDecision={(proposal, decision) => repair.mutate({ proposal, decision })}
                  />
                ) : null}
                {settingsOpen &&
                (editorDocument.repairs.length || editorDocument.history.length) ? (
                  <details className="mt-4 border-t border-border pt-2 text-sm text-muted-foreground">
                    <summary className="cursor-pointer py-2">
                      History
                      {editorDocument.repairs.length
                        ? ` and ${editorDocument.repairs.length} suggested repairs`
                        : ""}
                    </summary>
                    <div className="grid gap-6 pt-4">
                      {editorDocument.history.length ? (
                        <HistorySection items={editorDocument.history} />
                      ) : null}
                    </div>
                  </details>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center justify-between border-t border-border px-3 py-2">
                <TestEditorHistoryBar
                  canUndo={canUndo}
                  canRedo={canRedo}
                  busy={edit.isPending || historyAction.isPending}
                  latestSummary={latestHistory?.summary}
                  onUndo={undo}
                  onRedo={redo}
                />
                {embedded ? null : (
                  <Link
                    className="text-xs text-muted-foreground hover:text-foreground"
                    to="/tests/$testId"
                    params={{ testId }}
                  >
                    Run setup →
                  </Link>
                )}
              </div>
            </div>
            <div
              className={`${workspaceView === "browser" ? "flex" : "hidden"} min-h-0 min-w-0 flex-col overflow-y-auto min-[1100px]:flex`}
              data-inspector-kind={liveEditor.data ? "device" : "browser"}
            >
              {embedded ? (
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
              )}
              {!embedded && !sessionId && recentRuns.data?.length ? (
                <details className="mt-4 text-sm text-muted-foreground">
                  <summary className="cursor-pointer py-2">Latest result</summary>
                  <TestEditorEvidencePanel
                    step={selected?.step}
                    report={latestReport.data}
                    hasRuns
                    loading={reportLoading}
                  />
                </details>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </Frame>
  );
}

function EmbeddedFrame(props: import("react").ComponentProps<"div">) {
  return <div {...props} />;
}

/** Accounts this Test ran as, newest run first. */
export function recentAccountIds(
  runs: readonly { queuedAt: number; executionIdentity?: { accountId?: string } }[] = [],
): string[] {
  return [...runs]
    .sort((left, right) => right.queuedAt - left.queuedAt)
    .flatMap((run) => (run.executionIdentity?.accountId ? [run.executionIdentity.accountId] : []));
}
