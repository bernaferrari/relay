import { For, Show, createEffect, createMemo, createSignal, onMount } from "solid-js";
import type { AppMapTest, AppMapVariable, CaseExpansionStrategy, Flow } from "@relay/protocol";
import { Button } from "@relay/ui/button";
import { useServer } from "../context/server";
import { toast } from "../context/toast";
import { humanError } from "../lib/human-error";
import {
  combineHeadline,
  combineSubhead,
  combineValueLabel,
  projectCombine,
  type CombineTestColumn,
} from "../lib/app-map-combine-presentation";
import { cn } from "../lib/cn";
import { copyDescription, copyStack, copyTitle } from "../lib/ui";
import { AppMapStateSetEditor } from "./app-map-state-set-editor";
import { Icon } from "./icon";

type TestCandidate = CombineTestColumn &
  ({ source: "test"; test: AppMapTest } | { source: "flow"; flow: Flow });

const MAX_DEVICE_WORLDS = 32;

function candidateKey(candidate: TestCandidate): string {
  return `${candidate.source}:${candidate.id}`;
}

function matrixId(variableIds: string[], testIds: string[]): string {
  const slug = [...variableIds, "to", ...testIds]
    .join("-")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return `matrix-${slug || "run"}`;
}

/**
 * A Figma-like run-plan inspector. State sets are dimensions, tests are
 * columns, and the visible grid is the exact work Relay will execute.
 */
