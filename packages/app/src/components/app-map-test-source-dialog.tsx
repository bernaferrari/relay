import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import type { AppMap, AppMapScenarioTest } from "@relay/protocol";
import { Button } from "@relay/ui/button";
import { applyAppMapTestSource, projectAppMapTestSource } from "../lib/app-map-test-source";
import type { AppMapTestSourceApply, AppMapTestSourceMode } from "../lib/app-map-test-source";
import { trapFocus } from "../lib/modal";
import { Icon } from "./icon";

export function AppMapTestSourceDialog(props: {
  map: AppMap;
  test: AppMapScenarioTest;
  onApply: (update: Extract<AppMapTestSourceApply, { ok: true }>) => Promise<void> | void;
  onClose: () => void;
}) {
  const openedMap = structuredClone(props.map);
  const openedTest = structuredClone(props.test);
  const openedTestContent = JSON.stringify(openedTest);
  const projections = {
    intent: projectAppMapTestSource(openedMap, openedTest, "intent"),
    bound: projectAppMapTestSource(openedMap, openedTest, "bound"),
  };
  const initialMode: AppMapTestSourceMode =
    projections.intent.kind === "ready" ? "intent" : "bound";
  const initialSources = {
    intent: projections.intent.kind === "ready" ? projections.intent.source : "",
    bound: projections.bound.kind === "ready" ? projections.bound.source : "",
  };
  const [mode, setMode] = createSignal<AppMapTestSourceMode>(initialMode);
  const [sources, setSources] = createSignal(initialSources);
  const source = () => sources()[mode()];
  const projection = () => projections[mode()];
  const projectionMessage = () => {
    const current = projection();
    return current.kind === "unsupported" ? current.message : "";
  };
  const [error, setError] = createSignal("");
  const [bindingDecisions, setBindingDecisions] = createSignal(
    projections[initialMode].kind === "ready"
      ? (projections[initialMode].bindingDecisions ?? [])
      : [],
  );
  const [applying, setApplying] = createSignal(false);
  let panel: HTMLElement | undefined;
  let editor: HTMLTextAreaElement | undefined;
  let closeButton: HTMLButtonElement | undefined;

  async function apply(): Promise<void> {
    if (applying()) return;
    setError("");
    if (
      props.map.id !== openedMap.id ||
      props.map.revision !== openedMap.revision ||
      props.test.id !== openedTest.id ||
      JSON.stringify(props.test) !== openedTestContent
    ) {
      setError(
        "Source was not applied. This Test changed after Source opened. Close Source, review the latest Test, and apply your edit again.",
      );
      queueMicrotask(() => document.getElementById("test-source-error")?.focus());
      return;
    }
    const result = applyAppMapTestSource({
      map: openedMap,
      current: openedTest,
      source: source(),
      mode: mode(),
      updatedAt: Date.now(),
    });
    if (!result.ok) {
      setError(`Source was not applied. ${result.message}. Fix the YAML above and try again.`);
      setBindingDecisions(result.bindingDecisions ?? []);
      queueMicrotask(() => document.getElementById("test-source-error")?.focus());
      return;
    }
    setApplying(true);
    try {
      await props.onApply(result);
      props.onClose();
    } catch (failure) {
      setError(
        `Source was not applied. ${failure instanceof Error ? failure.message : String(failure)}`,
      );
      queueMicrotask(() => document.getElementById("test-source-error")?.focus());
    } finally {
      setApplying(false);
    }
  }

  function reset(): void {
    setSources((current) => ({ ...current, [mode()]: initialSources[mode()] }));
    setError("");
    const current = projections[mode()];
    setBindingDecisions(current.kind === "ready" ? (current.bindingDecisions ?? []) : []);
    queueMicrotask(() => editor?.focus());
  }

  function selectMode(next: AppMapTestSourceMode): void {
    setMode(next);
    setError("");
    const nextProjection = projections[next];
    setBindingDecisions(
      nextProjection.kind === "ready" ? (nextProjection.bindingDecisions ?? []) : [],
    );
    queueMicrotask(() => (editor ?? closeButton)?.focus());
  }

  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      props.onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown, true));
    if (panel) onCleanup(trapFocus(panel));
    queueMicrotask(() => (editor ?? closeButton)?.focus());
  });

  return (
    <div class="ui-scrim fixed inset-0 z-[var(--z-scrim)]">
      <section
        ref={(element) => (panel = element)}
        role="dialog"
        aria-modal="true"
        aria-labelledby="test-source-title"
        aria-describedby="test-source-description"
        tabindex={-1}
        class="absolute inset-y-3 right-3 z-[calc(var(--z-scrim)+1)] flex w-[min(680px,calc(100%-24px))] flex-col overflow-hidden rounded-2xl border border-border-strong-base bg-background-base shadow-[var(--shadow-lg)] max-[760px]:inset-2 max-[760px]:w-auto"
      >
        <header class="flex min-h-14 items-center gap-3 border-b border-border-weak-base px-3">
          <span class="grid size-9 place-items-center rounded-lg bg-surface-base text-text-interactive-base">
            <Icon name="edit" size={15} />
          </span>
          <div class="min-w-0 flex-1">
            <strong id="test-source-title" class="block text-body text-text-strong">
              Test source
            </strong>
            <span id="test-source-description" class="block text-caption text-text-weak">
              {mode() === "intent"
                ? "Friendly names for authoring; Relay binds them before applying"
                : "Deterministic identities with read-only recording proof metadata"}
            </span>
          </div>
          <button
            ref={(element) => (closeButton = element)}
            type="button"
            class="grid min-h-11 min-w-11 place-items-center rounded-lg text-text-weak hover:bg-surface-base-hover focus-visible:outline-2 focus-visible:outline-border-strong-focus"
            aria-label="Close Test source"
            onClick={props.onClose}
          >
            <Icon name="x" size={14} />
          </button>
        </header>

        <div
          class="flex gap-1 border-b border-border-weak-base px-3 py-2"
          role="group"
          aria-label="Test source mode"
        >
          <For each={["intent", "bound"] as const}>
            {(sourceMode) => (
              <button
                type="button"
                class={`min-h-9 rounded-lg px-3 text-caption font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong-focus ${
                  mode() === sourceMode
                    ? "bg-surface-base-active text-text-strong"
                    : "text-text-weak hover:bg-surface-base-hover"
                }`}
                aria-pressed={mode() === sourceMode}
                onClick={() => selectMode(sourceMode)}
              >
                {sourceMode === "intent" ? "Intent" : "Bound"}
              </button>
            )}
          </For>
        </div>

        <Show
          when={projection().kind === "ready"}
          fallback={
            <div class="grid min-h-0 flex-1 place-items-center p-6 text-center">
              <div class="grid max-w-[52ch] justify-items-center gap-3">
                <span class="grid size-10 place-items-center rounded-xl bg-surface-warning-weak text-icon-warning-base">
                  <Icon name="info" size={16} />
                </span>
                <div class="grid gap-1">
                  <strong class="text-body text-text-strong">Use the advanced Test editor</strong>
                  <p class="m-0 text-body/[1.5] text-text-base">
                    {projectionMessage()}. Nothing has changed. Choose the other source mode or
                    return to the Test.
                  </p>
                </div>
                <Button variant="secondary" disabled={applying()} onClick={props.onClose}>
                  Back to Test
                </Button>
              </div>
            </div>
          }
        >
          <div class="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto]">
            <div class="grid min-h-0 gap-2 p-3">
              <label for="test-source-editor" class="text-caption font-medium text-text-strong">
                YAML
              </label>
              <textarea
                ref={(element) => (editor = element)}
                id="test-source-editor"
                class="min-h-[18rem] w-full resize-none rounded-xl border border-border-weak-base bg-surface-base p-3 font-mono text-caption/[1.55] text-text-strong outline-none focus-visible:border-border-focus focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong-focus"
                value={source()}
                spellcheck={false}
                aria-invalid={Boolean(error())}
                aria-describedby={
                  error() ? "test-source-error test-source-safety" : "test-source-safety"
                }
                onInput={(event) => {
                  setSources((current) => ({
                    ...current,
                    [mode()]: event.currentTarget.value,
                  }));
                  if (error()) setError("");
                  if (bindingDecisions().length) setBindingDecisions([]);
                }}
              />
              <p id="test-source-safety" class="m-0 text-caption/[1.45] text-text-weak">
                {mode() === "intent"
                  ? "Intent uses friendly names and never executes directly. Apply must bind every name to this exact Test before the canonical Bound source can update it."
                  : "Bound source uses canonical Relay identities. Selectors and generated topology stay out; recording proof metadata remains read-only."}{" "}
                Closing discards edits that you have not applied.
              </p>
              <Show when={bindingDecisions().length > 0}>
                <div
                  class="grid gap-2 rounded-lg border border-border-warning-base bg-surface-warning-weak p-2.5"
                  role="status"
                  aria-label="Bindings that need review"
                >
                  <strong class="text-caption text-text-strong">
                    Review {bindingDecisions().length} binding
                    {bindingDecisions().length === 1 ? "" : "s"}
                  </strong>
                  <ul class="m-0 grid gap-1 pl-4 text-caption/[1.45] text-text-base">
                    <For each={bindingDecisions()}>
                      {(decision) => (
                        <li>
                          <code>{decision.path}</code>: “{decision.query}” is {decision.reason}
                          <Show when={decision.candidates.length > 0}>
                            {` — ${decision.candidates.map((candidate) => `${candidate.name} (${candidate.id})`).join(", ")}`}
                          </Show>
                        </li>
                      )}
                    </For>
                  </ul>
                </div>
              </Show>
              <Show when={error()}>
                <p
                  id="test-source-error"
                  tabindex={-1}
                  class="m-0 rounded-lg border border-border-critical-base bg-surface-critical-weak p-2.5 text-caption/[1.45] text-text-critical-base outline-none"
                  role="alert"
                >
                  {error()}
                </p>
              </Show>
            </div>
            <footer class="flex flex-wrap items-center justify-between gap-2 border-t border-border-weak-base p-3">
              <Button
                variant="ghost"
                disabled={source() === initialSources[mode()]}
                onClick={reset}
              >
                Reset
              </Button>
              <div class="flex items-center gap-2">
                <Button variant="secondary" onClick={props.onClose}>
                  Close
                </Button>
                <Button
                  variant="primary"
                  disabled={source() === initialSources[mode()] || applying()}
                  onClick={() => void apply()}
                >
                  {applying()
                    ? "Applying…"
                    : mode() === "intent"
                      ? "Bind and apply"
                      : "Apply Bound source"}
                </Button>
              </div>
            </footer>
          </div>
        </Show>
      </section>
    </div>
  );
}
