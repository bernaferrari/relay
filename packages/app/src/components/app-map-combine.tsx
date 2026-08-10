import { For, Show, createEffect, createMemo, createSignal, onMount } from "solid-js";
import type {
  AppMapCapturePolicy,
  AppMapTest,
  AppMapVariable,
  CaseExpansionStrategy,
  Flow,
  MapGroup,
} from "@relay/protocol";
import { Button } from "@relay/ui/button";
import { useServer } from "../context/server";
import { toast } from "../context/toast";
import { humanError } from "../lib/human-error";
import { targetIsReady } from "../lib/target-presentation";
import {
  combineHeadline,
  combineSubhead,
  combineValueLabel,
  projectCombine,
  type CombineTestColumn,
} from "../lib/app-map-combine-presentation";
import { combineWithoutVariable } from "../lib/app-map-combine-edit";
import { cn } from "../lib/cn";
import { copyDescription, copyStack, copyTitle } from "../lib/ui";
import { confirmAction } from "./confirm-dialog";
import { AppMapMatrixValuePicker } from "./app-map-matrix-value-picker";
import { AppMapStateSetEditor } from "./app-map-state-set-editor";
import { Icon } from "./icon";

type TestCandidate = CombineTestColumn &
  (
    | { source: "test"; test: AppMapTest }
    | { source: "flow"; flow: Flow }
    | { source: "group"; group: MapGroup }
  );

const MAX_DEVICE_WORLDS = 32;
type SimpleCaptureMode = Exclude<AppMapCapturePolicy["mode"], "checkpoints">;

function candidateKey(candidate: TestCandidate): string {
  return `${candidate.source}:${candidate.id}`;
}

function savedTestId(candidate: TestCandidate): string {
  return candidate.source === "test"
    ? candidate.test.id
    : candidate.source === "flow"
      ? `flow-${candidate.flow.id}`
      : `group-${candidate.group.id}`;
}

