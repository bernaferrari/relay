import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type {
  AppMapCompiledTest,
  AppMapScenarioTest,
  AppMapScenarioTestStep,
  AppMapTest,
  Proposal,
} from "@relay/protocol";
import { Button } from "@relay/ui/button";
import { useServer } from "../context/server";
import { planScenarioTestEdits } from "../lib/app-map-scenario-edit-plan";
import { cn } from "../lib/cn";
import { useAppMapProposalReview } from "../lib/use-app-map-proposal-review";
import {
  createScenarioStep,
  createScenarioTest,
  scenarioDiagnostics,
  testKindDescription,
  type ScenarioStepKind,
} from "../lib/app-map-test-editor-model";
import {
  addScenarioChild,
  deleteScenarioStepTree,
  duplicateScenarioStepTree,
  findScenarioStep,
  flattenScenarioSteps,
  moveScenarioStepTree,
  siblingFocusAfterDelete,
  updateScenarioStepTree,
  type ScenarioStepBranch,
} from "../lib/app-map-test-editor-tree";
import { AppMapTestInspector } from "./app-map-test-inspector";
import { AppMapTestOutline } from "./app-map-test-outline";
import { AppMapTestUndo } from "./app-map-test-undo";
import { AppMapTestDeviceEvidence } from "./app-map-test-device-evidence";
import {
  AppMapTestRunControl,
  isActiveTestRun,
  type TestRunLaunchState,
} from "./app-map-test-run-control";
import { testEditorInput, testEditorLabel } from "./app-map-test-binding-editor";
import { Icon } from "./icon";
import { confirmAction } from "./confirm-dialog";
import { AppMapTestProposalReview } from "./app-map-test-proposal-review";

type SaveState = "saved" | "saving" | "error";
type MobilePane = "steps" | "edit" | "device" | "results";
type UndoDelete = {
  message: string;
  test: AppMapScenarioTest;
  selectedStepId?: string;
};

