import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import type { AppMapScenarioTest, AppMapScenarioTestStep, AppMapTest } from "@relay/protocol";
import { Button } from "@relay/ui/button";
import { useServer } from "../context/server";
import { cn } from "../lib/cn";
import {
  SCENARIO_STEP_KINDS,
  SCENARIO_STEP_LABELS,
  createScenarioStep,
  createScenarioTest,
  duplicateScenarioStep,
  moveScenarioStep,
  scenarioDiagnostics,
  scenarioStepSummary,
  testKindDescription,
  type ScenarioStepKind,
} from "../lib/app-map-test-editor-model";
import { Icon } from "./icon";
import {
  AppMapTestBindingEditor,
  testEditorInput as inputClass,
  testEditorLabel as labelClass,
} from "./app-map-test-binding-editor";

const iconButton =
  "grid min-h-11 min-w-11 place-items-center rounded-lg text-text-weak transition-[background-color,color,transform] hover:bg-surface-base-hover hover:text-text-strong active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-border-strong-focus disabled:cursor-not-allowed disabled:text-text-weaker";

type SaveState = "saved" | "saving" | "error";

export function AppMapTestWorkspace(props: {
  testId?: string;
  onTestChange?: (testId: string) => void;
  onOpenMap: () => void;
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
  const [creating, setCreating] = createSignal(false);
  const [compiling, setCompiling] = createSignal(false);
  const [compileMessage, setCompileMessage] = createSignal("");
  const [addKind, setAddKind] = createSignal<ScenarioStepKind>("instruction");
  let loadedKey = "";
  let optimisticRevision = 0;
  let saveQueue = Promise.resolve();
  let pendingSaves = 0;
  let failedDraft: AppMapScenarioTest | undefined;

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
      setSelectedStepId();
      loadedKey = "";
      return;
    }
    const key = `${map.id}:${test.id}:${map.revision}`;
    if (key === loadedKey || saveState() !== "saved") return;
    loadedKey = key;
    optimisticRevision = map.revision;
    if (test.kind === "scenario") {
      const copy = structuredClone(test);
      setDraft(copy);
      setSelectedStepId((id) =>
        id && copy.steps.some((step) => step.id === id) ? id : copy.steps[0]?.id,
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
  const selectedStep = createMemo(() =>
    draft()?.steps.find((step) => step.id === selectedStepId()),
  );

  function queueSave(next: AppMapScenarioTest): void {
    const map = appMap();
    if (!map) return;
    const snapshot = structuredClone(next);
    setDraft(snapshot);
    setCompileMessage("");
    failedDraft = undefined;
    setSaveError("");
    setSaveState("saving");
    pendingSaves += 1;
    saveQueue = saveQueue.then(async () => {
      try {
        // saveTest is the canonical App Map mutation boundary. Its remote type
        // is widened alongside the scenario protocol in Plan 062.
        const result = await server.saveTest({
          appMapId: map.id,
          expectedRevision: optimisticRevision,
          test: snapshot,
        });
        optimisticRevision = result.appMap.revision;
        await server.refreshAppMaps();
      } catch (error) {
        failedDraft = snapshot;
        setSaveError(error instanceof Error ? error.message : String(error));
        setSaveState("error");
      } finally {
        pendingSaves -= 1;
        if (pendingSaves === 0 && !failedDraft) setSaveState("saved");
      }
    });
  }

  function updateStep(
    stepId: string,
    update: (step: AppMapScenarioTestStep) => AppMapScenarioTestStep,
  ) {
    const test = draft();
    if (!test) return;
    queueSave({
      ...test,
      steps: test.steps.map((step) => (step.id === stepId ? update(structuredClone(step)) : step)),
      updatedAt: Date.now(),
    });
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
      setSaveError(error instanceof Error ? error.message : String(error));
      setSaveState("error");
    } finally {
      setCreating(false);
    }
  }

  function addStep(): void {
    const test = draft();
    if (!test) return;
    const step = createScenarioStep(addKind());
    queueSave({ ...test, steps: [...test.steps, step], updatedAt: Date.now() });
    setSelectedStepId(step.id);
    queueMicrotask(() => document.getElementById(`test-step-intent-${step.id}`)?.focus());
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

      <div class="grid min-h-0 grid-cols-[minmax(280px,0.9fr)_minmax(340px,1.1fr)] max-[760px]:grid-cols-1 max-[760px]:grid-rows-[minmax(280px,48%)_minmax(0,1fr)]">
        <div class="flex min-h-0 flex-col border-r border-border-weak-base bg-background-base max-[760px]:border-r-0 max-[760px]:border-b">
          <div class="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-b border-border-weak-base p-3">
            <label class="grid gap-1" for="app-map-test-picker">
              <span class={labelClass}>Test</span>
              <select
                id="app-map-test-picker"
                class={inputClass}
                value={selectedTestId()}
                disabled={saveState() !== "saved"}
                onChange={(event) => selectTest(event.currentTarget.value)}
              >
                <For each={tests()}>
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
              disabled={creating()}
              onClick={() => void createTest()}
            >
              <Icon name="plus" size={13} /> {creating() ? "Creating…" : "New"}
            </Button>
          </div>

          <Show
            when={selectedTest()}
            fallback={
              <div class="grid flex-1 place-items-center p-6 text-center">
                <div class="max-w-[32ch]">
                  <h2 class="m-0 text-[17px] font-semibold">Create the first test</h2>
                  <p class="mt-2 text-[12px]/[1.5] text-text-weak">
                    Start with readable intent, then bind each step to reviewed map truth.
                  </p>
                  <Button class="mt-4" disabled={creating()} onClick={() => void createTest()}>
                    Create scenario test
                  </Button>
                </div>
              </div>
            }
          >
            {(test) => (
              <Show
                when={test().kind === "scenario" && draft()}
                fallback={<LegacyTest test={test()} onCreate={() => void createTest()} />}
              >
                <div class="min-h-0 flex-1 overflow-y-auto p-3">
                  <ol class="m-0 grid list-none gap-2 p-0" aria-label="Test steps">
                    <For each={draft()!.steps}>
                      {(step, index) => {
                        const issue = () => diagnostics().find((item) => item.stepId === step.id);
                        const selected = () => selectedStepId() === step.id;
                        return (
                          <li
                            class={cn(
                              "rounded-[11px] border bg-surface-base transition-[border-color,background-color]",
                              selected()
                                ? "border-border-interactive-base bg-[var(--product-accent-soft)]"
                                : "border-border-weak-base",
                            )}
                          >
                            <button
                              type="button"
                              class="grid min-h-11 w-full grid-cols-[28px_minmax(0,1fr)] items-center gap-2 rounded-[10px] px-2.5 py-2 text-left focus-visible:outline-2 focus-visible:outline-border-strong-focus"
                              aria-current={selected() ? "step" : undefined}
                              onClick={() => setSelectedStepId(step.id)}
                              onKeyDown={(event) => {
                                if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key))
                                  return;
                                event.preventDefault();
                                const direction = event.key === "ArrowUp" ? -1 : 1;
                                const test = draft();
                                if (test)
                                  queueSave({
                                    ...test,
                                    steps: moveScenarioStep(test.steps, step.id, direction),
                                    updatedAt: Date.now(),
                                  });
                              }}
                            >
                              <span class="grid size-7 place-items-center rounded-lg bg-background-base text-[11px] font-semibold tabular-nums text-text-interactive-base">
                                {index() + 1}
                              </span>
                              <span class="min-w-0">
                                <span class="flex items-center gap-2 text-[11px] font-semibold">
                                  {SCENARIO_STEP_LABELS[step.kind]}
                                  <Show when={issue()}>
                                    <Icon
                                      name={issue()!.tone === "blocker" ? "alert" : "info"}
                                      size={11}
                                      class={
                                        issue()!.tone === "blocker"
                                          ? "text-icon-critical-base"
                                          : "text-icon-warning-base"
                                      }
                                    />
                                  </Show>
                                </span>
                                <span class="mt-0.5 block truncate text-[11px] text-text-weak">
                                  {scenarioStepSummary(appMap()!, step)}
                                </span>
                              </span>
                            </button>
                            <div class="flex justify-end border-t border-border-weak-base px-1">
                              <button
                                class={iconButton}
                                aria-label={`Move step ${index() + 1} up`}
                                disabled={index() === 0}
                                onClick={() => {
                                  const test = draft();
                                  if (test)
                                    queueSave({
                                      ...test,
                                      steps: moveScenarioStep(test.steps, step.id, -1),
                                      updatedAt: Date.now(),
                                    });
                                }}
                              >
                                <Icon name="chevron-up" size={13} />
                              </button>
                              <button
                                class={iconButton}
                                aria-label={`Move step ${index() + 1} down`}
                                disabled={index() === draft()!.steps.length - 1}
                                onClick={() => {
                                  const test = draft();
                                  if (test)
                                    queueSave({
                                      ...test,
                                      steps: moveScenarioStep(test.steps, step.id, 1),
                                      updatedAt: Date.now(),
                                    });
                                }}
                              >
                                <Icon name="chevron-down" size={13} />
                              </button>
                              <button
                                class={iconButton}
                                aria-label={`Duplicate step ${index() + 1}`}
                                onClick={() => {
                                  const test = draft();
                                  if (test)
                                    queueSave({
                                      ...test,
                                      steps: duplicateScenarioStep(test.steps, step.id),
                                      updatedAt: Date.now(),
                                    });
                                }}
                              >
                                <Icon name="copy" size={13} />
                              </button>
                              <button
                                class={cn(iconButton, "hover:text-icon-critical-base")}
                                aria-label={`Delete step ${index() + 1}`}
                                onClick={() => {
                                  const test = draft();
                                  if (!test) return;
                                  const next = test.steps.filter((item) => item.id !== step.id);
                                  queueSave({ ...test, steps: next, updatedAt: Date.now() });
                                  setSelectedStepId(next[Math.min(index(), next.length - 1)]?.id);
                                }}
                              >
                                <Icon name="trash" size={13} />
                              </button>
                            </div>
                          </li>
                        );
                      }}
                    </For>
                  </ol>
                  <Show when={!draft()!.steps.length}>
                    <div class="px-4 py-8 text-center">
                      <h2 class="m-0 text-[16px] font-semibold">Add the first intent</h2>
                      <p class="mt-1 text-[12px] text-text-weak">
                        Every new step starts unresolved, so nothing vague can run.
                      </p>
                    </div>
                  </Show>
                </div>
                <form
                  class="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-t border-border-weak-base p-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    addStep();
                  }}
                >
                  <label class="grid gap-1" for="scenario-step-kind">
                    <span class={labelClass}>Next step</span>
                    <select
                      id="scenario-step-kind"
                      class={inputClass}
                      value={addKind()}
                      onChange={(event) =>
                        setAddKind(event.currentTarget.value as ScenarioStepKind)
                      }
                    >
                      <For each={SCENARIO_STEP_KINDS}>
                        {(kind) => <option value={kind}>{SCENARIO_STEP_LABELS[kind]}</option>}
                      </For>
                    </select>
                  </label>
                  <Button type="submit" class="mt-[19px] min-h-11">
                    <Icon name="plus" size={13} /> Add step
                  </Button>
                </form>
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
              <Button
                variant="secondary"
                size="sm"
                onClick={() => failedDraft && queueSave(failedDraft)}
              >
                Retry save
              </Button>
            </div>
          </Show>
          <Show when={draft()}>
            {(test) => (
              <div class="grid gap-5 p-4">
                <label class="grid gap-1.5" for="scenario-test-name">
                  <span class={labelClass}>Test name</span>
                  <input
                    id="scenario-test-name"
                    class={inputClass}
                    value={test().name}
                    onInput={(event) => setDraft({ ...test(), name: event.currentTarget.value })}
                    onBlur={() => draft() && queueSave({ ...draft()!, updatedAt: Date.now() })}
                  />
                </label>
                <Show
                  when={selectedStep()}
                  fallback={<InspectorEmpty blockers={blockers().length} />}
                >
                  {(step) => (
                    <div class="grid gap-5">
                      <header>
                        <p class="m-0 text-[10px] font-semibold tracking-[0.08em] text-text-weaker uppercase">
                          {SCENARIO_STEP_LABELS[step().kind]}
                        </p>
                        <h2 class="mt-1 text-[18px] font-semibold tracking-[-0.02em]">
                          Step {test().steps.findIndex((item) => item.id === step().id) + 1}
                        </h2>
                      </header>
                      <label class="grid gap-1.5" for={`test-step-intent-${step().id}`}>
                        <span class={labelClass}>Intent</span>
                        <textarea
                          id={`test-step-intent-${step().id}`}
                          class={cn(inputClass, "min-h-24 resize-y py-2.5")}
                          value={step().intent}
                          onInput={(event) => {
                            const value = event.currentTarget.value;
                            setDraft((current) =>
                              current
                                ? {
                                    ...current,
                                    steps: current.steps.map((item) =>
                                      item.id === step().id ? { ...item, intent: value } : item,
                                    ),
                                  }
                                : current,
                            );
                          }}
                          onBlur={() => {
                            const current = draft()?.steps.find((item) => item.id === step().id);
                            if (current) updateStep(step().id, () => current);
                          }}
                          onKeyDown={(event) => {
                            if ((event.metaKey || event.ctrlKey) && event.key === "Enter")
                              event.currentTarget.blur();
                          }}
                        />
                      </label>
                      <AppMapTestBindingEditor
                        map={appMap()!}
                        step={step()}
                        onChange={(next) => updateStep(step().id, () => next)}
                      />
                      <label class="grid gap-1.5" for={`test-step-note-${step().id}`}>
                        <span class={labelClass}>
                          Note <span class="font-normal text-text-weaker">· optional</span>
                        </span>
                        <textarea
                          id={`test-step-note-${step().id}`}
                          class={cn(inputClass, "min-h-20 resize-y py-2.5")}
                          value={step().note ?? ""}
                          onInput={(event) => {
                            const value = event.currentTarget.value;
                            setDraft((current) =>
                              current
                                ? {
                                    ...current,
                                    steps: current.steps.map((item) =>
                                      item.id === step().id
                                        ? { ...item, note: value || undefined }
                                        : item,
                                    ),
                                  }
                                : current,
                            );
                          }}
                          onBlur={() => {
                            const current = draft()?.steps.find((item) => item.id === step().id);
                            if (current) updateStep(step().id, () => current);
                          }}
                        />
                      </label>
                      <Show when={diagnostics().filter((item) => item.stepId === step().id).length}>
                        <div
                          class="grid gap-1 rounded-lg border border-border-weak-base bg-background-base p-3"
                          aria-live="polite"
                        >
                          <For each={diagnostics().filter((item) => item.stepId === step().id)}>
                            {(item) => (
                              <p
                                class={cn(
                                  "m-0 flex items-start gap-2 text-[11px]",
                                  item.tone === "blocker"
                                    ? "text-text-critical-base"
                                    : "text-text-weak",
                                )}
                              >
                                <Icon
                                  name={item.tone === "blocker" ? "alert" : "info"}
                                  size={12}
                                  class="mt-0.5 shrink-0"
                                />{" "}
                                {item.message}
                              </p>
                            )}
                          </For>
                        </div>
                      </Show>
                    </div>
                  )}
                </Show>
              </div>
            )}
          </Show>
        </div>
      </div>
    </section>
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

function InspectorEmpty(props: { blockers: number }) {
  return (
    <div class="rounded-xl border border-dashed border-border-weak-base bg-background-base p-5">
      <h2 class="m-0 text-[15px] font-semibold">Select a step</h2>
      <p class="mt-1 text-[12px]/[1.5] text-text-weak">
        Choose a row to edit its intent and binding.{" "}
        {props.blockers
          ? `${props.blockers} blockers remain before this test can compile.`
          : "This test is ready to compile."}
      </p>
    </div>
  );
}