export function AppMapCombine(props: {
  onClose: () => void;
  onOpenDevice: () => void;
  combineId?: string;
}) {
  const server = useServer();
  const [selectedVariableIds, setSelectedVariableIds] = createSignal<string[]>([]);
  const [selectedValues, setSelectedValues] = createSignal<Record<string, string[]>>({});
  const [selectedTestKeys, setSelectedTestKeys] = createSignal<string[]>([]);
  const [strategy, setStrategy] = createSignal<CaseExpansionStrategy>("cartesian");
  const [editingValuesFor, setEditingValuesFor] = createSignal<string>();
  const [creatingSet, setCreatingSet] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  let initializedFor = "";

  const map = createMemo(() => server.selectedAppMap());
  const variables = createMemo(() => Object.values(map()?.variables ?? {}));
  const candidates = createMemo((): TestCandidate[] => {
    const current = map();
    if (!current) return [];
    const tests: TestCandidate[] = Object.values(current.tests ?? {}).map((test) => ({
      id: test.id,
      name: test.name,
      kind: test.kind,
      source: "test",
      test,
    }));
    const referencedFlows = new Set(
      tests.flatMap((candidate) =>
        candidate.source === "test" && candidate.test.flowId ? [candidate.test.flowId] : [],
      ),
    );
    for (const flow of Object.values(current.flows ?? {})) {
      if (!flow.connectionIds.length || referencedFlows.has(flow.id)) continue;
      tests.push({ id: flow.id, name: flow.name, kind: "path", source: "flow", flow });
    }
    return tests;
  });
  const selectedVariables = createMemo(() => {
    const chosen = new Set(selectedVariableIds());
    return variables().filter((variable) => chosen.has(variable.id));
  });
  const selectedTests = createMemo(() => {
    const chosen = new Set(selectedTestKeys());
    return candidates().filter((candidate) => chosen.has(candidateKey(candidate)));
  });

  function valuesFor(variable: AppMapVariable): string[] {
    const selected = selectedValues()[variable.id];
    return selected?.length ? selected : variable.options.map((option) => option.id);
  }

  const projection = createMemo(() =>
    projectCombine(
      selectedVariables().map((variable) => {
        const chosen = new Set(valuesFor(variable));
        return {
          id: variable.id,
          name: variable.name,
          values: variable.options
            .filter((option) => chosen.has(option.id))
            .map((option) => ({ id: option.id, label: combineValueLabel(option) })),
        };
      }),
      selectedTests(),
      strategy(),
      MAX_DEVICE_WORLDS,
    ),
  );
  const headline = createMemo(() =>
    combineHeadline({
      variableNames: selectedVariables().map((variable) => variable.name),
      testNames: selectedTests().map((test) => test.name),
      cellCount: projection().cellCount,
    }),
  );
  const subhead = createMemo(() =>
    combineSubhead({
      cellCount: projection().cellCount,
      worldCount: projection().totalWorlds,
      testCount: selectedTests().length,
      hasVariable: selectedVariables().length > 0,
      hasTest: selectedTests().length > 0,
    }),
  );
  const runIssue = createMemo(() => {
    if (!selectedVariables().length) return "Choose at least one state set.";
    if (!selectedTests().length) return "Choose at least one test.";
    if (projection().issue) return projection().issue!;
    if (projection().totalWorlds > MAX_DEVICE_WORLDS) {
      return `This creates ${projection().totalWorlds} device runs. Select fewer values or use matched rows (maximum ${MAX_DEVICE_WORLDS}).`;
    }
    return "";
  });

  function initialize() {
    const current = map();
    if (!current) return;
    const requested = props.combineId?.trim();
    const key = `${current.id}:${requested ?? "new"}`;
    if (initializedFor === key) return;
    initializedFor = key;
    const existing = requested ? current.combines?.[requested] : undefined;
    const nextVariables =
      existing?.variableIds.filter((id) => current.variables[id]) ??
      (variables()[0] ? [variables()[0]!.id] : []);
    const nextTests =
      existing?.testIds
        .map((id) =>
          candidates().find((candidate) => candidate.source === "test" && candidate.id === id),
        )
        .filter((candidate): candidate is TestCandidate => Boolean(candidate))
        .map(candidateKey) ?? (candidates()[0] ? [candidateKey(candidates()[0]!)] : []);
    setSelectedVariableIds(nextVariables);
    setSelectedValues(
      Object.fromEntries(
        nextVariables.map((id) => [
          id,
          current.variables[id]?.options.map((option) => option.id) ?? [],
        ]),
      ),
    );
    setSelectedTestKeys(nextTests);
    setStrategy(existing?.strategy ?? "cartesian");
  }

  createEffect(initialize);
  onMount(initialize);

  function toggleVariable(variable: AppMapVariable) {
    setSelectedVariableIds((current) =>
      current.includes(variable.id)
        ? current.filter((id) => id !== variable.id)
        : [...current, variable.id],
    );
    setSelectedValues((current) => ({
      ...current,
      [variable.id]: current[variable.id]?.length
        ? current[variable.id]!
        : variable.options.map((option) => option.id),
    }));
  }

  function toggleValue(variable: AppMapVariable, optionId: string) {
    setSelectedValues((current) => {
      const base = current[variable.id]?.length
        ? current[variable.id]!
        : variable.options.map((option) => option.id);
      const next = base.includes(optionId)
        ? base.filter((id) => id !== optionId)
        : [...base, optionId];
      return { ...current, [variable.id]: next };
    });
  }

  function toggleTest(candidate: TestCandidate) {
    const key = candidateKey(candidate);
    setSelectedTestKeys((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  }

  async function ensureTests(currentMap: NonNullable<ReturnType<typeof map>>) {
    let revision = currentMap.revision;
    const testIds: string[] = [];
    for (const candidate of selectedTests()) {
      if (candidate.source === "test") {
        testIds.push(candidate.test.id);
        continue;
      }
      const id = `flow-${candidate.flow.id}`;
      const existing = currentMap.tests?.[id];
      if (!existing) {
        const now = Date.now();
        const saved = await server.saveTest({
          appMapId: currentMap.id,
          expectedRevision: revision,
          test: {
            id,
            organizationId: currentMap.organizationId,
            projectId: currentMap.projectId,
            appMapId: currentMap.id,
            name: candidate.flow.name,
            kind: "path",
            flowId: candidate.flow.id,
            screenshotEach: true,
            createdAt: now,
            updatedAt: now,
          },
        });
        revision = saved.appMap.revision;
      }
      testIds.push(id);
    }
    return { testIds, revision };
  }

  async function runMatrix(input?: { worldIndex: number; test: TestCandidate }) {
    const currentMap = map();
    if (!currentMap || runIssue()) {
      toast(runIssue() || "This run matrix is incomplete", "warning");
      return;
    }
    setBusy(true);
    try {
      const ensured = await ensureTests(currentMap);
      const variableIds = selectedVariables().map((variable) => variable.id);
      const selected = input
        ? Object.fromEntries(
            selectedVariables().map((variable) => {
              const value = projection().worlds[input.worldIndex]?.values[variable.id];
              return [variable.id, value ? [value.id] : []];
            }),
          )
        : Object.fromEntries(
            selectedVariables().map((variable) => [variable.id, valuesFor(variable)]),
          );
      if (input) {
        const testId = input.test.source === "test" ? input.test.id : `flow-${input.test.flow.id}`;
        await server.runPathAcrossVariables({
          appMapId: currentMap.id,
          testId,
          variableIds,
          selected,
          strategy: "zip",
          title: `${projection().worlds[input.worldIndex]?.label ?? "State"} → ${input.test.name}`,
        });
      } else {
        const id = props.combineId?.trim() || matrixId(variableIds, ensured.testIds);
        const existing = currentMap.combines?.[id];
        const now = Date.now();
        await server.saveCombine({
          appMapId: currentMap.id,
          expectedRevision: ensured.revision,
          combine: {
            id,
            organizationId: currentMap.organizationId,
            projectId: currentMap.projectId,
            appMapId: currentMap.id,
            name: headline(),
            variableIds,
            testIds: ensured.testIds,
            strategy: strategy(),
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
          },
        });
        await server.refreshAppMaps();
        await server.runPathAcrossVariables({
          appMapId: currentMap.id,
          combineId: id,
          variableIds,
          selected,
          strategy: strategy(),
          title: headline(),
        });
      }
      props.onClose();
    } catch (error) {
      toast(humanError(error, "Could not start this run matrix"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section class="flex min-h-0 w-full flex-1 flex-col" aria-label="Run matrix">
      <header class="flex items-start gap-3 border-b border-[var(--border-weak-base)] px-4 py-3.5">
        <div class="min-w-0 flex-1">
          <p class="m-0 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[var(--text-weaker)]">
            Run matrix
          </p>
          <h2 class="m-0 mt-0.5 truncate text-[15px]/[1.25] font-semibold tracking-[-0.02em] text-[var(--text-strong)]">
            {headline()}
          </h2>
          <p class="m-0 mt-0.5 text-[11.5px]/[1.35] text-[var(--text-weak)]">{subhead()}</p>
        </div>
        <button
          type="button"
          class="grid size-10 shrink-0 place-items-center rounded-[8px] text-[var(--text-weak)] hover:bg-[var(--surface-base-hover)] focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
          aria-label="Close run matrix"
          onClick={props.onClose}
        >
          <Icon name="x" size={14} />
        </button>
      </header>

      <div
        class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3"
        onWheel={(event) => event.stopPropagation()}
      >
        <Show
          when={!creatingSet()}
          fallback={
            <AppMapStateSetEditor
              onOpenDevice={props.onOpenDevice}
              onCancel={() => setCreatingSet(false)}
              onCreated={(id) => {
                initializedFor = "";
                setCreatingSet(false);
                setSelectedVariableIds([id]);
              }}
            />
          }
        >
          <div class="grid gap-4">
            <section class="grid gap-2" aria-labelledby="matrix-states-title">
              <div class="flex min-h-8 items-center justify-between gap-2">
                <div class={copyStack}>
                  <h3
                    id="matrix-states-title"
                    class={cn(copyTitle, "m-0 text-[12px] font-semibold")}
                  >
                    1. Prepare device
                  </h3>
                  <p class={cn(copyDescription, "m-0 text-[10.5px]")}>
                    Choose reusable state sets. Relay applies each value, then returns to the test
                    start.
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setCreatingSet(true)}>
                  <Icon name="plus" size={12} /> New set
                </Button>
              </div>

              <Show
                when={variables().length}
                fallback={
                  <button
                    type="button"
                    class="grid min-h-20 place-items-center rounded-[10px] border border-dashed border-[var(--border-strong-base)] px-4 text-center hover:bg-[var(--surface-base-hover)]"
                    onClick={() => setCreatingSet(true)}
                  >
                    <span class={cn(copyStack, "items-center")}>
                      <strong class={cn(copyTitle, "block text-[12px]")}>
                        Add the first state set
                      </strong>
                      <span class={cn(copyDescription, "block text-[10.5px]")}>
                        Languages, accounts, themes, models, or any list.
                      </span>
                    </span>
                  </button>
                }
              >
                <div class="grid gap-1">
                  <For each={variables()}>
                    {(variable) => {
                      const selected = () => selectedVariableIds().includes(variable.id);
                      const editing = () => editingValuesFor() === variable.id && selected();
                      return (
                        <div class={cn("rounded-[9px]", selected() && "bg-[var(--surface-base)]")}>
                          <div class="flex min-h-11 items-center gap-1 px-1.5">
                            <button
                              type="button"
                              class="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-[7px] px-1.5 text-left hover:bg-[var(--surface-base-hover)] focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
                              aria-pressed={selected()}
                              onClick={() => toggleVariable(variable)}
                            >
                              <span
                                class={cn(
                                  "grid size-4 shrink-0 place-items-center rounded-[4px] border",
                                  selected()
                                    ? "border-[var(--text-interactive-base)] bg-[var(--text-interactive-base)] text-[var(--button-primary-foreground,var(--icon-invert-base))]"
                                    : "border-[var(--border-strong-base)]",
                                )}
                              >
                                <Show when={selected()}>
                                  <Icon name="check" size={9} />
                                </Show>
                              </span>
                              <span class={cn(copyStack, "flex-1")}>
                                <strong
                                  class={cn(copyTitle, "block truncate text-[11.5px] font-medium")}
                                >
                                  {variable.name}
                                </strong>
                                <span class={cn(copyDescription, "block text-[10px] tabular-nums")}>
                                  {valuesFor(variable).length} of {variable.options.length} values
                                </span>
                              </span>
                            </button>
                            <Show when={selected()}>
                              <button
                                type="button"
                                class="grid size-10 shrink-0 place-items-center rounded-[7px] text-[var(--text-weak)] hover:bg-[var(--surface-base-hover)] hover:text-[var(--text-strong)] focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
                                aria-label={`${editing() ? "Hide" : "Choose"} ${variable.name} values`}
                                aria-expanded={editing()}
                                onClick={() =>
                                  setEditingValuesFor(editing() ? undefined : variable.id)
                                }
                              >
                                <Icon name={editing() ? "chevron-up" : "sliders"} size={12} />
                              </button>
                            </Show>
                          </div>
                          <Show when={editing()}>
                            <div class="flex flex-wrap gap-1 border-t border-[var(--border-weak-base)] px-2 py-2">
                              <For each={variable.options}>
                                {(option) => {
                                  const optionSelected = () =>
                                    valuesFor(variable).includes(option.id);
                                  return (
                                    <button
                                      type="button"
                                      class={cn(
                                        "min-h-9 rounded-[7px] px-2 text-[10.5px] transition-colors duration-150",
                                        optionSelected()
                                          ? "bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)]"
                                          : "text-[var(--text-base)] hover:bg-[var(--surface-base-hover)]",
                                      )}
                                      aria-pressed={optionSelected()}
                                      onClick={() => toggleValue(variable, option.id)}
                                    >
                                      {combineValueLabel(option)}
                                    </button>
                                  );
                                }}
                              </For>
                            </div>
                          </Show>
                        </div>
                      );
                    }}
                  </For>
                </div>
              </Show>
            </section>

            <Show when={selectedVariables().length > 1}>
              <section class="grid gap-2" aria-labelledby="coverage-title">
                <div class={copyStack}>
                  <h3 id="coverage-title" class={cn(copyTitle, "m-0 text-[12px] font-semibold")}>
                    2. Build combinations
                  </h3>
                  <p class={cn(copyDescription, "m-0 text-[10.5px]")}>
                    Choose how values from different state sets form device states.
                  </p>
                </div>
                <div
                  class={cn(
                    "grid gap-1 rounded-[9px] bg-[var(--surface-base)] p-1",
                    selectedVariables().length > 2 ? "grid-cols-3" : "grid-cols-2",
                  )}
                  role="radiogroup"
                  aria-label="Value coverage"
                >
                  <button
                    type="button"
                    class={cn(
                      "min-h-10 rounded-[7px] px-2 text-[11px] font-medium",
                      strategy() === "cartesian"
                        ? "bg-[var(--surface-raised-stronger-non-alpha)] text-[var(--text-strong)] shadow-[var(--shadow-xs-border-base)]"
                        : "text-[var(--text-weak)] hover:text-[var(--text-strong)]",
                    )}
                    role="radio"
                    aria-checked={strategy() === "cartesian"}
                    onClick={() => setStrategy("cartesian")}
                  >
                    Every combination
                  </button>
                  <button
                    type="button"
                    class={cn(
                      "min-h-10 rounded-[7px] px-2 text-[11px] font-medium",
                      strategy() === "zip"
                        ? "bg-[var(--surface-raised-stronger-non-alpha)] text-[var(--text-strong)] shadow-[var(--shadow-xs-border-base)]"
                        : "text-[var(--text-weak)] hover:text-[var(--text-strong)]",
                    )}
                    role="radio"
                    aria-checked={strategy() === "zip"}
                    onClick={() => setStrategy("zip")}
                  >
                    Match rows
                  </button>
                  <Show when={selectedVariables().length > 2}>
                    <button
                      type="button"
                      class={cn(
                        "min-h-10 rounded-[7px] px-2 text-[11px] font-medium",
                        strategy() === "pairwise"
                          ? "bg-[var(--surface-raised-stronger-non-alpha)] text-[var(--text-strong)] shadow-[var(--shadow-xs-border-base)]"
                          : "text-[var(--text-weak)] hover:text-[var(--text-strong)]",
                      )}
                      role="radio"
                      aria-checked={strategy() === "pairwise"}
                      data-tip="Cover every pair of values with fewer device runs"
                      onClick={() => setStrategy("pairwise")}
                    >
                      Every pair
                    </button>
                  </Show>
                </div>
              </section>
            </Show>

            <section class="grid gap-2" aria-labelledby="matrix-tests-title">
              <div class={copyStack}>
                <h3 id="matrix-tests-title" class={cn(copyTitle, "m-0 text-[12px] font-semibold")}>
                  {selectedVariables().length > 1 ? "3" : "2"}. Run tests
                </h3>
                <p class={cn(copyDescription, "m-0 text-[10.5px]")}>
                  Every selected test runs in every device state above.
                </p>
              </div>
              <Show
                when={candidates().length}
                fallback={
                  <div
                    class={cn(
                      copyStack,
                      "items-center rounded-[9px] bg-[var(--surface-base)] px-3 py-4 text-center",
                    )}
                  >
                    <strong class={cn(copyTitle, "block text-[12px]")}>Record a path first</strong>
                    <span class={cn(copyDescription, "block text-[10.5px]")}>
                      Paths and screen tours become reusable tests.
                    </span>
                  </div>
                }
              >
                <div class="grid gap-1">
                  <For each={candidates()}>
                    {(candidate) => {
                      const selected = () => selectedTestKeys().includes(candidateKey(candidate));
                      return (
                        <button
                          type="button"
                          class={cn(
                            "flex min-h-11 items-center gap-2 rounded-[8px] px-2.5 text-left hover:bg-[var(--surface-base-hover)] focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]",
                            selected() && "bg-[var(--surface-base)]",
                          )}
                          aria-pressed={selected()}
                          onClick={() => toggleTest(candidate)}
                        >
                          <span
                            class={cn(
                              "grid size-4 shrink-0 place-items-center rounded-[4px] border",
                              selected()
                                ? "border-[var(--text-interactive-base)] bg-[var(--text-interactive-base)] text-[var(--button-primary-foreground,var(--icon-invert-base))]"
                                : "border-[var(--border-strong-base)]",
                            )}
                          >
                            <Show when={selected()}>
                              <Icon name="check" size={9} />
                            </Show>
                          </span>
                          <span class={cn(copyStack, "flex-1")}>
                            <strong
                              class={cn(copyTitle, "block truncate text-[11.5px] font-medium")}
                            >
                              {candidate.name}
                            </strong>
                            <span class={cn(copyDescription, "block text-[10px]")}>
                              {candidate.kind === "tour" ? "Visit mapped screens" : "Recorded path"}
                            </span>
                          </span>
                        </button>
                      );
                    }}
                  </For>
                </div>
              </Show>
            </section>

            <Show when={selectedVariables().length && selectedTests().length}>
              <section class="grid gap-2" aria-labelledby="matrix-preview-title">
                <div class="flex items-end justify-between gap-2">
                  <div class={copyStack}>
                    <h3
                      id="matrix-preview-title"
                      class={cn(copyTitle, "m-0 text-[12px] font-semibold")}
                    >
                      Run plan
                    </h3>
                    <p class={cn(copyDescription, "m-0 text-[10.5px]")}>
                      Each row is one prepared device state. Each column is a test.
                    </p>
                  </div>
                  <span class="shrink-0 text-[10px] tabular-nums text-[var(--text-weak)]">
                    {projection().cellCount} checks
                  </span>
                </div>
                <Show
                  when={!projection().issue}
                  fallback={
                    <p class="m-0 rounded-[8px] bg-[var(--surface-warning-weak,var(--surface-base))] px-2.5 py-2 text-[11px] text-[var(--text-warning-base,var(--text-base))]">
                      {projection().issue}
                    </p>
                  }
                >
                  <div
                    class="max-h-72 overflow-auto overscroll-contain rounded-[9px] border border-[var(--border-weak-base)]"
                    onWheel={(event) => event.stopPropagation()}
                  >
                    <table class="w-full min-w-[360px] border-collapse text-left">
                      <thead class="sticky top-0 z-[2] bg-[var(--surface-raised-stronger-non-alpha)]">
                        <tr class="border-b border-[var(--border-weak-base)]">
                          <th class="sticky left-0 z-[3] min-w-40 bg-[var(--surface-raised-stronger-non-alpha)] px-2.5 py-2 text-[10px] font-medium text-[var(--text-weak)]">
                            Device state
                          </th>
                          <For each={selectedTests()}>
                            {(test) => (
                              <th class="min-w-28 px-2 py-2 text-[10px] font-medium text-[var(--text-weak)]">
                                {test.name}
                              </th>
                            )}
                          </For>
                        </tr>
                      </thead>
                      <tbody>
                        <For each={projection().worlds}>
                          {(world, worldIndex) => (
                            <tr class="border-b border-[var(--border-weak-base)] last:border-b-0">
                              <th class="sticky left-0 z-[1] bg-[var(--surface-raised-stronger-non-alpha)] px-2.5 py-2 text-[10.5px] font-medium text-[var(--text-strong)]">
                                {world.label}
                              </th>
                              <For each={selectedTests()}>
                                {(test) => (
                                  <td class="px-1.5 py-1">
                                    <button
                                      type="button"
                                      class="grid min-h-9 w-full place-items-center rounded-[7px] text-[var(--text-interactive-base)] hover:bg-[var(--product-accent-soft)] focus-visible:outline-2 focus-visible:outline-[var(--border-focus)] disabled:text-[var(--text-weaker)]"
                                      disabled={busy()}
                                      aria-label={`Run ${test.name} in ${world.label}`}
                                      onClick={() =>
                                        void runMatrix({ worldIndex: worldIndex(), test })
                                      }
                                    >
                                      <Icon name="play" size={11} />
                                    </button>
                                  </td>
                                )}
                              </For>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                  </div>
                </Show>
              </section>
            </Show>

            <Show when={runIssue()}>
              <p class="m-0 flex items-start gap-2 rounded-[8px] bg-[var(--surface-base)] px-2.5 py-2 text-[10.5px]/[1.4] text-[var(--text-base)]">
                <Icon name="info" size={12} class="mt-0.5 shrink-0" /> {runIssue()}
              </p>
            </Show>
          </div>
        </Show>
      </div>

      <Show when={!creatingSet()}>
        <footer class="flex items-center justify-between gap-3 border-t border-[var(--border-weak-base)] px-4 py-3">
          <span class="min-w-0 truncate text-[10.5px] text-[var(--text-weak)]">
            {projection().totalWorlds || 0} states × {selectedTests().length} tests
          </span>
          <Button
            variant="primary"
            size="lg"
            disabled={busy() || Boolean(runIssue())}
            onClick={() => void runMatrix()}
          >
            <Icon name="play" size={12} />
            {busy()
              ? "Starting…"
              : projection().cellCount
                ? `Run ${projection().cellCount} ${projection().cellCount === 1 ? "check" : "checks"}`
                : "Run matrix"}
          </Button>
        </footer>
      </Show>
    </section>
  );
}