export function AppMapTestWorkspace(props: {
  testId?: string;
  onTestChange?: (testId: string) => void;
  onOpenMap: () => void;
  onOpenRun?: (runId: string) => void;
}) {
  const server = useServer();
  const appMap = createMemo(() => server.selectedAppMap());
  const tests = createMemo(() =>
    Object.values(appMap()?.tests ?? {}).toSorted(
      (left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name),
    ),
  );
  const [localTestId, setLocalTestId] = createSignal("");
  const selectedTestId = () => props.testId ?? localTestId();
  const selectedTest = createMemo(() => tests().find((test) => test.id === selectedTestId()));
  const [draft, setDraft] = createSignal<AppMapScenarioTest>();
  const [selectedStepId, setSelectedStepId] = createSignal<string>();
  const [saveState, setSaveState] = createSignal<SaveState>("saved");
  const [saveError, setSaveError] = createSignal("");
  const [retryAvailable, setRetryAvailable] = createSignal(false);
  const [undoDelete, setUndoDelete] = createSignal<UndoDelete>();
  const [deletedTest, setDeletedTest] = createSignal<AppMapTest>();
  const [creating, setCreating] = createSignal(false);
  const [compiledPlan, setCompiledPlan] = createSignal<AppMapCompiledTest>();
  const [runJobId, setRunJobId] = createSignal<string>();
  const [runLaunchState, setRunLaunchState] = createSignal<TestRunLaunchState>("idle");
  const [runError, setRunError] = createSignal("");
  const [runAttributionMismatch, setRunAttributionMismatch] = createSignal(false);
  const [mobile, setMobile] = createSignal(false);
  const [mobilePane, setMobilePane] = createSignal<MobilePane>("steps");
  const [proposalReviewOpen, setProposalReviewOpen] = createSignal(false);
  const { proposalBusyId, proposalError, decideProposal } = useAppMapProposalReview(
    () => appMap() ?? undefined,
  );
  let loadedKey = "";
  let optimisticRevision = 0;
  let saveQueue = Promise.resolve();
  let pendingSaves = 0;
  let failedDraft: AppMapScenarioTest | undefined;
  let queuedDraft: AppMapScenarioTest | undefined;
  let runTestKey = "";

  onMount(() => {
    const query = window.matchMedia("(max-width: 760px)");
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener("change", update);
    onCleanup(() => query.removeEventListener("change", update));
  });

  const selectTest = (id: string) => {
    setLocalTestId(id);
    props.onTestChange?.(id);
  };

  createEffect(() => {
    const map = appMap();
    if (!map) return;
    const current = selectedTestId();
    if (!current || !map.tests[current]) {
      const first = tests()[0];
      if (first) selectTest(first.id);
    }
  });

  createEffect(() => {
    const map = appMap();
    const test = selectedTest();
    if (!map || !test) {
      setDraft();
      queuedDraft = undefined;
      setUndoDelete();
      setSelectedStepId();
      loadedKey = "";
      runTestKey = "";
      setRunJobId();
      setRunLaunchState("idle");
      setRunError("");
      setRunAttributionMismatch(false);
      return;
    }
    const nextRunTestKey = `${map.id}:${test.id}`;
    if (nextRunTestKey !== runTestKey) {
      runTestKey = nextRunTestKey;
      setRunJobId();
      setRunLaunchState("idle");
      setRunError("");
      setRunAttributionMismatch(false);
    }
    const key = `${map.id}:${test.id}:${map.revision}`;
    if (key === loadedKey || saveState() !== "saved") return;
    loadedKey = key;
    setCompiledPlan();
    setUndoDelete();
    optimisticRevision = map.revision;
    if (test.kind === "scenario") {
      const copy = structuredClone(test);
      queuedDraft = copy;
      setDraft(copy);
      setSelectedStepId((id) =>
        findScenarioStep(copy.steps, id) ? id : flattenScenarioSteps(copy.steps)[0]?.step.id,
      );
    } else {
      setDraft();
      setSelectedStepId();
    }
  });

  const diagnostics = createMemo(() => {
    const map = appMap();
    const test = draft();
    return map && test ? scenarioDiagnostics(map, test) : [];
  });
  const blockers = () => diagnostics().filter((item) => item.tone === "blocker");
  const selectedItem = createMemo(() =>
    flattenScenarioSteps(draft()?.steps ?? []).find((item) => item.step.id === selectedStepId()),
  );
  const pendingTestProposals = createMemo(() => {
    const id = selectedTestId();
    return Object.values(appMap()?.proposals ?? {})
      .filter(
        (proposal): proposal is Proposal =>
          proposal.status === "pending" &&
          proposal.changes.some((change) => change.kind === "test.edit" && change.testId === id),
      )
      .sort((left, right) => left.createdAt - right.createdAt);
  });
  const runJob = createMemo(() => {
    const id = runJobId();
    return id ? server.jobs().find((job) => job.id === id) : undefined;
  });
  const selectedDevice = createMemo(() =>
    server.devices().find((device) => device.serial === server.selectedDevice()),
  );
  const runBlockedReason = createMemo(() => {
    if (server.isOffline()) return "Reconnect Relay before running this Test.";
    if (saveState() === "saving") return "Wait for the latest changes to finish saving.";
    if (saveState() === "error") return "Retry the local changes before running.";
    if (blockers().length) {
      return `Resolve ${blockers().length} incomplete ${blockers().length === 1 ? "binding" : "bindings"} before running.`;
    }
    if (!selectedDevice()) return "Choose a target before running this Test.";
    if (!selectedDevice()?.platform) return "Refresh the selected target before running this Test.";
    return undefined;
  });

  function queueSave(next: AppMapScenarioTest, options?: { preserveUndo?: boolean }): void {
    const map = appMap();
    if (!map) return;
    const snapshot = structuredClone(next);
    const previous = queuedDraft ?? draft();
    if (!previous) return;
    const edits = planScenarioTestEdits(previous, snapshot);
    if (!options?.preserveUndo) setUndoDelete();
    queuedDraft = snapshot;
    setDraft(snapshot);
    setCompiledPlan();
    if (!isActiveTestRun(runJob())) {
      setRunJobId();
      setRunLaunchState("idle");
      setRunError("");
      setRunAttributionMismatch(false);
    }
    if (edits.length === 0) {
      if (failedDraft) {
        failedDraft = snapshot;
        setRetryAvailable(true);
        setSaveState("error");
        return;
      }
      failedDraft = undefined;
      setSaveError("");
      setRetryAvailable(false);
      setSaveState("saved");
      return;
    }
    if (failedDraft) {
      failedDraft = snapshot;
      setRetryAvailable(true);
      setSaveState("error");
      return;
    }
    setSaveError("");
    setRetryAvailable(false);
    setSaveState("saving");
    pendingSaves += 1;
    saveQueue = saveQueue.then(async () => {
      try {
        if (failedDraft) {
          failedDraft = snapshot;
          setRetryAvailable(true);
          setSaveState("error");
          return;
        }
        const result = await server.editTest({
          appMapId: map.id,
          testId: snapshot.id,
          expectedRevision: optimisticRevision,
          edits,
        });
        optimisticRevision = result.appMap.revision;
        await server.refreshAppMaps();
      } catch (error) {
        failedDraft = snapshot;
        setRetryAvailable(true);
        setSaveError(error instanceof Error ? error.message : String(error));
        setSaveState("error");
      } finally {
        pendingSaves -= 1;
        if (pendingSaves === 0 && !failedDraft) setSaveState("saved");
      }
    });
  }

  async function retrySave(): Promise<void> {
    const snapshot = failedDraft;
    if (!snapshot) return;
    failedDraft = undefined;
    setRetryAvailable(false);
    setSaveError("");
    try {
      await server.refreshAppMaps();
    } catch (error) {
      failedDraft = snapshot;
      setRetryAvailable(true);
      setSaveState("error");
      setSaveError(
        `Could not refresh server truth. ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    const currentMap = server.selectedAppMap();
    const canonical = currentMap?.tests[snapshot.id];
    if (!currentMap || !canonical || canonical.kind !== "scenario") {
      failedDraft = snapshot;
      setRetryAvailable(true);
      setSaveState("error");
      setSaveError("The Test no longer exists as a graph-native scenario. Reload the editor.");
      return;
    }
    optimisticRevision = currentMap.revision;
    queuedDraft = structuredClone(canonical);
    queueSave(snapshot);
  }

  function updateDraftStep(next: AppMapScenarioTestStep): void {
    setDraft((test) =>
      test ? { ...test, steps: updateScenarioStepTree(test.steps, next.id, () => next) } : test,
    );
  }

  function commitStep(next: AppMapScenarioTestStep): void {
    const test = draft();
    if (!test) return;
    queueSave({
      ...test,
      steps: updateScenarioStepTree(test.steps, next.id, () => next),
      updatedAt: Date.now(),
    });
  }

  function focusStep(stepId: string | undefined, intent = false): void {
    if (!stepId) return;
    queueMicrotask(() => {
      const id = intent ? `test-step-intent-${stepId}` : `test-step-row-${stepId}`;
      document.getElementById(id)?.focus();
    });
  }

  function addRootStep(kind: ScenarioStepKind): void {
    const test = draft();
    if (!test) return;
    const step = createScenarioStep(kind);
    queueSave({ ...test, steps: [...test.steps, step], updatedAt: Date.now() });
    setSelectedStepId(step.id);
    if (mobile()) setMobilePane("edit");
    focusStep(step.id, true);
  }

  function addChildStep(
    parentStepId: string,
    branch: Exclude<ScenarioStepBranch, "root">,
    kind: ScenarioStepKind,
  ): void {
    const test = draft();
    if (!test) return;
    const step = createScenarioStep(kind);
    queueSave({
      ...test,
      steps: addScenarioChild(test.steps, parentStepId, branch, step),
      updatedAt: Date.now(),
    });
    setSelectedStepId(step.id);
    if (mobile()) setMobilePane("edit");
    focusStep(step.id, true);
  }

  function moveStep(stepId: string, direction: -1 | 1): void {
    const test = draft();
    if (!test) return;
    queueSave({
      ...test,
      steps: moveScenarioStepTree(test.steps, stepId, direction),
      updatedAt: Date.now(),
    });
    focusStep(stepId);
  }

  function duplicateStep(stepId: string): void {
    const test = draft();
    if (!test) return;
    let duplicateId: string | undefined;
    const steps = duplicateScenarioStepTree(test.steps, stepId, () => {
      const id = crypto.randomUUID();
      duplicateId ??= id;
      return id;
    });
    queueSave({ ...test, steps, updatedAt: Date.now() });
    setSelectedStepId(duplicateId);
    focusStep(duplicateId);
  }

  function deleteStep(stepId: string): void {
    const test = draft();
    if (!test) return;
    const deleted = findScenarioStep(test.steps, stepId);
    const nextSelection = siblingFocusAfterDelete(test.steps, stepId);
    setUndoDelete({
      message: `Deleted ${deleted?.intent || "step"}`,
      test: structuredClone(test),
      selectedStepId: stepId,
    });
    queueSave(
      {
        ...test,
        steps: deleteScenarioStepTree(test.steps, stepId),
        updatedAt: Date.now(),
      },
      { preserveUndo: true },
    );
    setSelectedStepId(nextSelection);
    focusStep(nextSelection);
  }

  function undoStepDelete(): void {
    const deleted = undoDelete();
    if (!deleted) return;
    setUndoDelete();
    queueSave({ ...deleted.test, updatedAt: Date.now() });
    setSelectedStepId(deleted.selectedStepId);
    focusStep(deleted.selectedStepId);
  }

  async function createTest(): Promise<void> {
    const map = appMap();
    if (!map || creating()) return;
    setCreating(true);
    const next = createScenarioTest(map, `Test ${Object.keys(map.tests).length + 1}`);
    try {
      const result = await server.saveTest({
        appMapId: map.id,
        expectedRevision: map.revision,
        test: next,
      });
      optimisticRevision = result.appMap.revision;
      await server.refreshAppMaps();
      selectTest(next.id);
    } catch (error) {
      setRetryAvailable(false);
      setSaveError(error instanceof Error ? error.message : String(error));
      setSaveState("error");
    } finally {
      setCreating(false);
    }
  }

  async function duplicateTest(): Promise<void> {
    const map = appMap();
    const test = selectedTest();
    if (!map || !test || saveState() !== "saved") return;
    const now = Date.now();
    const copy: AppMapTest = {
      ...structuredClone(test),
      id: crypto.randomUUID(),
      name: `${test.name} copy`,
      ...(test.kind === "scenario" ? { steps: renewScenarioStepIds(test.steps) } : {}),
      createdAt: now,
      updatedAt: now,
    };
    try {
      const result = await server.saveTest({
        appMapId: map.id,
        expectedRevision: map.revision,
        test: copy,
      });
      optimisticRevision = result.appMap.revision;
      await server.refreshAppMaps();
      selectTest(copy.id);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
      setSaveState("error");
    }
  }

  async function convertPathTest(test: AppMapTest): Promise<void> {
    const map = appMap();
    if (!map || test.kind !== "path" || !test.flowId) return;
    const flow = map.flows[test.flowId];
    if (!flow) {
      setSaveError("The recorded path no longer references a saved flow.");
      setSaveState("error");
      return;
    }
    const next = createScenarioTest(map, `${test.name} editable`);
    next.capture = test.capture;
    next.steps = [
      {
        id: crypto.randomUUID(),
        kind: "instruction",
        intent: `Follow ${flow.name}`,
        binding: {
          status: "resolved",
          kind: "connections",
          connectionIds: [...flow.connectionIds],
        },
      },
    ];
    try {
      await server.saveTest({ appMapId: map.id, expectedRevision: map.revision, test: next });
      await server.refreshAppMaps();
      selectTest(next.id);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
      setSaveState("error");
    }
  }

  function deleteTest(): void {
    const map = appMap();
    const test = selectedTest();
    if (!map || !test || saveState() !== "saved") return;
    confirmAction({
      title: `Delete “${test.name}”?`,
      body: "This removes the Test from this map. Its existing run evidence is kept in Runs.",
      confirmLabel: "Delete Test",
      tone: "destructive",
      onConfirm: async () => {
        try {
          await server.runAction("app-map.test.remove", {
            appMapId: map.id,
            testId: test.id,
            expectedRevision: map.revision,
          });
          selectTest("");
          await server.refreshAppMaps();
          setDeletedTest(structuredClone(test));
          if (mobile()) setMobilePane("edit");
        } catch (error) {
          setSaveError(error instanceof Error ? error.message : String(error));
          setSaveState("error");
        }
      },
    });
  }

  async function restoreDeletedTest(): Promise<void> {
    const test = deletedTest();
    const map = appMap();
    if (!test || !map) return;
    try {
      await server.saveTest({
        appMapId: map.id,
        expectedRevision: map.revision,
        test: { ...structuredClone(test), updatedAt: Date.now() },
      });
      setDeletedTest();
      await server.refreshAppMaps();
      selectTest(test.id);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
      setSaveState("error");
    }
  }

  function resolveRunBlocker(): void {
    if (saveState() === "error") {
      if (retryAvailable()) void retrySave();
      else {
        if (mobile()) setMobilePane("edit");
        queueMicrotask(() => document.getElementById("test-save-error")?.focus());
      }
      return;
    }
    const first = blockers().find((item) => item.stepId);
    if (first?.stepId) {
      setSelectedStepId(first.stepId);
      if (mobile()) setMobilePane("edit");
      focusStep(first.stepId, true);
      return;
    }
    if (blockers().length) {
      if (mobile()) setMobilePane(draft()?.steps.length ? "edit" : "steps");
      queueMicrotask(() => document.getElementById("scenario-test-name")?.focus());
      return;
    }
    if (!selectedDevice()) {
      window.dispatchEvent(new CustomEvent("relay:open-device-picker"));
      return;
    }
  }

  const runBlockerActionLabel = createMemo(() => {
    if (server.isOffline() || saveState() === "saving") return undefined;
    if (saveState() === "error") return retryAvailable() ? "Retry save" : "Review save error";
    if (blockers().length)
      return `Fix ${blockers().length} ${blockers().length === 1 ? "binding" : "bindings"}`;
    if (!selectedDevice()) return "Choose target";
    return undefined;
  });

  async function runTest(): Promise<void> {
    const map = appMap();
    const test = draft();
    const device = selectedDevice();
    if (!map || !test || !device || runBlockedReason() || isActiveTestRun(runJob())) return;
    setRunLaunchState("preparing");
    setRunError("");
    setRunAttributionMismatch(false);
    setRunJobId();
    try {
      await saveQueue;
      const target =
        device.platform === "browser"
          ? ({ kind: "browser", platform: "browser", targetId: device.serial } as const)
          : ({
              kind: "device",
              platform: device.platform!,
              targetId: device.serial,
            } as const);
      const result = await server.runAction("app-map.test.run", {
        appMapId: map.id,
        testId: test.id,
        expectedRevision: map.revision,
        target,
      });
      setCompiledPlan(result.plan);
      setRunJobId(result.job.id);
      await server.refreshJobs();
      setRunLaunchState("idle");
      const job = server.jobs().find((candidate) => candidate.id === result.job.id);
      if (job && job.action !== result.planIdentity.rootRecipeId) {
        setRunAttributionMismatch(true);
        setRunError("The queued job does not match this saved Test revision.");
        setRunLaunchState("error");
      }
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error));
      setRunLaunchState("error");
    }
  }

  async function cancelRun(): Promise<void> {
    const id = runJobId();
    if (!id || !isActiveTestRun(runJob()) || runLaunchState() === "canceling") return;
    setRunLaunchState("canceling");
    await server.cancelJob(id);
    await server.refreshJobs();
    setRunLaunchState(runAttributionMismatch() ? "error" : "idle");
  }

  return (
    <section
      class="relative grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-[var(--map-canvas)] text-text-strong"
      onKeyDown={(event) => {
        const target = event.target as HTMLElement;
        if (
          !undoDelete() ||
          !(event.metaKey || event.ctrlKey) ||
          event.key.toLowerCase() !== "z" ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
          target.isContentEditable
        ) {
          return;
        }
        event.preventDefault();
        undoStepDelete();
      }}
    >
      <header class="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-border-weak-base bg-surface-raised-stronger-non-alpha px-4 py-2">
        <div class="min-w-0">
          <p class="m-0 text-[10px] font-semibold tracking-[0.08em] text-text-weaker uppercase">
            Test editor
          </p>
          <p class="m-0 truncate text-[13px] font-semibold">{appMap()?.name ?? "App map"}</p>
        </div>
        <div class="flex flex-wrap items-center justify-end gap-2">
          <span class="text-[11px] text-text-weak" role="status" aria-live="polite">
            {saveState() === "saving"
              ? "Saving…"
              : saveState() === "error"
                ? "Not saved"
                : draft()
                  ? blockers().length
                    ? `${blockers().length} incomplete`
                    : "Ready to run"
                  : "Saved"}
          </span>
          <Button variant="secondary" size="sm" onClick={props.onOpenMap}>
            <Icon name="map" size={13} /> Open map
          </Button>
          <Show when={draft()}>
            <Show when={pendingTestProposals().length > 0}>
              <Button
                variant="secondary"
                size="sm"
                class="min-h-11"
                onClick={() => setProposalReviewOpen(true)}
              >
                <Icon name="sparkle" size={13} /> {pendingTestProposals().length} proposed
              </Button>
            </Show>
            <AppMapTestRunControl
              launchState={runLaunchState()}
              job={runJob()}
              blockedReason={runBlockedReason()}
              error={runError()}
              blockedActionLabel={runBlockerActionLabel()}
              onResolveBlocked={runBlockerActionLabel() ? resolveRunBlocker : undefined}
              onRun={() => void runTest()}
              onCancel={() => void cancelRun()}
              onOpenResult={() => {
                const id = runJobId();
                if (!id) return;
                props.onOpenRun?.(id);
                setRunJobId();
              }}
            />
          </Show>
        </div>
      </header>

      <div class="min-h-0 max-[760px]:flex max-[760px]:flex-col">
        <MobilePaneNav value={mobilePane()} onChange={setMobilePane} />
        <div class="grid min-h-0 h-full grid-cols-[minmax(260px,0.8fr)_minmax(320px,1fr)_minmax(300px,0.9fr)] max-[1180px]:grid-cols-[minmax(280px,0.9fr)_minmax(340px,1.1fr)] max-[1180px]:grid-rows-[minmax(0,1fr)_minmax(280px,42%)] max-[760px]:block max-[760px]:flex-1">
          <div
            class={cn(
              "flex min-h-0 flex-col border-r border-border-weak-base bg-background-base max-[760px]:h-full max-[760px]:border-r-0",
              mobile() && mobilePane() !== "steps" && "hidden",
            )}
            inert={mobile() && mobilePane() !== "steps"}
          >
            <TestPicker
              tests={tests()}
              selectedTestId={selectedTestId()}
              disabled={saveState() !== "saved"}
              creating={creating()}
              onSelect={selectTest}
              onCreate={() => void createTest()}
              onDuplicate={() => void duplicateTest()}
              onDelete={deleteTest}
            />
            <Show
              when={selectedTest()}
              fallback={<FirstTestEmpty creating={creating()} onCreate={() => void createTest()} />}
            >
              {(test) => (
                <Show
                  when={test().kind === "scenario" && draft()}
                  fallback={
                    <LegacyTest
                      test={test()}
                      onCreate={() => void createTest()}
                      onConvert={() => void convertPathTest(test())}
                    />
                  }
                >
                  <AppMapTestOutline
                    map={appMap()!}
                    test={draft()!}
                    selectedStepId={selectedStepId()}
                    diagnostics={diagnostics()}
                    onSelect={(id) => {
                      setSelectedStepId(id);
                      if (mobile()) {
                        setMobilePane("edit");
                        focusStep(id, true);
                      }
                    }}
                    onAddRoot={addRootStep}
                    onAddChild={addChildStep}
                    onMove={moveStep}
                    onDuplicate={duplicateStep}
                    onDelete={deleteStep}
                  />
                </Show>
              )}
            </Show>
          </div>

          <div
            class={cn(
              "min-h-0 overflow-y-auto bg-surface-raised-stronger-non-alpha max-[760px]:h-full",
              mobile() && mobilePane() !== "edit" && "hidden",
            )}
            inert={mobile() && mobilePane() !== "edit"}
          >
            <Show when={deletedTest()}>
              {(test) => (
                <AppMapTestUndo
                  message={`Deleted ${test().name}`}
                  onUndo={() => void restoreDeletedTest()}
                  onDismiss={() => setDeletedTest()}
                />
              )}
            </Show>
            <Show when={undoDelete()}>
              {(undo) => (
                <AppMapTestUndo
                  message={undo().message}
                  onUndo={undoStepDelete}
                  onDismiss={() => setUndoDelete()}
                />
              )}
            </Show>
            <Show when={saveState() === "error"}>
              <div
                id="test-save-error"
                tabindex={-1}
                class="m-3 flex items-start justify-between gap-3 rounded-lg border border-border-critical-base bg-surface-critical-weak p-3 text-[12px] text-text-critical-base"
                role="alert"
              >
                <span>
                  <strong>Changes are still local.</strong> {saveError()}
                </span>
                <Show
                  when={retryAvailable()}
                  fallback={
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setSaveError("");
                        setSaveState("saved");
                      }}
                    >
                      Dismiss
                    </Button>
                  }
                >
                  <Button variant="secondary" size="sm" onClick={() => void retrySave()}>
                    Retry save
                  </Button>
                </Show>
              </div>
            </Show>
            <Show when={draft()}>
              {(test) => (
                <div class="grid gap-5 p-4">
                  <label class="grid gap-1.5" for="scenario-test-name">
                    <span class={testEditorLabel}>Test name</span>
                    <input
                      id="scenario-test-name"
                      class={testEditorInput}
                      value={test().name}
                      onInput={(event) => setDraft({ ...test(), name: event.currentTarget.value })}
                      onBlur={() => draft() && queueSave({ ...draft()!, updatedAt: Date.now() })}
                    />
                  </label>
                  <AppMapTestInspector
                    map={appMap()!}
                    item={selectedItem()}
                    diagnostics={diagnostics()}
                    blockers={blockers().length}
                    onDraftChange={updateDraftStep}
                    onCommit={commitStep}
                  />
                </div>
              )}
            </Show>
          </div>
          <Show when={draft()}>
            {(test) => (
              <div
                class={cn(
                  "min-h-0 border-l border-border-weak-base max-[1180px]:col-span-2 max-[1180px]:border-l-0 max-[760px]:h-full",
                  mobile() && !["device", "results"].includes(mobilePane()) && "hidden",
                )}
                inert={mobile() && !["device", "results"].includes(mobilePane())}
              >
                <AppMapTestDeviceEvidence
                  test={test()}
                  selectedStepId={selectedStepId()}
                  compiledPlan={compiledPlan()}
                  onOpenRun={props.onOpenRun}
                  onSelectStep={setSelectedStepId}
                  selectedTab={mobilePane() === "results" ? "evidence" : "device"}
                  onTabChange={(tab) =>
                    mobile() && setMobilePane(tab === "evidence" ? "results" : "device")
                  }
                  hideTabs={mobile()}
                />
              </div>
            )}
          </Show>
        </div>
      </div>
      <Show when={proposalReviewOpen() && draft() && pendingTestProposals().length > 0}>
        <AppMapTestProposalReview
          test={draft()!}
          proposals={pendingTestProposals()}
          busyId={proposalBusyId()}
          error={proposalError()}
          onApprove={(id) =>
            void decideProposal(id, "approve").then((ok) => ok && setProposalReviewOpen(false))
          }
          onReject={(id) =>
            void decideProposal(id, "reject").then((ok) => ok && setProposalReviewOpen(false))
          }
          onClose={() => setProposalReviewOpen(false)}
        />
      </Show>
    </section>
  );
}

function TestPicker(props: {
  tests: AppMapTest[];
  selectedTestId: string;
  disabled: boolean;
  creating: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <div class="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-b border-border-weak-base p-3">
      <label class="grid gap-1" for="app-map-test-picker">
        <span class={testEditorLabel}>Test</span>
        <select
          id="app-map-test-picker"
          class={testEditorInput}
          value={props.selectedTestId}
          disabled={props.disabled}
          onChange={(event) => props.onSelect(event.currentTarget.value)}
        >
          <For each={props.tests}>
            {(test) => (
              <option value={test.id}>
                {test.name} · {testKindDescription(test)}
              </option>
            )}
          </For>
        </select>
      </label>
      <div class="flex items-end gap-1">
        <Button
          variant="secondary"
          size="sm"
          class="mt-[19px] min-h-11"
          disabled={props.creating}
          onClick={props.onCreate}
        >
          <Icon name="plus" size={13} /> {props.creating ? "Creating…" : "New"}
        </Button>
        <Show when={props.selectedTestId}>
          <details class="relative">
            <summary
              class="grid min-h-11 min-w-11 cursor-pointer list-none place-items-center rounded-lg text-text-weak hover:bg-surface-base-hover focus-visible:outline-2 focus-visible:outline-border-strong-focus"
              aria-label="Test options"
            >
              <Icon name="more" size={14} />
            </summary>
            <div class="absolute top-[calc(100%+4px)] right-0 z-30 grid w-40 rounded-lg border border-border-strong-base bg-background-base p-1 shadow-[var(--shadow-lg)]">
              <button
                type="button"
                disabled={props.disabled}
                class="min-h-11 rounded-md px-3 text-left text-[12px] hover:bg-surface-base-hover disabled:opacity-40"
                onClick={(event) => {
                  event.currentTarget.closest("details")?.removeAttribute("open");
                  props.onDuplicate();
                }}
              >
                Duplicate Test
              </button>
              <button
                type="button"
                disabled={props.disabled}
                class="min-h-11 rounded-md px-3 text-left text-[12px] text-text-critical-base hover:bg-surface-base-hover disabled:opacity-40"
                onClick={(event) => {
                  event.currentTarget.closest("details")?.removeAttribute("open");
                  props.onDelete();
                }}
              >
                Delete Test…
              </button>
            </div>
          </details>
        </Show>
      </div>
    </div>
  );
}

function FirstTestEmpty(props: { creating: boolean; onCreate: () => void }) {
  return (
    <div class="grid flex-1 place-items-center p-6 text-center">
      <div class="max-w-[32ch]">
        <h2 class="m-0 text-[17px] font-semibold">Create the first test</h2>
        <p class="mt-2 text-[12px]/[1.5] text-text-weak">
          Start with readable intent, then bind each step to reviewed map truth.
        </p>
        <Button class="mt-4" disabled={props.creating} onClick={props.onCreate}>
          Create scenario test
        </Button>
      </div>
    </div>
  );
}

function LegacyTest(props: { test: AppMapTest; onCreate: () => void; onConvert: () => void }) {
  return (
    <div class="grid flex-1 place-items-center p-6 text-center">
      <div class="max-w-[38ch]">
        <span class="mx-auto grid size-10 place-items-center rounded-xl bg-surface-base text-text-weak">
          <Icon name="folder" size={17} />
        </span>
        <h2 class="mt-3 text-[17px] font-semibold">{props.test.name}</h2>
        <p class="mt-1 text-[12px]/[1.55] text-text-weak">
          This {props.test.kind === "path" ? "recorded path" : "screen tour"} keeps its existing
          behavior and stays read-only. Create a scenario to edit intent step by step.
        </p>
        <Show
          when={props.test.kind === "path" && props.test.flowId}
          fallback={
            <>
              <p class="mt-3 text-[11px]/[1.5] text-text-weaker">
                Screen tours remain read-only because their dynamic traversal has no equivalent
                scenario binding yet.
              </p>
              <Button class="mt-4" onClick={props.onCreate}>
                Create separate scenario
              </Button>
            </>
          }
        >
          <Button class="mt-4" onClick={props.onConvert}>
            Convert to editable scenario
          </Button>
        </Show>
      </div>
    </div>
  );
}

function renewScenarioStepIds(steps: readonly AppMapScenarioTestStep[]): AppMapScenarioTestStep[] {
  return steps.map((step) => {
    const copy = { ...structuredClone(step), id: crypto.randomUUID() };
    if (copy.kind === "decision") {
      copy.thenSteps = renewScenarioStepIds(copy.thenSteps);
      if (copy.elseSteps) copy.elseSteps = renewScenarioStepIds(copy.elseSteps);
    }
    if (copy.kind === "loop") copy.steps = renewScenarioStepIds(copy.steps);
    return copy;
  });
}

function MobilePaneNav(props: { value: MobilePane; onChange: (pane: MobilePane) => void }) {
  const panes = [
    ["steps", "Steps"],
    ["edit", "Edit"],
    ["device", "Device"],
    ["results", "Results"],
  ] as const;
  return (
    <nav
      class="hidden min-h-12 shrink-0 grid-cols-4 border-b border-border-weak-base bg-background-base p-1 max-[760px]:grid"
      aria-label="Test workspace"
    >
      <For each={panes}>
        {([pane, label]) => (
          <button
            type="button"
            data-test-mobile-tab={pane}
            class={cn(
              "min-h-11 rounded-lg px-2 text-[11px] font-semibold focus-visible:outline-2 focus-visible:outline-border-strong-focus",
              props.value === pane
                ? "bg-surface-base-active text-text-strong"
                : "text-text-weak hover:bg-surface-base-hover",
            )}
            aria-current={props.value === pane ? "page" : undefined}
            onClick={() => props.onChange(pane)}
          >
            {label}
          </button>
        )}
      </For>
    </nav>
  );
}
