import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import {
  createRelayWorkflows,
  type DurableRepeatTestDecision,
  type RepeatTestDecision,
  type RepeatTestSnapshot,
} from "@relay/workflows";
import { Button } from "@relay/ui/button";
import { Switch } from "@relay/ui/switch";
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
import {
  type AppMapTestCombineStripProps,
  repeatCaseLabel as presentRepeatCaseLabel,
  repeatStatusLabel,
} from "../lib/app-map-test-repeat-presentation";
import { AppMapTestVariableEmptyState } from "./app-map-test-variable-empty-state";
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
  const [variableId, setVariableId] = createSignal("");
  const [selectedIds, setSelectedIds] = createSignal<string[]>([]);
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
    const dimension = snapshot.frozen!.resolved.dimensions[0];
    if (dimension) {
      setVariableId(dimension.id);
      setSelectedIds([...dimension.valueIds]);
    }
    setLens(snapshot.frozen!.evidence);
    setWholePage(Boolean(snapshot.frozen!.capture?.fullSurfaceScreenIds.length));
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
    if (available.some((item) => item.id === variableId())) return;
    const first = available[0];
    setVariableId(first?.id ?? "");
    setSelectedIds(first ? [first.options[0]?.id].filter((id): id is string => Boolean(id)) : []);
  });
  const selectedVariable = createMemo(() =>
    candidates().find((candidate) => candidate.id === variableId()),
  );
  const repeatValueLabel = (valueId: string) => {
    const option = selectedVariable()?.options.find((candidate) => candidate.id === valueId);
    return option ? combineValueLabel(option) : valueId;
  };
  const selected = createMemo(() => {
    const variable = selectedVariable();
    if (!variable) return {};
    const ids = selectedIds().filter((id) => variable.options.some((option) => option.id === id));
    return { [variable.id]: ids };
  });
  const projection = createMemo(() =>
    projectTestCombineStrip({
      test: props.test,
      variables: selectedVariable() ? [selectedVariable()!] : [],
      selected: selected(),
    }),
  );
  const sentence = createMemo(() =>
    testCombineSentence({
      testName: props.test.name,
      variableNames: selectedVariable() ? [selectedVariable()!.name] : [],
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

  function toggleValue(id: string): void {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  function selectAll(): void {
    const variable = selectedVariable();
    setSelectedIds(variable ? variable.options.map((option) => option.id) : []);
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
    if (!projection().cells.length) {
      toast("Choose at least one value.", "warning");
      return;
    }
    const repeatInput = combineRunInput({ executionMode: "pilot" });
    const dimension = selectedVariable();
    if (!repeatInput || !dimension) return;
    setBusy(true);
    try {
      const snapshot = await workflows.start({
        kind: "repeat-test",
        appMapId: props.map.id,
        testId: props.test.id,
        revision: { exact: props.map.revision },
        target: { kind: "device", platform, targetId: device.serial },
        repeat: {
          dimensions: [{ id: dimension.id, values: [...selectedIds()] }],
          strategy: "zip",
          pilot: { mode: "representative" },
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
    presentRepeatCaseLabel(values, variableId(), repeatValueLabel);

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
        <Show when={candidates().length > 1}>
          <label class="grid gap-1">
            <span class={testEditorSection}>Dimension</span>
            <select
              class="min-h-11 rounded-md border border-border-weak-base bg-background-base px-2.5 text-caption text-text-strong focus-visible:border-border-focus focus-visible:outline-none"
              data-test-combine-variable
              value={variableId()}
              disabled={repeatLocked()}
              onChange={(event) => {
                const id = event.currentTarget.value;
                setVariableId(id);
                const next = candidates().find((item) => item.id === id);
                setSelectedIds(
                  next
                    ? [next.options[0]?.id].filter((value): value is string => Boolean(value))
                    : [],
                );
              }}
            >
              <For each={candidates()}>
                {(candidate) => (
                  <option value={candidate.id}>
                    {candidate.name} · {candidate.options.length} values
                  </option>
                )}
              </For>
            </select>
          </label>
        </Show>
        <div class="grid gap-1.5">
          <div class="flex items-center justify-between gap-2">
            <span class={testEditorSection}>Values</span>
            <button
              type="button"
              class="text-caption text-text-base hover:underline"
              disabled={repeatLocked()}
              onClick={selectAll}
            >
              All
            </button>
          </div>
          <div class="flex flex-wrap gap-1.5">
            <For each={selectedVariable()?.options ?? []}>
              {(option) => {
                const on = () => selectedIds().includes(option.id);
                return (
                  <button
                    type="button"
                    class={cn(
                      "min-h-11 rounded-md px-2.5 text-caption",
                      on() ? testSelectedRow : testQuietRow,
                      "border border-transparent",
                    )}
                    data-test-combine-value={option.id}
                    aria-pressed={on()}
                    disabled={repeatLocked()}
                    onClick={() => toggleValue(option.id)}
                  >
                    {combineValueLabel(option)}
                  </button>
                );
              }}
            </For>
          </div>
        </div>
        <div class="grid gap-1.5">
          <span class={testEditorSection}>Evidence</span>
          <div class="flex gap-1.5">
            <For each={["visual", "smoke"] as const}>
              {(choice) => (
                <button
                  type="button"
                  class={cn(
                    "min-h-11 rounded-md px-3 text-caption",
                    lens() === choice ? testSelectedRow : testQuietRow,
                  )}
                  data-test-combine-lens={choice}
                  aria-pressed={lens() === choice}
                  disabled={repeatLocked()}
                  onClick={() => setLens(choice)}
                >
                  {choice === "visual" ? "Visual" : "Smoke"}
                </button>
              )}
            </For>
          </div>
        </div>
        <div class="flex items-start justify-between gap-4">
          <div class="grid min-w-0 gap-px">
            <span id="app-map-test-combine-whole-page" class={testEditorSection}>
              Whole page
            </span>
            <span class={testEditorHint}>
              {wholePageAvailability().ready
                ? "Capture the full scrolling screen."
                : destinationScreenId()
                  ? "This destination has no frozen full-page capture."
                  : "This Test has no destination screen to capture as a whole page."}
            </span>
          </div>
          <Switch
            class="mt-0.5 shrink-0"
            checked={wholePage()}
            disabled={repeatLocked() || !wholePageAvailability().ready}
            aria-labelledby="app-map-test-combine-whole-page"
            data-test-combine-whole-page
            onCheckedChange={setWholePage}
          />
        </div>
        <Show
          when={props.ready}
          fallback={
            <p class={cn(testEditorHint, "m-0")}>Save the current Test before starting a pilot.</p>
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
                      {projection().worlds[0]?.label}
                    </strong>
                  </span>
                  <span class="text-caption tabular-nums text-text-weak">
                    {projection().cells.length} {projection().cells.length === 1 ? "case" : "cases"}
                  </span>
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
                  Relay runs one representative value first and waits for review before the
                  remaining values.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={
                    busy() || restoring() || !selectedDevice() || !projection().cells.length
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
              <div class="grid gap-2 rounded-lg bg-surface-base p-2.5" data-test-repeat-status>
                <div class="flex flex-wrap items-start justify-between gap-2">
                  <div class="grid gap-px">
                    <strong class="text-caption font-medium text-text-strong">
                      {current().progress.label}
                    </strong>
                    <span class="text-caption tabular-nums text-text-weak">
                      {current().outcomes.passed} passed · {current().outcomes.untouched} untouched
                      · {current().outcomes.failed + current().outcomes.needsReview} problems
                    </span>
                  </div>
                  <div class="flex flex-wrap gap-1">
                    <Show when={current().evidenceRefs[0]}>
                      {(evidence) => (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => props.onOpenRun?.(evidence().id)}
                        >
                          View pilot evidence
                        </Button>
                      )}
                    </Show>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy()}
                      onClick={() => void inspectRepeat()}
                    >
                      Refresh
                    </Button>
                  </div>
                </div>
                <Show when={current().problems[0]}>
                  {(problem) => (
                    <p class={cn(testEditorHint, "m-0")} role="status">
                      {problem().recovery}
                    </p>
                  )}
                </Show>
                <Show when={current().results.length > 0}>
                  <ul
                    class="m-0 grid list-none gap-1 p-0"
                    aria-label="Repeat results"
                    data-test-repeat-results
                  >
                    <For each={current().results}>
                      {(result) => (
                        <li class="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-md border border-border-weak-base bg-background-base px-2.5 py-2 text-caption">
                          <span class="min-w-0 truncate font-medium text-text-strong">
                            {repeatCaseLabel(result.values)}
                          </span>
                          <span class="text-text-weak">
                            {result.phase === "pilot" ? "Pilot · " : ""}
                            {repeatStatusLabel(result.status)}
                          </span>
                          <Show when={result.runId} fallback={<span aria-hidden="true" />}>
                            {(runId) => (
                              <Button
                                variant="ghost"
                                size="sm"
                                aria-label={`Open ${repeatCaseLabel(result.values)} result`}
                                onClick={() => props.onOpenRun?.(runId())}
                              >
                                View
                              </Button>
                            )}
                          </Show>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
                <Show when={current().allowedNextActions.includes("confirm-and-continue")}>
                  <label class="flex min-h-11 items-center gap-2 rounded-md border border-border-weak-base px-2.5 text-caption text-text-base">
                    <input
                      type="checkbox"
                      checked={reviewed()}
                      onChange={(event) => setReviewed(event.currentTarget.checked)}
                    />
                    I reviewed the representative result
                  </label>
                </Show>
                <div class="flex flex-wrap gap-2">
                  <Show when={current().allowedNextActions.includes("continue")}>
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={busy()}
                      onClick={() => void advanceRepeat("continue")}
                    >
                      Continue remaining {current().outcomes.untouched}
                    </Button>
                  </Show>
                  <Show when={current().allowedNextActions.includes("confirm-and-continue")}>
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={busy() || !reviewed()}
                      onClick={() => void advanceRepeat("confirm-and-continue")}
                    >
                      Continue remaining {current().outcomes.untouched}
                    </Button>
                  </Show>
                  <Show when={current().allowedNextActions.includes("cancel")}>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy()}
                      onClick={() => void advanceRepeat("cancel")}
                    >
                      Stop Repeat
                    </Button>
                  </Show>
                  <Show when={current().stage === "complete"}>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        try {
                          removeStoredRepeat(window.localStorage, storageKeys());
                        } catch {
                          // The completed Repeat is safe to leave as durable history.
                        }
                        setRepeat();
                      }}
                    >
                      Repeat again
                    </Button>
                  </Show>
                </div>
              </div>
            )}
          </Show>
        </Show>
      </section>
    </Show>
  );
}
