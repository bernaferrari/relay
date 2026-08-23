import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import type { AppMap, AppMapScenarioTest } from "@relay/protocol";
import { Button } from "@relay/ui/button";
import { Switch } from "@relay/ui/switch";
import { useServer } from "../context/server";
import { toast } from "../context/toast";
import { cn } from "../lib/cn";
import { humanError } from "../lib/human-error";
import { combineValueLabel } from "../lib/app-map-combine-presentation";
import {
  applyableVariables,
  projectTestCombineStrip,
  testCombineSentence,
  testCombineStripRunInput,
  testWholePageAvailability,
  type TestCombineLens,
} from "../lib/app-map-test-combine-strip";
import {
  testEditorHint,
  testEditorSection,
  testQuietRow,
  testSelectedRow,
} from "../lib/app-map-test-editor-styles";

export function AppMapTestCombineStrip(props: {
  map: AppMap;
  test: AppMapScenarioTest;
  ready: boolean;
  onStarted?: () => void;
}) {
  const server = useServer();
  const candidates = createMemo(() => applyableVariables(Object.values(props.map.variables ?? {})));
  const [variableId, setVariableId] = createSignal("");
  const [selectedIds, setSelectedIds] = createSignal<string[]>([]);
  const [lens, setLens] = createSignal<TestCombineLens>("visual");
  const [wholePage, setWholePage] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
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

  async function runCell(worldId?: string): Promise<void> {
    const variable = selectedVariable();
    const device = selectedDevice();
    if (!variable || !props.ready || busy()) return;
    if (!device) {
      window.dispatchEvent(new CustomEvent("relay:open-device-picker"));
      return;
    }
    const platform =
      device.platform === "ios" || device.platform === "android" ? device.platform : undefined;
    if (!platform) {
      toast("Choose a device Target before running a Combine cell.", "warning");
      return;
    }
    const world = worldId
      ? projection().worlds.find((item) => item.id === worldId)
      : projection().worlds[0];
    if (!world) {
      toast("Choose at least one value.", "warning");
      return;
    }
    const combine = combineRunInput({ cell: world.values[variable.id]?.id ?? world.id });
    if (!combine) return;
    setBusy(true);
    try {
      await server.runAction("app-map.test.run", {
        appMapId: props.map.id,
        testId: props.test.id,
        expectedRevision: props.map.revision,
        target: { kind: "device", platform, targetId: device.serial },
        ...combine,
      });
      toast(`Running ${props.test.name} in ${world.label}`, "success");
      window.dispatchEvent(new CustomEvent("relay:open-device-panel"));
      props.onStarted?.();
    } catch (error) {
      toast(humanError(error, "Could not start this Combine cell"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function runSelected(): Promise<void> {
    const device = selectedDevice();
    if (!props.ready || busy()) return;
    if (!device) {
      window.dispatchEvent(new CustomEvent("relay:open-device-picker"));
      return;
    }
    const platform =
      device.platform === "ios" || device.platform === "android" ? device.platform : undefined;
    if (!platform) {
      toast("Choose a device Target before running a Combine.", "warning");
      return;
    }
    if (!projection().cells.length) {
      toast("Choose at least one value.", "warning");
      return;
    }
    const combine = combineRunInput({
      executionMode: projection().cells.length > 1 ? "all" : "pilot",
    });
    if (!combine) return;
    setBusy(true);
    try {
      await server.runAction("app-map.test.run", {
        appMapId: props.map.id,
        testId: props.test.id,
        expectedRevision: props.map.revision,
        target: { kind: "device", platform, targetId: device.serial },
        ...combine,
      });
      toast(
        projection().cells.length === 1
          ? `Running ${props.test.name}`
          : `Running ${projection().cells.length} selected worlds`,
        "success",
      );
      window.dispatchEvent(new CustomEvent("relay:open-device-panel"));
      props.onStarted?.();
    } catch (error) {
      toast(humanError(error, "Could not start this Combine"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Show
      when={candidates().length}
      fallback={
        <section
          class="grid gap-1 rounded-xl border border-border-weak-base bg-background-base px-3 py-3"
          data-app-map-test-combine-strip
        >
          <p class={cn(testEditorSection, "m-0")}>Run this Test in other worlds</p>
          <p class={cn(testEditorHint, "m-0")}>
            Create a Variable with apply and undo — a list, app locale, or toggle — then pick values
            here.
          </p>
        </section>
      }
    >
      <section
        class="grid gap-3 rounded-xl border border-border-weak-base bg-background-base p-3"
        aria-labelledby="app-map-test-combine-title"
        data-app-map-test-combine-strip
      >
        <header class="grid gap-1">
          <p class="m-0 text-micro font-semibold uppercase tracking-[0.06em] text-text-weaker">
            Combine
          </p>
          <h2 id="app-map-test-combine-title" class="m-0 text-body font-semibold text-text-strong">
            {sentence()}
          </h2>
        </header>
        <Show when={candidates().length > 1}>
          <label class="grid gap-1">
            <span class={testEditorSection}>Variable</span>
            <select
              class="min-h-11 rounded-md border border-border-weak-base bg-background-base px-2.5 text-caption text-text-strong focus-visible:border-border-focus focus-visible:outline-none"
              data-test-combine-variable
              value={variableId()}
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
          <span class={testEditorSection}>Lens</span>
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
            disabled={!wholePageAvailability().ready}
            aria-labelledby="app-map-test-combine-whole-page"
            data-test-combine-whole-page
            onCheckedChange={setWholePage}
          />
        </div>
        <Show
          when={props.ready}
          fallback={
            <p class={cn(testEditorHint, "m-0")}>Save the current Test before running a cell.</p>
          }
        >
          <div class="grid gap-1" data-test-combine-grid>
            <For each={projection().worlds}>
              {(world) => (
                <button
                  type="button"
                  class={cn(testQuietRow, "min-h-11 px-2.5 text-caption text-text-strong")}
                  data-test-combine-cell={world.id}
                  disabled={busy()}
                  onClick={() => void runCell(world.id)}
                >
                  Run {world.label}
                </button>
              )}
            </For>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={busy() || !projection().cells.length}
              onClick={() => void runSelected()}
            >
              Run selected
            </Button>
            <span class={testEditorHint}>
              Primary action is one cell. Run selected is explicit.
            </span>
          </div>
        </Show>
      </section>
    </Show>
  );
}
