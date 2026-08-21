import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import type { AppMapScenarioTest, AppMapVariable } from "@relay/protocol";
import { cn } from "../lib/cn";
import { LocaleMatrixStart } from "./locale-matrix-start";

function supportsLocaleMatrix(variable: AppMapVariable): boolean {
  if (variable.kind !== "language" || !variable.options.length) return false;
  if (variable.apply.kind === "appLocale") return true;
  if (variable.apply.kind !== "list") return false;
  const opens = Boolean(
    variable.apply.inConnectionId ||
    variable.apply.entryPath?.length ||
    variable.apply.pickerPath?.length,
  );
  const returns = Boolean(variable.apply.outConnectionId || variable.apply.exitPath?.length);
  return opens && returns;
}

/**
 * The App Map Test is the body source. This small adapter intentionally lives
 * beside the Test workspace instead of Corpus so the saved graph Test and
 * saved language Variable are the only authoring inputs to Locale Matrix.
 */
export function AppMapTestLocaleMatrix(props: {
  appMapId: string;
  test: AppMapScenarioTest;
  variables: readonly AppMapVariable[];
  ready: boolean;
  onStarted?: () => void;
}) {
  const candidates = createMemo(() => props.variables.filter(supportsLocaleMatrix));
  const [variableId, setVariableId] = createSignal("");
  createEffect(() => {
    const available = candidates();
    if (available.some((item) => item.id === variableId())) return;
    setVariableId(available[0]?.id ?? "");
  });
  const selected = createMemo(() =>
    candidates().find((candidate) => candidate.id === variableId()),
  );

  return (
    <Show when={selected()}>
      {(variable) => (
        <section
          class="grid gap-3 rounded-2xl border border-[var(--border-weak-base)] bg-[var(--background-base)] p-3 sm:p-4"
          aria-labelledby="app-map-test-locale-matrix-title"
          data-app-map-test-locale-matrix
        >
          <header class="grid gap-1 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,18rem)] sm:items-end sm:gap-3">
            <div class="min-w-0">
              <h2
                id="app-map-test-locale-matrix-title"
                class="m-0 text-body font-semibold text-[var(--text-strong)]"
              >
                Run this Test across languages
              </h2>
              <p class="m-0 mt-0.5 max-w-prose text-caption/[1.45] text-[var(--text-weak)]">
                Relay compiles the saved Test and applies the saved language Variable before
                admitting any target.
              </p>
            </div>
            <label class="grid min-w-0 gap-1 text-micro font-medium text-[var(--text-base)]">
              <span>Language Variable</span>
              <select
                class={cn(
                  "min-h-11 w-full rounded-lg border border-[var(--border-weak-base)] bg-[var(--surface-base)] px-2.5 text-caption text-[var(--text-strong)]",
                  "focus:outline-2 focus:outline-[var(--border-focus)]",
                )}
                data-locale-matrix-variable
                value={variableId()}
                onChange={(event) => setVariableId(event.currentTarget.value)}
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
          </header>
          <Show
            when={props.ready}
            fallback={
              <p class="m-0 rounded-xl bg-[var(--surface-base)] px-3 py-2.5 text-micro/[1.45] text-[var(--text-weak)]">
                Save the current Test before materializing its language cases.
              </p>
            }
          >
            <LocaleMatrixStart
              appMapId={props.appMapId}
              testId={props.test.id}
              variableId={variable().id}
              title={`${props.test.name} · ${variable().name}`}
              onStarted={props.onStarted}
            />
          </Show>
        </section>
      )}
    </Show>
  );
}