function defaultCaptureMode(candidate: TestCandidate): SimpleCaptureMode {
  if (candidate.source === "test") {
    const mode = candidate.test.capture?.mode;
    if (mode && mode !== "checkpoints") return mode;
    if (candidate.test.screenshotEach === false) return "none";
  }
  return "every-screen";
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

function modifierMethodLabel(variable: AppMapVariable): string {
  if (variable.apply.kind === "appLocale") return "Android app language";
  if (variable.apply.kind === "toggle") return "toggle";
  const opensWithPath = Boolean(
    variable.apply.inConnectionId ||
    variable.apply.entryPath?.length ||
    variable.apply.pickerPath?.length,
  );
  const returnsWithPath = Boolean(
    variable.apply.outConnectionId || variable.apply.exitPath?.length,
  );
  if (opensWithPath && returnsWithPath) return "mapped open + return";
  if (opensWithPath) return "mapped list";
  return "visible list labels";
}

/**
 * A Figma-like run-plan inspector. Modifiers are dimensions, tests are
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
  const [captureModes, setCaptureModes] = createSignal<Record<string, SimpleCaptureMode>>({});
  const [strategy, setStrategy] = createSignal<CaseExpansionStrategy>("cartesian");
  const [editingValuesFor, setEditingValuesFor] = createSignal<string>();
  const [creatingSet, setCreatingSet] = createSignal(false);
  const [editingModifierId, setEditingModifierId] = createSignal<string>();
  const [busy, setBusy] = createSignal(false);
  const [savingOnly, setSavingOnly] = createSignal(false);
  let initializedFor = "";

  const map = createMemo(() => server.selectedAppMap());
  const canRunOnDevice = createMemo(() =>
    targetIsReady(
      server.devices().find((device) => device.serial === server.selectedDevice()),
      server.health() === "online",
    ),
  );
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
      screenCount: test.screenIds?.length,
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
    for (const group of Object.values(current.groups ?? {})) {
      if (!group.screenIds.length) continue;
      tests.push({
        id: group.id,
        name: group.name,
        kind: "tour",
        source: "group",
        group,
        screenCount: group.screenIds.length,
      });
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
  const modifierBeingEdited = createMemo(() => {
    const id = editingModifierId();
    return id ? map()?.variables[id] : undefined;
  });
  const modifierEditorOpen = () => creatingSet() || Boolean(editingModifierId());

  function valuesFor(variable: AppMapVariable): string[] {
    const selected = selectedValues()[variable.id];
    return selected !== undefined ? selected : variable.options.map((option) => option.id);
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
      screenshotCount:
        projection().totalWorlds &&
        selectedTests().every((test) => {
          const mode = captureModes()[candidateKey(test)] ?? defaultCaptureMode(test);
          return mode !== "every-screen" || test.screenCount !== undefined;
        })
          ? projection().totalWorlds *
            selectedTests().reduce((total, test) => {
              const mode = captureModes()[candidateKey(test)] ?? defaultCaptureMode(test);
              if (mode === "every-screen") return total + (test.screenCount ?? 0);
              if (mode === "final-screen") return total + 1;
              return total;
            }, 0)
          : undefined,
    }),
  );
  const runIssue = createMemo(() => {
    if (!selectedVariables().length) return "Choose at least one modifier.";
    const empty = selectedVariables().find((variable) => valuesFor(variable).length === 0);
    if (empty) return `Choose at least one ${empty.name} value.`;
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
          existing?.selected?.[id] ??
            current.variables[id]?.options.map((option) => option.id) ??
            [],
        ]),
      ),
    );
    setSelectedTestKeys(nextTests);
    setCaptureModes(
      Object.fromEntries(
        candidates().map((candidate) => {
          const saved = existing?.captures?.[savedTestId(candidate)]?.mode;
          return [
            candidateKey(candidate),
            saved && saved !== "checkpoints" ? saved : defaultCaptureMode(candidate),
          ];
        }),
      ),
    );
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
      [variable.id]:
        current[variable.id] !== undefined
          ? current[variable.id]!
          : variable.options.map((option) => option.id),
    }));
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
      const id = savedTestId(candidate);
      const existing = currentMap.tests?.[id];
      if (!existing) {
        const now = Date.now();
        const rootScreenId =
          candidate.source === "group"
            ? [...candidate.group.screenIds].sort((left, right) => {
                const outgoing = (screenId: string) =>
                  Object.values(currentMap.connections).filter(
                    (connection) =>
                      connection.fromScreenId === screenId &&
                      connection.destination.kind === "screen" &&
                      candidate.group.screenIds.includes(connection.destination.screenId),
                  ).length;
                return outgoing(right) - outgoing(left);
              })[0]
            : undefined;
        const saved = await server.saveTest({
          appMapId: currentMap.id,
          expectedRevision: revision,
          test: {
            id,
            organizationId: currentMap.organizationId,
            projectId: currentMap.projectId,
            appMapId: currentMap.id,
            name: candidate.name,
            kind: candidate.kind,
            ...(candidate.source === "flow"
              ? { flowId: candidate.flow.id }
              : { rootScreenId, screenIds: [...candidate.group.screenIds] }),
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

  async function deleteModifier(variable: AppMapVariable) {
    const currentMap = map();
    if (!currentMap || busy()) return;
    const dependentMatrices = Object.values(currentMap.combines ?? {}).filter((combine) =>
      combine.variableIds.includes(variable.id),
    );
    confirmAction({
      title: `Delete ${variable.name}?`,
      body: dependentMatrices.length
        ? `Relay will remove this modifier from ${dependentMatrices.length} ${dependentMatrices.length === 1 ? "run matrix" : "run matrices"}. Tests and recorded paths remain.`
        : "The modifier will be removed. Tests and recorded paths remain.",
      confirmLabel: "Delete modifier",
      tone: "destructive",
      onConfirm: async () => {
        setBusy(true);
        try {
          let revision = currentMap.revision;
          for (const combine of dependentMatrices) {
            const nextCombine = combineWithoutVariable(combine, variable.id, Date.now());
            const result = nextCombine
              ? await server.saveCombine({
                  appMapId: currentMap.id,
                  expectedRevision: revision,
                  combine: nextCombine,
                })
              : await server.removeCombine({
                  appMapId: currentMap.id,
                  combineId: combine.id,
                  expectedRevision: revision,
                });
            revision = result.appMap.revision;
          }
          await server.removeVariable({
            appMapId: currentMap.id,
            variableId: variable.id,
            expectedRevision: revision,
          });
          await server.refreshAppMaps();
          setSelectedVariableIds((ids) => ids.filter((id) => id !== variable.id));
          setEditingModifierId(undefined);
          toast(`Deleted ${variable.name}`, "success");
        } catch (error) {
          toast(humanError(error, `Could not delete ${variable.name}`), "error");
        } finally {
          setBusy(false);
        }
      },
    });
  }

  function deleteMatrix() {
    const currentMap = map();
    const id = props.combineId?.trim();
    const existing = id ? currentMap?.combines[id] : undefined;
    if (!currentMap || !existing || busy()) return;
    confirmAction({
      title: `Delete ${existing.name}?`,
      body: "This removes the saved matrix from the canvas. Its modifiers, tests, and recorded paths remain.",
      confirmLabel: "Delete matrix",
      tone: "destructive",
      onConfirm: async () => {
        setBusy(true);
        try {
          await server.removeCombine({
            appMapId: currentMap.id,
            combineId: existing.id,
            expectedRevision: currentMap.revision,
          });
          await server.refreshAppMaps();
          toast(`Deleted ${existing.name}`, "success");
          props.onClose();
        } catch (error) {
          toast(humanError(error, `Could not delete ${existing.name}`), "error");
        } finally {
          setBusy(false);
        }
      },
    });
  }

  function selectedOptionIds(): Record<string, string[]> {
    return Object.fromEntries(
      selectedVariables().map((variable) => [variable.id, valuesFor(variable)]),
    );
  }

  async function persistMatrix(currentMap: NonNullable<ReturnType<typeof map>>) {
    const ensured = await ensureTests(currentMap);
    const variableIds = selectedVariables().map((variable) => variable.id);
    const selected = selectedOptionIds();
    const id = props.combineId?.trim() || matrixId(variableIds, ensured.testIds);
    const existing = currentMap.combines?.[id];
    const captures = Object.fromEntries(
      selectedTests().map((candidate, index) => [
        ensured.testIds[index]!,
        {
          mode: captureModes()[candidateKey(candidate)] ?? defaultCaptureMode(candidate),
        } satisfies AppMapCapturePolicy,
      ]),
    );
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
        selected,
        captures,
        strategy: strategy(),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      },
    });
    await server.refreshAppMaps();
    return { id, variableIds, selected };
  }

  async function saveMatrix() {
    const currentMap = map();
    if (!currentMap || runIssue() || busy()) return;
    setBusy(true);
    setSavingOnly(true);
    try {
      await persistMatrix(currentMap);
      toast(`Saved ${headline()} on the canvas`, "success");
      props.onClose();
    } catch (error) {
      toast(humanError(error, "Could not save this run matrix"), "error");
    } finally {
      setSavingOnly(false);
      setBusy(false);
    }
  }

  async function runMatrix(input?: { worldIndex: number; test: TestCandidate }) {
    const currentMap = map();
    if (!currentMap || runIssue()) {
      toast(runIssue() || "This run matrix is incomplete", "warning");
      return;
    }
    if (!canRunOnDevice()) {
      toast("Connect a ready device to run this matrix", "warning");
      return;
    }
    setBusy(true);
    try {
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
        await ensureTests(currentMap);
        const testId =
          input.test.source === "test"
            ? input.test.id
            : input.test.source === "flow"
              ? `flow-${input.test.flow.id}`
              : `group-${input.test.group.id}`;
        await server.runPathAcrossVariables({
          appMapId: currentMap.id,
          testId,
          capture: {
            mode: captureModes()[candidateKey(input.test)] ?? defaultCaptureMode(input.test),
          },
          variableIds,
          selected,
          strategy: "zip",
          title: `${projection().worlds[input.worldIndex]?.label ?? "State"} → ${input.test.name}`,
        });
      } else {
        const persisted = await persistMatrix(currentMap);
        await server.runPathAcrossVariables({
          appMapId: currentMap.id,
          combineId: persisted.id,
          variableIds: persisted.variableIds,
          selected: persisted.selected,
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
          when={!modifierEditorOpen()}
          fallback={
            <AppMapStateSetEditor
              variable={modifierBeingEdited()}
              onDelete={
                modifierBeingEdited()
                  ? () => void deleteModifier(modifierBeingEdited()!)
                  : undefined
              }
              onOpenDevice={props.onOpenDevice}
              onCancel={() => {
                setCreatingSet(false);
                setEditingModifierId(undefined);
              }}
              onSaved={(id) => {
                setCreatingSet(false);
                setEditingModifierId(undefined);
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
                    1. Choose modifiers
                  </h3>
                  <p class={cn(copyDescription, "m-0 text-[10.5px]")}>
                    A modifier changes one thing, then returns to the test start.
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditingModifierId(undefined);
                    setCreatingSet(true);
                  }}
                >
                  <Icon name="plus" size={12} /> New modifier
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
                        Create the first modifier
                      </strong>
                      <span class={cn(copyDescription, "block text-[10.5px]")}>
                        Teach Relay a language, account, theme, model, or another list.
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
                                  {valuesFor(variable).length} of {variable.options.length} values ·{" "}
                                  {modifierMethodLabel(variable)}
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
                            <Show
                              when={
                                variable.apply.kind === "list" ||
                                variable.apply.kind === "appLocale"
                              }
                            >
                              <button
                                type="button"
                                class="grid size-10 shrink-0 place-items-center rounded-[7px] text-[var(--text-weak)] hover:bg-[var(--surface-base-hover)] hover:text-[var(--text-strong)] focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
                                aria-label={`Edit ${variable.name} modifier`}
                                data-tip={`Edit ${variable.name}`}
                                onClick={() => {
                                  setCreatingSet(false);
                                  setEditingModifierId(variable.id);
                                }}
                              >
                                <Icon name="edit" size={12} />
                              </button>
                            </Show>
                          </div>
                          <Show when={editing()}>
                            <AppMapMatrixValuePicker
                              variable={variable}
                              selectedIds={valuesFor(variable)}
                              onChange={(ids) =>
                                setSelectedValues((current) => ({
                                  ...current,
                                  [variable.id]: ids,
                                }))
                              }
                            />
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
                    2. Multiply modifiers
                  </h3>
                  <p class={cn(copyDescription, "m-0 text-[10.5px]")}>
                    Choose whether every value meets every other value.
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
                  {selectedVariables().length > 1 ? "3" : "2"}. Choose tests
                </h3>
                <p class={cn(copyDescription, "m-0 text-[10.5px]")}>
                  Every selected test runs once for every modifier combination above.
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
                      const mode = () =>
                        captureModes()[candidateKey(candidate)] ?? defaultCaptureMode(candidate);
                      return (
                        <div
                          class={cn(
                            "flex min-h-11 items-center gap-2 rounded-[8px] px-2.5 text-left hover:bg-[var(--surface-base-hover)] focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]",
                            selected() && "bg-[var(--surface-base)]",
                          )}
                        >
                          <button
                            type="button"
                            class="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-[7px] text-left focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
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
                            <span class={cn(copyStack, "min-w-0 flex-1")}>
                              <strong
                                class={cn(copyTitle, "block truncate text-[11.5px] font-medium")}
                              >
                                {candidate.name}
                              </strong>
                              <span class={cn(copyDescription, "block text-[10px]")}>
                                {candidate.screenCount
                                  ? `${candidate.screenCount} mapped ${candidate.screenCount === 1 ? "screen" : "screens"}`
                                  : candidate.kind === "tour"
                                    ? "Visit mapped screens"
                                    : "Recorded path"}
                              </span>
                            </span>
                          </button>
                          <Show when={selected()}>
                            <label class="grid shrink-0 gap-0.5 text-[9px] font-medium text-[var(--text-weak)]">
                              Screenshots
                              <select
                                class="h-8 rounded-[7px] border border-[var(--border-weak-base)] bg-[var(--surface-raised-stronger-non-alpha)] px-2 text-[10.5px] text-[var(--text-base)] focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
                                value={mode()}
                                aria-label={`Screenshots for ${candidate.name}`}
                                onChange={(event) =>
                                  setCaptureModes((current) => ({
                                    ...current,
                                    [candidateKey(candidate)]: event.currentTarget
                                      .value as SimpleCaptureMode,
                                  }))
                                }
                              >
                                <option value="every-screen">Every screen</option>
                                <option value="final-screen">Final screen</option>
                                <option value="failures-only">Failures only</option>
                                <option value="none">None</option>
                              </select>
                            </label>
                          </Show>
                        </div>
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
                      Rows are modifier combinations. Columns are reusable tests.
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
                            Modifiers
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
                                      data-tip={
                                        canRunOnDevice()
                                          ? undefined
                                          : "Connect a ready device to run this check"
                                      }
                                      disabled={busy() || !canRunOnDevice()}
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

      <Show when={!modifierEditorOpen()}>
        <footer class="flex items-center justify-between gap-3 border-t border-[var(--border-weak-base)] px-4 py-3">
          <div class="flex min-w-0 items-center gap-2">
            <Show when={props.combineId && map()?.combines[props.combineId]}>
              <Button
                variant="ghost"
                size="sm"
                class="shrink-0 text-[var(--icon-critical-base)] hover:text-[var(--icon-critical-base)]"
                disabled={busy()}
                onClick={deleteMatrix}
              >
                <Icon name="trash" size={11} /> Delete
              </Button>
            </Show>
            <span class="min-w-0 truncate text-[10.5px] text-[var(--text-weak)]">
              {projection().totalWorlds || 0} combinations × {selectedTests().length} tests
            </span>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <Button
              variant="secondary"
              size="lg"
              disabled={busy() || Boolean(runIssue())}
              onClick={() => void saveMatrix()}
            >
              {savingOnly() ? "Saving…" : "Save"}
            </Button>
            <Button
              variant="primary"
              size="lg"
              data-tip={canRunOnDevice() ? undefined : "Connect a ready device to run this matrix"}
              disabled={busy() || Boolean(runIssue()) || !canRunOnDevice()}
              onClick={() => void runMatrix()}
            >
              <Icon name="play" size={12} />
              {busy() && !savingOnly()
                ? "Starting…"
                : projection().cellCount
                  ? `Run ${projection().cellCount} ${projection().cellCount === 1 ? "check" : "checks"}`
                  : "Run matrix"}
            </Button>
          </div>
        </footer>
      </Show>
    </section>
  );
}
