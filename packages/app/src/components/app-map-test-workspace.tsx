import { Show, createEffect, createMemo, createSignal, on } from "solid-js";
import type { Proposal } from "@relay/protocol";
import { Button } from "@relay/ui/button";
import { useServer } from "../context/server";
import { useAppMapProposalReview } from "../lib/use-app-map-proposal-review";
import { useElementWidth } from "../lib/use-element-width";
import { scenarioDiagnostics, scenarioStepCount } from "../lib/app-map-test-editor-model";
import {
  testLayoutMode,
  testRailOpensByDefault,
  testRailOverlayWidth,
  testRailPresentation,
  testWorkspaceColumns,
  type TestRailKind,
} from "../lib/app-map-test-layout";
import { flattenScenarioSteps } from "../lib/app-map-test-editor-tree";
import { createAppMapTestStepActions } from "../lib/use-app-map-test-step-actions";
import { EmptyState } from "./empty-state";
import { AppMapTestInspector } from "./app-map-test-inspector";
import { AppMapTestOutline } from "./app-map-test-outline";
import { AppMapTestUndo } from "./app-map-test-undo";
import { AppMapTestDeviceEvidence } from "./app-map-test-device-evidence";
import { AppMapTestRunControl } from "./app-map-test-run-control";
import { createAppMapTestRun } from "../lib/use-app-map-test-run";
import { Icon } from "./icon";
import { AppMapTestProposalReview } from "./app-map-test-proposal-review";
import { createAppMapTestDocumentSession } from "./app-map-test-document-session";
import {
  RailStrip,
  StepsRailEmpty,
  TestSwitcher,
  TestWorkspaceBar,
} from "./app-map-test-workspace-chrome";

