import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import type {
  AppMapCompiledTest,
  AppMapScenarioTest,
  AppMapScenarioTestStep,
  AppMapTest,
} from "@relay/protocol";
import { Button } from "@relay/ui/button";
import { useServer } from "../context/server";
import { planScenarioTestEdits } from "../lib/app-map-scenario-edit-plan";
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
import { AppMapTestDeviceEvidence } from "./app-map-test-device-evidence";
import { testEditorInput, testEditorLabel } from "./app-map-test-binding-editor";
import { Icon } from "./icon";

type SaveState = "saved" | "saving" | "error";

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
  const [creating, setCreating] = createSignal(false);
  const [compiling, setCompiling] = createSignal(false);
  const [compileMessage, setCompileMessage] = createSignal("");
  const [compiledPlan, setCompiledPlan] = createSignal<AppMapCompiledTest>();
  let loadedKey = "";
  let optimisticRevision = 0;
  let saveQueue = Promise.resolve();
  let pendingSaves = 0;
  let failedDraft: AppMapScenarioTest | undefined;
  let queuedDraft: AppMapScenarioTest | undefined;

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
      setSelectedStepId();
      loadedKey = "";
      return;
    }
    const key = `${map.id}:${test.id}:${map.revision}`;
    if (key === loadedKey || saveState() !== "saved") return;
    loadedKey = key;
    setCompiledPlan();
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

  function queueSave(next: AppMapScenarioTest): void {
    const map = appMap();
    if (!map) return;
    const snapshot = structuredClone(next);
    const previous = queuedDraft ?? draft();
    if (!previous) return;
    const edits = planScenarioTestEdits(previous, snapshot);
    queuedDraft = snapshot;
    setDraft(snapshot);
    setCompileMessage("");
    setCompiledPlan();
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
    const nextSelection = siblingFocusAfterDelete(test.steps, stepId);
    queueSave({
      ...test,
      steps: deleteScenarioStepTree(test.steps, stepId),
      updatedAt: Date.now(),
    });
    setSelectedStepId(nextSelection);
    focusStep(nextSelection);
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

  async function compileTest(): Promise<void> {
    const map = appMap();
    const test = draft();
    if (!map || !test || blockers().length || compiling()) return;
    setCompiling(true);
    setCompileMessage("");
    try {
      await saveQueue;
      const { plan } = await server.runAction("app-map.test.compile", {
        appMapId: map.id,
        testId: test.id,
      });
      setCompiledPlan(plan);
      const recipeCount = Object.keys(plan.recipes).length;
      const linkCount = plan.stepProvenance.length;
      setCompileMessage(
        `Compiled ${recipeCount} ${recipeCount === 1 ? "recipe" : "recipes"} with ${linkCount} provenance ${linkCount === 1 ? "link" : "links"}.`,
      );
    } catch (error) {
      setCompileMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setCompiling(false);
    }
  }

  return (
    <section class="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-[var(--map-canvas)] text-text-strong">
      <header class="flex min-h-14 items-center justify-between gap-3 border-b border-border-weak-base bg-surface-raised-stronger-non-alpha px-4">
        <div class="min-w-0">
          <p class="m-0 text-[10px] font-semibold tracking-[0.08em] text-text-weaker uppercase">
            Test editor
          </p>
          <p class="m-0 truncate text-[13px] font-semibold">{appMap()?.name ?? "App map"}</p>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-[11px] text-text-weak" role="status" aria-live="polite">
            {compileMessage() ||
              (saveState() === "saving"
                ? "Saving…"
                : saveState() === "error"
                  ? "Not saved"
                  : draft()
                    ? blockers().length
                      ? `${blockers().length} incomplete`
                      : "Ready to compile"
                    : "Saved")}
          </span>
          <Button variant="secondary" size="sm" onClick={props.onOpenMap}>
            <Icon name="map" size={13} /> Open map
          </Button>
          <Show when={draft()}>
            <Button
              size="sm"
              disabled={
                server.isOffline() ||
                saveState() !== "saved" ||
                blockers().length > 0 ||
                compiling()
              }
              title={blockers().length ? "Resolve every incomplete binding first" : undefined}
              onClick={() => void compileTest()}
            >
              <Icon name="play" size={13} /> {compiling() ? "Compiling…" : "Compile test"}
            </Button>
          </Show>
        </div>
      </header>

      <div class="grid min-h-0 grid-cols-[minmax(260px,0.8fr)_minmax(320px,1fr)_minmax(300px,0.9fr)] max-[1180px]:grid-cols-[minmax(280px,0.9fr)_minmax(340px,1.1fr)] max-[1180px]:grid-rows-[minmax(0,1fr)_minmax(280px,42%)] max-[760px]:grid-cols-1 max-[760px]:grid-rows-[minmax(300px,auto)_minmax(360px,auto)_minmax(300px,auto)] max-[760px]:overflow-y-auto">
        <div class="flex min-h-0 flex-col border-r border-border-weak-base bg-background-base max-[760px]:border-r-0 max-[760px]:border-b">
          <TestPicker
            tests={tests()}
            selectedTestId={selectedTestId()}
            disabled={saveState() !== "saved"}
            creating={creating()}
            onSelect={selectTest}
            onCreate={() => void createTest()}
          />
          <Show
            when={selectedTest()}
            fallback={<FirstTestEmpty creating={creating()} onCreate={() => void createTest()} />}
          >
            {(test) => (
              <Show
                when={test().kind === "scenario" && draft()}
                fallback={<LegacyTest test={test()} onCreate={() => void createTest()} />}
              >
                <AppMapTestOutline
                  map={appMap()!}
                  test={draft()!}
                  selectedStepId={selectedStepId()}
                  diagnostics={diagnostics()}
                  onSelect={setSelectedStepId}
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

        <div class="min-h-0 overflow-y-auto bg-surface-raised-stronger-non-alpha">
          <Show when={saveState() === "error"}>
            <div
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
            <div class="min-h-0 border-l border-border-weak-base max-[1180px]:col-span-2 max-[1180px]:border-l-0 max-[760px]:col-span-1">
              <AppMapTestDeviceEvidence
                test={test()}
                selectedStepId={selectedStepId()}
                compiledPlan={compiledPlan()}
                onOpenRun={props.onOpenRun}
              />
            </div>
          )}
        </Show>
      </div>
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
      <Button
        variant="secondary"
        size="sm"
        class="mt-[19px] min-h-11"
        disabled={props.creating}
        onClick={props.onCreate}
      >
        <Icon name="plus" size={13} /> {props.creating ? "Creating…" : "New"}
      </Button>
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

function LegacyTest(props: { test: AppMapTest; onCreate: () => void }) {
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
        <Button class="mt-4" onClick={props.onCreate}>
          Create editable scenario
        </Button>
      </div>
    </div>
  );
}
