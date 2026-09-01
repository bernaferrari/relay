import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { AppMapVariable, CaseExpansionStrategy } from "@relay/protocol";
import {
  createRelayWorkflows,
  type DurableRepeatTestDecision,
  type RepeatTestDecision,
  type RepeatTestSnapshot,
} from "@relay/workflows";
import { Button } from "@relay/ui/button";
import { useServer } from "../context/server";
import { toast } from "../context/toast";
import { cn } from "../lib/cn";
import { humanError } from "../lib/human-error";
import { combineValueLabel } from "../lib/app-map-combine-presentation";
import {
  readStoredRepeat,
  removeStoredRepeat,
  repeatStorageKeys,
  writeStoredRepeat,
} from "../lib/app-map-test-repeat-storage";
import { type AppMapTestCombineStripProps } from "../lib/app-map-test-repeat-presentation";
import { AppMapTestVariableEmptyState } from "./app-map-test-variable-empty-state";
import { AppMapTestRepeatStatus } from "./app-map-test-repeat-status";
import { AppMapTestCombineControls, repeatDurationLabel } from "./app-map-test-combine-controls";
import {
  applyableVariables,
  projectTestCombineStrip,
  testCombineSentence,
  testCombineStripRunInput,
  testWholePageAvailability,
  type TestCombineLens,
} from "../lib/app-map-test-combine-strip";
import { repeatNeedsWatch, watchActiveRepeat } from "../lib/app-map-test-repeat-watch";
import {
  testEditorHint,
  testEditorSection,
  testQuietRow,
  testSelectedRow,
} from "../lib/app-map-test-editor-styles";
export function AppMapTestCombineStrip(props: AppMapTestCombineStripProps) {
  const server = useServer();
  const candidates = createMemo(() => applyableVariables(Object.values(props.map.variables ?? {})));
  const [selectedVariableIds, setSelectedVariableIds] = createSignal<string[]>([]);
  const [selectedValues, setSelectedValues] = createSignal<Record<string, string[]>>({});
  const [strategy, setStrategy] = createSignal<CaseExpansionStrategy>("zip");
  const [pilotMode, setPilotMode] = createSignal<"representative" | "first">("representative");
  const [lens, setLens] = createSignal<TestCombineLens>("visual");
  const [wholePage, setWholePage] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [restoring, setRestoring] = createSignal(false);
  const [repeat, setRepeat] = createSignal<RepeatTestSnapshot>();
  const [reviewed, setReviewed] = createSignal(false);
  const workflows = createRelayWorkflows({
    invoke: (operationId, input) => server.runAction(operationId, input),
  });
  const repeatLocked = () => Boolean(repeat()) || restoring();
  const storageKeys = () => repeatStorageKeys(props.map.id, props.test.id);
  let restoreVersion = 0;
  function rememberRepeat(snapshot: RepeatTestSnapshot): void {
    if (!snapshot.workflow) return;
    const resolved = snapshot.frozen?.resolved;
    if (resolved) {
      setSelectedVariableIds(resolved.dimensions.map((dimension) => dimension.id));
      setSelectedValues(
        Object.fromEntries(
          resolved.dimensions.map((dimension) => [dimension.id, [...dimension.valueIds]]),
        ),
      );
      setStrategy(resolved.strategy);
      if (resolved.pilot.mode === "first" || resolved.pilot.mode === "representative") {
        setPilotMode(resolved.pilot.mode);
      }
    }
    if (snapshot.frozen) setLens(snapshot.frozen.evidence);
    setWholePage(Boolean(snapshot.frozen?.capture?.fullSurfaceScreenIds.length));
    setRepeat(snapshot);
    try {
      writeStoredRepeat(window.localStorage, storageKeys(), snapshot.workflow);
    } catch {
      // Canonical recovery remains available when browser storage is unavailable.
    }
  }

  function applyRecoverySnapshot(snapshot: RepeatTestSnapshot): void {
    if (snapshot.workflow && snapshot.frozen) rememberRepeat(snapshot);
    else setRepeat(snapshot.phase === "needs-attention" ? snapshot : undefined);
  }
  async function recoverRepeat(version?: number): Promise<RepeatTestSnapshot | undefined> {
    const snapshot = await workflows.recover({
      kind: "repeat-test",
      appMapId: props.map.id,
      testId: props.test.id,
    });
    if (version !== undefined && version !== restoreVersion) return undefined;
    applyRecoverySnapshot(snapshot);
    return snapshot;
  }
  createEffect(() => {
    const keys = storageKeys();
    const version = ++restoreVersion;
    setRepeat();
    setReviewed(false);
    let stored: ReturnType<typeof readStoredRepeat> = {};
    try {
      stored = readStoredRepeat(window.localStorage, keys);
    } catch {
      stored = {};
    }
    setRestoring(true);
    void (
      stored.handle
        ? workflows.inspectRepeat(stored.handle.workflowId)
        : stored.legacyRef
          ? workflows.inspect(stored.legacyRef)
          : recoverRepeat(version)
    )
      .then((snapshot) => {
        if (version !== restoreVersion) return;
        if (
          snapshot?.kind === "repeat-test" &&
          (snapshot.workflow || snapshot.ref) &&
          snapshot.frozen &&
          snapshot.frozen.appMapId === props.map.id &&
          snapshot.frozen.testId === props.test.id
        ) {
          rememberRepeat(snapshot);
          return;
        }
        if (stored.handle || stored.legacyRef) {
          try {
            removeStoredRepeat(window.localStorage, keys);
          } catch {
            // Canonical lookup below remains authoritative.
          }
          return recoverRepeat(version);
        }
      })
      .catch((error) => {
        if (version === restoreVersion) {
          toast(humanError(error, "Could not restore the active Repeat"), "error");
        }
      })
      .finally(() => {
        if (version === restoreVersion) setRestoring(false);
      });
  });
  onCleanup(() => {
    restoreVersion += 1;
  });
  createEffect(() => {
    const available = candidates();
    const selected = selectedVariableIds();
    const stillAvailable = selected.filter((id) => available.some((item) => item.id === id));
    if (stillAvailable.length) {
      if (stillAvailable.length !== selected.length) setSelectedVariableIds(stillAvailable);
      return;
    }
    const first = available[0];
    if (!first) return;
    setSelectedVariableIds(first ? [first.id] : []);
    setSelectedValues(
      first ? { [first.id]: [first.options[0]?.id].filter((id): id is string => Boolean(id)) } : {},
    );
  });
  const selectedVariables = createMemo(() => {
    const chosen = new Set(selectedVariableIds());
    return candidates().filter((candidate) => chosen.has(candidate.id));
  });
  const valuesFor = (variable: AppMapVariable) => {
    const selected = selectedValues()[variable.id];
    return selected !== undefined ? selected : variable.options.map((option) => option.id);
  };
  const valueLabel = (dimensionId: string, valueId: string) => {
    const variable = candidates().find((candidate) => candidate.id === dimensionId);
    const option = variable?.options.find((candidate) => candidate.id === valueId);
    return option ? combineValueLabel(option) : valueId;
  };
  const variableLabel = (dimensionId: string) =>
    candidates().find((candidate) => candidate.id === dimensionId)?.name ?? dimensionId;
  const selected = createMemo(() =>
    Object.fromEntries(selectedVariables().map((variable) => [variable.id, valuesFor(variable)])),
  );
  const projection = createMemo(() =>
    projectTestCombineStrip({
      test: props.test,
      variables: selectedVariables(),
      selected: selected(),
      strategy: strategy(),
    }),
  );
  const sentence = createMemo(() =>
    testCombineSentence({
      testName: props.test.name,
      variableNames: selectedVariables().map((variable) => variable.name),
      worlds: projection().worlds,
      lens: lens(),
    }),
  );
  const selectedDevice = createMemo(() =>
    server.devices().find((device) => device.serial === server.selectedDevice()),
  );
  const wholePageAvailability = createMemo(() => testWholePageAvailability(props.map, props.test));
  const destinationScreenId = createMemo(() => wholePageAvailability().destinationScreenId);
  createEffect(() => {
    if (!wholePageAvailability().ready && wholePage()) setWholePage(false);
  });
  createEffect(() => {
    const current = repeat();
    if (!repeatNeedsWatch(current)) return;
    onCleanup(
      watchActiveRepeat({
        workflowId: current.workflow?.workflowId,
        currentVersion: () => repeat()?.workflow?.expectedVersion ?? 0,
        sseConnected: server.sseConnected,
        subscribe: server.watchWorkflow,
        refresh: () => void inspectRepeat(),
      }),
    );
  });

  function combineRunInput(input: { cell?: string; executionMode?: "pilot" | "all" }) {
    if (wholePage() && !destinationScreenId()) {
      toast("This Test has no destination screen to capture as a whole page.", "warning");
      return undefined;
    }
    if (wholePage() && !wholePageAvailability().ready) {
      toast("This destination has no frozen full-page capture to recapture.", "warning");
      return undefined;
    }
    return testCombineStripRunInput({
      selected: selected(),
      lens: lens(),
      wholePage: wholePage(),
      destinationScreenId: destinationScreenId(),
      ...input,
    });
  }

  function toggleVariable(id: string): void {
    const variable = candidates().find((item) => item.id === id);
    if (!variable) return;
    setSelectedVariableIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
    setSelectedValues((current) => ({
      ...current,
      [id]:
        current[id] ?? [variable.options[0]?.id].filter((value): value is string => Boolean(value)),
    }));
  }

  function toggleValue(variableId: string, id: string): void {
    setSelectedValues((current) => {
      const values = current[variableId] ?? [];
      return {
        ...current,
        [variableId]: values.includes(id) ? values.filter((item) => item !== id) : [...values, id],
      };
    });
  }

  function selectAll(variableId: string): void {
    const variable = candidates().find((item) => item.id === variableId);
    if (!variable) return;
    setSelectedValues((current) => ({
      ...current,
      [variableId]: variable.options.map((option) => option.id),
    }));
  }

  async function runPilot(): Promise<void> {
    const device = selectedDevice();
    if (!props.ready || busy()) return;
    if (!device) {
      props.onChooseTarget?.();
      return;
    }
    const platform =
      device.platform === "ios" || device.platform === "android" ? device.platform : undefined;
    if (!platform) {
      toast("Choose a device before repeating this Test.", "warning");
      return;
    }
    if (projection().issue) {
      toast(projection().issue!, "warning");
      return;
    }
    if (!projection().totalWorlds) {
      toast("Choose at least one value.", "warning");
      return;
    }
    const repeatInput = combineRunInput({ executionMode: "pilot" });
    if (!repeatInput || !selectedVariables().length) return;
    setBusy(true);
    try {
      const snapshot = await workflows.start({
        kind: "repeat-test",
        appMapId: props.map.id,
        testId: props.test.id,
        revision: { exact: props.map.revision },
        target: { kind: "device", platform, targetId: device.serial },
        repeat: {
          dimensions: selectedVariables().map((variable) => ({
            id: variable.id,
            values: [...valuesFor(variable)],
          })),
          strategy: strategy(),
          pilot: { mode: pilotMode() },
          resume: "untouched",
        },
        evidence: lens(),
        actorId: server.actorId(),
        workflowRequestId: crypto.randomUUID(),
        continuation: "durable",
        ...(repeatInput.surfaceCapture
          ? {
              capture: {
                fullSurfaceScreenIds: repeatInput.surfaceCapture.forceRecaptureScreenIds,
              },
            }
          : {}),
      });
      setRepeat(snapshot);
      if (snapshot.workflow) {
        rememberRepeat(snapshot);
        toast(`Pilot started with ${projection().worlds[0]!.label}`, "success");
        props.onOpenTarget?.();
        props.onStarted?.();
        void server.refreshJobs();
      } else {
        const recovered = await recoverRepeat();
        if (recovered?.workflow) {
          toast("Restored the already-started Repeat", "success");
          props.onOpenTarget?.();
          void server.refreshJobs();
        } else {
          if (recovered) applyRecoverySnapshot(recovered);
          toast(snapshot.problems[0]?.title ?? "Could not start the pilot", "error");
        }
      }
    } catch (error) {
      try {
        const recovered = await recoverRepeat();
        if (recovered?.workflow) {
          toast("Restored the already-started Repeat", "success");
          void server.refreshJobs();
        } else {
          if (recovered) applyRecoverySnapshot(recovered);
          toast(humanError(error, "Could not start the pilot"), "error");
        }
      } catch {
        toast(humanError(error, "Could not start the pilot"), "error");
      }
    } finally {
      setBusy(false);
    }
  }

  async function inspectRepeat(): Promise<void> {
    const current = repeat();
    if (!current || busy()) return;
    setBusy(true);
    try {
      const snapshot = current.workflow
        ? await workflows.inspectRepeat(current.workflow.workflowId)
        : current.ref
          ? await workflows.inspect(current.ref)
          : await workflows.recover({
              kind: "repeat-test",
              appMapId: props.map.id,
              testId: props.test.id,
            });
      if (snapshot.kind === "repeat-test") {
        if (current.workflow || current.ref) {
          if (snapshot.workflow) rememberRepeat(snapshot);
          else setRepeat(snapshot);
        } else applyRecoverySnapshot(snapshot);
      }
    } catch (error) {
      toast(humanError(error, "Could not refresh Repeat"), "error");
    } finally {
      setBusy(false);
    }
  }

  const repeatCaseLabel = (values: Readonly<Record<string, string>>) =>
    Object.entries(values)
      .map(
        ([dimensionId, valueId]) =>
          `${variableLabel(dimensionId)}: ${valueLabel(dimensionId, valueId)}`,
      )
      .join(" · ");

  async function advanceRepeat(action: DurableRepeatTestDecision["action"]): Promise<void> {
    const current = repeat();
    if ((!current?.workflow && !current?.ref) || busy()) return;
    setBusy(true);
    try {
      const snapshot = current.workflow
        ? await workflows.advanceRepeat({ action, ...current.workflow })
        : await workflows.advance({
            action: action as RepeatTestDecision["action"],
            ref: current.ref!,
            expectedVersion: current.version,
          });
      if (snapshot.kind === "repeat-test") {
        if (snapshot.workflow) rememberRepeat(snapshot);
        else setRepeat(snapshot);
        setReviewed(false);
        void server.refreshJobs();
      }
    } catch (error) {
      toast(humanError(error, "Could not update Repeat"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Show
      when={candidates().length}
      fallback={<AppMapTestVariableEmptyState onCreate={props.onCreateVariable} />}
    >
      <section
        class="grid gap-3 rounded-xl border border-border-weak-base bg-background-base p-3"
        aria-labelledby="app-map-test-combine-title"
        data-app-map-test-combine-strip
      >
        <header class="grid gap-1">
          <p class="m-0 text-micro font-semibold uppercase tracking-[0.06em] text-text-weaker">
            Repeat this…
          </p>
          <h2 id="app-map-test-combine-title" class="m-0 text-body font-semibold text-text-strong">
            {sentence()}
          </h2>
        </header>
        <fieldset class="grid gap-1.5 border-0 p-0">
          <legend class={testEditorSection}>Dimensions</legend>
          <p class={cn(testEditorHint, "m-0")}>Choose one or more Variables to vary together.</p>
          <div class="grid gap-1" role="group" aria-label="Repeat dimensions">
            <For each={candidates()}>
              {(candidate) => {
                const selected = () => selectedVariableIds().includes(candidate.id);
                return (
                  <button
                    type="button"
                    class={cn(
                      "flex min-h-11 items-center justify-between gap-2 rounded-lg border px-2.5 text-left text-caption transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus",
                      selected()
                        ? "border-border-interactive-base bg-surface-interactive-weak text-text-strong"
                        : "border-border-weak-base text-text-weak hover:bg-surface-raised-base-hover hover:text-text-strong",
                    )}
                    data-test-combine-variable={candidate.id}
                    aria-pressed={selected()}
                    disabled={repeatLocked()}
                    onClick={() => toggleVariable(candidate.id)}
                  >
                    <span class="grid min-w-0 gap-px">
                      <strong class="truncate font-medium">{candidate.name}</strong>
                      <span class="text-micro text-text-weak">
                        {valuesFor(candidate).length} of {candidate.options.length} values
                      </span>
                    </span>
                    <span aria-hidden="true">{selected() ? "Selected" : "Add"}</span>
                  </button>
                );
              }}
            </For>
          </div>
        </fieldset>
        <For each={selectedVariables()}>
          {(variable) => (
            <fieldset class="grid gap-1.5 border-0 p-0" data-test-combine-values={variable.id}>
              <div class="flex items-center justify-between gap-2">
                <span class={testEditorSection}>{variable.name} values</span>
                <button
                  type="button"
                  class="min-h-11 rounded-md px-2 text-caption text-text-base hover:bg-surface-raised-base-hover hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                  disabled={repeatLocked()}
                  onClick={() => selectAll(variable.id)}
                >
                  All
                </button>
              </div>
              <div class="flex flex-wrap gap-1.5">
                <For each={variable.options}>
                  {(option) => {
                    const on = () => valuesFor(variable).includes(option.id);
                    return (
                      <button
                        type="button"
                        class={cn(
                          "min-h-11 rounded-md border border-transparent px-2.5 text-caption focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus",
                          on() ? testSelectedRow : testQuietRow,
                        )}
                        data-test-combine-value={option.id}
                        aria-pressed={on()}
                        disabled={repeatLocked()}
                        onClick={() => toggleValue(variable.id, option.id)}
                      >
                        {combineValueLabel(option)}
                      </button>
                    );
                  }}
                </For>
              </div>
            </fieldset>
          )}
        </For>
        <AppMapTestCombineControls
          showStrategy={selectedVariables().length > 1}
          strategy={strategy}
          setStrategy={setStrategy}
          lens={lens}
          setLens={setLens}
          wholePage={wholePage}
          setWholePage={setWholePage}
          wholePageAvailability={wholePageAvailability}
          destinationScreenId={destinationScreenId}
          repeatLocked={repeatLocked}
        />
        <Show
          when={props.ready}
          fallback={
            <p class={cn(testEditorHint, "m-0")}>Save the current Test before starting a pilot.</p>
          }
        >
          <Show
            when={!restoring()}
            fallback={
              <div
                class="grid min-h-[138px] content-center gap-2 rounded-lg bg-surface-base p-2.5"
                role="status"
                aria-live="polite"
                aria-busy="true"
                data-test-repeat-restoring
              >
                <strong class="text-caption font-medium text-text-strong">
                  Restoring active Repeat…
                </strong>
                <span class={testEditorHint}>
                  Relay is recovering the saved pilot and its completed cases.
                </span>
              </div>
            }
          >
            <Show
              when={repeat()}
              fallback={
                <div class="grid gap-2 rounded-lg bg-surface-base p-2.5" data-test-repeat-pilot>
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <span class="text-caption text-text-base">
                      Pilot:{" "}
                      <strong class="font-medium text-text-strong">
                        {projection().worlds[0]?.label ?? "Choose compatible values"}
                      </strong>
                    </span>
                    <span class="text-caption tabular-nums text-text-weak">
                      {projection().totalWorlds} bounded{" "}
                      {projection().totalWorlds === 1 ? "case" : "cases"}
                    </span>
                  </div>
                  <div
                    class="grid gap-2 rounded-md border border-border-weak-base bg-background-base px-2.5 py-2"
                    data-test-repeat-preview
                    aria-label="Repeat plan preview"
                  >
                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <strong class="text-caption font-medium text-text-strong">
                        Plan preview
                      </strong>
                      <span class="text-micro tabular-nums text-text-weak">
                        Estimated duration:{" "}
                        {repeatDurationLabel(projection().totalWorlds, props.test.steps.length)}
                      </span>
                    </div>
                    <div class="grid gap-1 text-micro text-text-weak">
                      <span>
                        <strong class="font-medium text-text-base">Required:</strong> one
                        deterministic pilot
                      </span>
                      <span>
                        <strong class="font-medium text-text-base">Advisory:</strong>{" "}
                        {Math.max(0, projection().totalWorlds - 1)} remaining{" "}
                        {projection().totalWorlds - 1 === 1 ? "case" : "cases"} after review
                      </span>
                    </div>
                    <label class="grid gap-1 text-micro font-medium text-text-weak">
                      <span>Pilot selection</span>
                      <select
                        class="min-h-11 rounded-md border border-border-weak-base bg-background-base px-2.5 text-caption text-text-strong focus-visible:border-border-focus focus-visible:outline-2 focus-visible:outline-border-focus"
                        value={pilotMode()}
                        disabled={repeatLocked()}
                        onChange={(event) =>
                          setPilotMode(event.currentTarget.value as "representative" | "first")
                        }
                      >
                        <option value="representative">Representative · deterministic</option>
                        <option value="first">First generated case</option>
                      </select>
                    </label>
                    <Show when={projection().worlds.length > 1}>
                      <details class="grid gap-1 text-micro text-text-weak">
                        <summary class="min-h-11 cursor-pointer py-2 font-medium text-text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus">
                          Review case matrix ({projection().totalWorlds} cases)
                        </summary>
                        <ol
                          class="m-0 grid list-none gap-1 border-t border-border-weak-base pt-2"
                          aria-label="Repeat case matrix"
                        >
                          <For each={projection().worlds.slice(0, 6)}>
                            {(world, index) => (
                              <li class="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-md px-1">
                                <span class="min-w-0 truncate text-text-base">{world.label}</span>
                                <span class="shrink-0 text-text-weak">
                                  {index() === 0 ? "Required pilot" : "Advisory"}
                                </span>
                              </li>
                            )}
                          </For>
                        </ol>
                        <Show when={projection().totalWorlds > 6}>
                          <span class="text-text-weak">
                            Showing the first 6 cases; execution remains bounded at 250.
                          </span>
                        </Show>
                      </details>
                    </Show>
                  </div>
                  <Show
                    when={selectedDevice()}
                    fallback={
                      <div class="flex items-center justify-between gap-2">
                        <span class={testEditorHint}>Device: choose one</span>
                        <Button variant="secondary" size="sm" onClick={props.onChooseTarget}>
                          Choose device
                        </Button>
                      </div>
                    }
                  >
                    {(device) => (
                      <span class={testEditorHint}>
                        Device: {device().name || device().serial} ·{" "}
                        {device().platform === "ios" ? "iOS" : "Android"}
                      </span>
                    )}
                  </Show>
                  <p class={cn(testEditorHint, "m-0")}>
                    Relay runs the{" "}
                    {pilotMode() === "first"
                      ? "first generated case"
                      : "deterministic representative case"}{" "}
                    first and waits for review before the remaining values (advisory cases).
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={
                      busy() ||
                      restoring() ||
                      !selectedDevice() ||
                      Boolean(projection().issue) ||
                      !projection().totalWorlds
                    }
                    aria-busy={busy()}
                    onClick={() => void runPilot()}
                  >
                    {busy() ? "Starting pilot…" : "Run pilot"}
                  </Button>
                </div>
              }
            >
              {(current) => (
                <AppMapTestRepeatStatus
                  snapshot={current()}
                  busy={busy()}
                  reviewed={reviewed()}
                  caseLabel={repeatCaseLabel}
                  onReviewedChange={setReviewed}
                  onOpenRun={props.onOpenRun}
                  onRefresh={() => void inspectRepeat()}
                  onAdvance={(action) => void advanceRepeat(action)}
                  onRepeatAgain={() => {
                    try {
                      removeStoredRepeat(window.localStorage, storageKeys());
                    } catch {
                      // The completed Repeat is safe to leave as durable history.
                    }
                    setRepeat();
                  }}
                />
              )}
            </Show>
          </Show>
        </Show>
      </section>
    </Show>
  );
}