export function AppMapTestWorkspace(props: {
  testId?: string;
  onTestChange?: (testId: string) => void;
  onOpenRun?: (runId: string) => void;
}) {
  const server = useServer();
  const [proposalReviewOpen, setProposalReviewOpen] = createSignal(false);
  /** `undefined` means "follow the layout default for this width". */
  const [railOverride, setRailOverride] = createSignal<Partial<Record<TestRailKind, boolean>>>({});
  const workspace = useElementWidth();
  const mode = createMemo(() => testLayoutMode(workspace.width()));
  const railOpen = createMemo(() => ({
    steps: railOverride().steps ?? testRailOpensByDefault("steps", mode()),
    device: railOverride().device ?? testRailOpensByDefault("device", mode()),
  }));
  const railView = createMemo(() => ({
    steps: testRailPresentation("steps", mode(), railOpen().steps),
    device: testRailPresentation("device", mode(), railOpen().device),
  }));

  // The run session and the document session each need the other, and both only
  // call back once the component is running, so the reference is filled in below.
  let run: ReturnType<typeof createAppMapTestRun> | undefined;
  const testDocument = createAppMapTestDocumentSession({
    testId: () => props.testId,
    onTestChange: (testId) => props.onTestChange?.(testId),
    onCanonicalLoaded: () => run?.clearPlan(),
    onDraftQueued: () => run?.onDraftEdited(),
  });
  const {
    appMap,
    tests,
    selectedTestId,
    selectedTest,
    selectTest,
    draft,
    setDraft,
    selectedStepId,
    setSelectedStepId,
    saveState,
    saveError,
    retryAvailable,
    undoDelete,
    setUndoDelete,
    deletedTest,
    setDeletedTest,
    creating,
    queueSave,
    retrySave,
    dismissSaveError,
    createTest,
    duplicateTest,
    deleteTest,
    restoreDeletedTest,
    awaitPendingSaves,
  } = testDocument;
  const { proposalBusyId, proposalError, decideProposal } = useAppMapProposalReview(
    () => appMap() ?? undefined,
  );

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
  const selectedDevice = createMemo(() =>
    server.devices().find((device) => device.serial === server.selectedDevice()),
  );
  run = createAppMapTestRun({
    appMap,
    draft,
    selectedDevice,
    saveState,
    blockerCount: () => blockers().length,
    offline: () => server.isOffline(),
    jobs: () => server.jobs(),
    refreshJobs: () => server.refreshJobs(),
    cancelJob: (id) => server.cancelJob(id),
    compileAndRun: (input) => server.runAction("app-map.test.run", input),
    awaitPendingSaves,
  });
  const testRun = run;

  // A different Test, or a different map, is a different run history.
  createEffect(
    on(
      () => (appMap() && selectedTest() ? `${appMap()!.id}:${selectedTest()!.id}` : ""),
      () => testRun.reset(),
      { defer: true },
    ),
  );

  function toggleRail(rail: TestRailKind): void {
    setRailOverride((current) => ({ ...current, [rail]: !railOpen()[rail] }));
  }

  /** A rail that floats over the editor must not stay open behind the editor. */
  function closeOverlayRail(rail: TestRailKind): void {
    if (railView()[rail] === "overlay") {
      setRailOverride((current) => ({ ...current, [rail]: false }));
    }
  }

  /** `/` reaches the step search even when the Coverage rail is a strip. */
  function openSearch(): void {
    if (!railOpen().steps) setRailOverride((current) => ({ ...current, steps: true }));
    queueMicrotask(() => document.getElementById("test-step-search")?.focus());
  }

  /** Escape closes a floating rail and hands focus back to the toggle that opened it. */
  function dismissOverlayRail(): void {
    const rail = (["steps", "device"] as const).find((kind) => railView()[kind] === "overlay");
    if (!rail) return;
    setRailOverride((current) => ({ ...current, [rail]: false }));
    queueMicrotask(() =>
      document.querySelector<HTMLElement>(`[data-test-rail-toggle="${rail}"]`)?.focus(),
    );
  }

  const steps = createAppMapTestStepActions({
    draft,
    queueSave,
    setDraft,
    setSelectedStepId,
    undoDelete,
    setUndoDelete,
    onStepAdded: () => closeOverlayRail("steps"),
  });

  function resolveRunBlocker(): void {
    if (saveState() === "error") {
      if (retryAvailable()) void retrySave();
      else queueMicrotask(() => document.getElementById("test-save-error")?.focus());
      return;
    }
    const first = blockers().find((item) => item.stepId);
    if (first?.stepId) {
      setSelectedStepId(first.stepId);
      steps.focusStep(first.stepId, true);
      return;
    }
    if (blockers().length) {
      queueMicrotask(() => document.getElementById("app-map-test-switcher")?.focus());
      return;
    }
    if (!selectedDevice()) window.dispatchEvent(new CustomEvent("relay:open-device-picker"));
  }

  const runBlockerActionLabel = createMemo(() => {
    if (server.isOffline() || saveState() === "saving") return undefined;
    if (saveState() === "error") return retryAvailable() ? "Retry save" : "Review save error";
    if (blockers().length)
      return `Fix ${blockers().length} ${blockers().length === 1 ? "issue" : "issues"}`;
    if (!selectedDevice()) return "Choose target";
    return undefined;
  });

  /**
   * Both rails render identically whether they are docked in their grid track or
   * floated over the editor, so the body lives in one place.
   */
  function StepsRail() {
    return (
      <Show when={draft()} fallback={<StepsRailEmpty />}>
        {(test) => (
          <AppMapTestOutline
            map={appMap()!}
            test={test()}
            selectedStepId={selectedStepId()}
            diagnostics={diagnostics()}
            onSelect={setSelectedStepId}
            onOpen={(id) => {
              setSelectedStepId(id);
              closeOverlayRail("steps");
              steps.focusStep(id, true);
            }}
            onAddRoot={steps.addRootStep}
            onAddChild={steps.addChildStep}
            onMove={steps.moveStep}
            onReorder={steps.reorderStep}
            onDuplicate={steps.duplicateStep}
            onDelete={steps.deleteStep}
            onClose={() => toggleRail("steps")}
          />
        )}
      </Show>
    );
  }

  function DeviceRail() {
    return (
      <Show
        when={draft()}
        fallback={
          // Otherwise this column is a second unexplained void: the same grey as
          // the rail beside it, with nothing in it and no label saying what it
          // is waiting for.
          <div class="grid min-h-full place-items-center p-6 text-center">
            <p class="m-0 max-w-[28ch] text-caption/[1.5] text-text-weak">
              Screenshots from this Test’s last run appear here.
            </p>
          </div>
        }
      >
        {(test) => (
          <AppMapTestDeviceEvidence
            appMap={appMap() ?? undefined}
            test={test()}
            selectedStepId={selectedStepId()}
            compiledPlan={testRun.plan()}
            onOpenRun={props.onOpenRun}
            onSelectStep={setSelectedStepId}
            onClose={() => toggleRail("device")}
          />
        )}
      </Show>
    );
  }

  return (
    <section
      class="relative grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background-base text-text-strong"
      onKeyDown={(event) => {
        const target = event.target as HTMLElement;
        const typing =
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
        // Escape is the way out of a floating rail even from its own search field.
        if (event.key === "Escape") {
          dismissOverlayRail();
          return;
        }
        if (typing) return;
        if (undoDelete() && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
          event.preventDefault();
          steps.undoStepDelete();
          return;
        }
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        if (event.key === "[") {
          event.preventDefault();
          toggleRail("steps");
        } else if (event.key === "]") {
          event.preventDefault();
          toggleRail("device");
        } else if (event.key === "/") {
          event.preventDefault();
          openSearch();
        }
      }}
    >
      <TestWorkspaceBar
        status={
          saveState() === "saving"
            ? "Saving changes…"
            : saveState() === "error"
              ? "Changes not saved"
              : draft()
                ? blockers().length
                  ? `${blockers().length} ${blockers().length === 1 ? "issue" : "issues"} to fix`
                  : "Ready to run"
                : "Choose or create a Test"
        }
        statusTone={
          saveState() === "saving"
            ? "saving"
            : saveState() === "error" || blockers().length
              ? "attention"
              : draft()
                ? "ready"
                : "neutral"
        }
        stepCount={draft() ? scenarioStepCount(draft()!.steps) : undefined}
        railOpen={railOpen()}
        onToggleRail={toggleRail}
        switcher={
          <TestSwitcher
            tests={tests()}
            selectedTestId={selectedTestId()}
            name={draft()?.name ?? ""}
            busy={saveState() !== "saved"}
            creating={creating()}
            onSelect={selectTest}
            onRename={(name) => {
              const test = draft();
              if (!test || name === test.name) return;
              queueSave({ ...test, name, updatedAt: Date.now() });
            }}
            onCreate={() => void createTest()}
            onDuplicate={() => void duplicateTest()}
            onDelete={deleteTest}
          />
        }
      >
        <Show when={draft()}>
          <Show when={pendingTestProposals().length > 0}>
            <Button
              variant="secondary"
              size="sm"
              class="shrink-0"
              onClick={() => setProposalReviewOpen(true)}
            >
              <Icon name="sparkle" size={13} /> {pendingTestProposals().length} proposed
            </Button>
          </Show>
          <AppMapTestRunControl
            launchState={testRun.launchState()}
            job={testRun.job()}
            blockedReason={testRun.blockedReason()}
            error={testRun.error()}
            blockedActionLabel={runBlockerActionLabel()}
            onResolveBlocked={runBlockerActionLabel() ? resolveRunBlocker : undefined}
            freshEvidenceAvailable={testRun.freshEvidenceAvailable()}
            freshEvidence={testRun.freshEvidence()}
            onFreshEvidenceChange={testRun.setFreshEvidence}
            onRun={() => void testRun.run()}
            onCancel={() => void testRun.cancel()}
            onOpenResult={() => {
              const id = testRun.consumeResult();
              if (id) props.onOpenRun?.(id);
            }}
          />
        </Show>
      </TestWorkspaceBar>

      <div class="relative min-h-0">
        <div
          ref={workspace.ref}
          data-test-workspace-layout
          data-layout-mode={mode()}
          class="grid h-full min-h-0"
          style={{ "grid-template-columns": testWorkspaceColumns(mode(), railOpen()) }}
        >
          <Show
            when={railView().steps === "docked"}
            fallback={
              <RailStrip rail="steps" label="Coverage" onOpen={() => toggleRail("steps")} />
            }
          >
            <div class="flex min-h-0 flex-col border-r border-border-weak-base">
              <StepsRail />
            </div>
          </Show>

          <div class="min-h-0 overflow-y-auto bg-surface-raised-stronger-non-alpha">
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
                  onUndo={steps.undoStepDelete}
                  onDismiss={() => setUndoDelete()}
                />
              )}
            </Show>
            <Show when={saveState() === "error"}>
              <div
                id="test-save-error"
                tabindex={-1}
                // Focused to announce, not to be tabbed to, so it keeps its own
                // critical border rather than stacking a blue user-agent ring on
                // top of a red alert.
                class="m-3 flex items-start justify-between gap-3 rounded-md border border-border-critical-base bg-surface-critical-weak p-2.5 text-caption/[1.45] text-text-critical-base focus:outline-none"
                role="alert"
              >
                <span>
                  <strong>Changes are still local.</strong> {saveError()}
                </span>
                <Show
                  when={retryAvailable()}
                  fallback={
                    <Button variant="secondary" size="sm" onClick={dismissSaveError}>
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
            <Show
              when={draft()}
              fallback={
                // Without this the document pane is a blank white column between
                // two rails — the surface that should say what the mode is for
                // was the one surface saying nothing. It names what lands here
                // and offers the same first step the rail does.
                <div class="grid min-h-full place-items-center px-5 py-10">
                  <EmptyState
                    size="lg"
                    icon="edit"
                    title={tests().length ? "No Test open" : "No Tests yet"}
                    description={
                      tests().length
                        ? "Pick one from the switcher to read its steps here, or start a new Test."
                        : "A Test is what you run once — a path through this map, written as readable intent and bound to reviewed screens."
                    }
                    actionLabel={creating() ? "Creating…" : "Create Test"}
                    onAction={() => void createTest()}
                  />
                </div>
              }
            >
              <div class="mx-auto grid w-full max-w-[640px] gap-4 px-5 py-4">
                <AppMapTestInspector
                  map={appMap()!}
                  item={selectedItem()}
                  diagnostics={diagnostics()}
                  blockers={blockers().length}
                  onDraftChange={steps.updateDraftStep}
                  onCommit={steps.commitStep}
                />
              </div>
            </Show>
          </div>

          <Show
            when={railView().device === "docked"}
            fallback={
              <RailStrip rail="device" label="Device" onOpen={() => toggleRail("device")} />
            }
          >
            <div class="min-h-0 border-l border-border-weak-base">
              <DeviceRail />
            </div>
          </Show>
        </div>
        <Show when={railView().steps === "overlay"}>
          <div
            class="absolute inset-y-0 left-0 z-20 flex min-h-0 flex-col border-r border-border-weak-base bg-background-base shadow-[8px_0_24px_-16px_rgb(0_0_0/40%)]"
            style={{ width: testRailOverlayWidth("steps", workspace.width()) }}
          >
            <StepsRail />
          </div>
        </Show>
        <Show when={railView().device === "overlay"}>
          <div
            class="absolute inset-y-0 right-0 z-20 min-h-0 border-l border-border-weak-base bg-background-base shadow-[-8px_0_24px_-16px_rgb(0_0_0/40%)]"
            style={{ width: testRailOverlayWidth("device", workspace.width()) }}
          >
            <DeviceRail />
          </div>
        </Show>
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
