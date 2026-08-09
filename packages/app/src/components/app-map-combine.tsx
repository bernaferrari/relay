import { For, Show, createEffect, createMemo, createSignal, onMount } from "solid-js";
import type { AppMapVariableKind } from "@relay/protocol";
import { Button } from "@relay/ui/button";
import { useServer } from "../context/server";
import { toast } from "../context/toast";
import { humanError } from "../lib/human-error";
import {
  assignableSwitcherConnections,
  localeLoopBodyFlowId,
  taughtExampleFromSnapshotNode,
  teachableLocaleRows,
} from "../lib/app-map-locale-teach";
import {
  combineHeadline,
  combineSubhead,
  combineValueLabel,
  type CombineTestColumn,
  type CombineValue,
} from "../lib/app-map-combine-presentation";
import { Icon } from "./icon";

const KINDS: Array<{ id: AppMapVariableKind; label: string }> = [
  { id: "language", label: "Language" },
  { id: "location", label: "Location" },
  { id: "theme", label: "Theme" },
  { id: "account", label: "Account" },
  { id: "custom", label: "Custom" },
];

/**
 * Run with data: repeat one saved test for each value in a visible list. The
 * persisted domain entity is still a Combine, but people should not need that
 * internal noun to understand what will happen.
 */
export function AppMapCombine(props: {
  onClose: () => void;
  onOpenDevice: () => void;
  combineId?: string;
}) {
  const server = useServer();
  const [kind, setKind] = createSignal<AppMapVariableKind>("language");
  const [inConnectionId, setInConnectionId] = createSignal("");
  const [outConnectionId, setOutConnectionId] = createSignal("");
  const [workFlowId, setWorkFlowId] = createSignal("");
  const [selectedTestId, setSelectedTestId] = createSignal("");
  const [exampleA, setExampleA] = createSignal("");
  const [exampleB, setExampleB] = createSignal("");
  const [labelA, setLabelA] = createSignal("");
  const [labelB, setLabelB] = createSignal("");
  const [idA, setIdA] = createSignal("");
  const [idB, setIdB] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [readingList, setReadingList] = createSignal(false);
  const [liveRows, setLiveRows] = createSignal<
    Array<{ identifier?: string; label?: string; value?: string }>
  >([]);
  const [pickedA, setPickedA] = createSignal(false);
  const [pickedB, setPickedB] = createSignal(false);
  const [showHow, setShowHow] = createSignal(false);
  const [showOptions, setShowOptions] = createSignal(false);
  const [showTeach, setShowTeach] = createSignal(false);
  const [draftSet, setDraftSet] = createSignal<{
    id: string;
    name: string;
    kind: string;
    apply: {
      kind: string;
      inConnectionId?: string;
      outConnectionId?: string;
      entryPath?: unknown[];
      pickerPath?: unknown[];
    };
    options: Array<{ id: string; identifier?: string; label?: string; text?: string }>;
  } | null>(null);
  const [selectedIds, setSelectedIds] = createSignal<string[]>([]);
  const [activeSetId, setActiveSetId] = createSignal("");

  const map = createMemo(() => server.selectedAppMap());
  createEffect(() => {
    const id = props.combineId?.trim();
    const combine = id ? map()?.combines?.[id] : undefined;
    if (!combine) return;
    if (combine.variableIds[0]) setActiveSetId(combine.variableIds[0]);
    if (combine.testIds[0]) setSelectedTestId(combine.testIds[0]);
  });
  const connections = createMemo(() => {
    const current = map();
    return current ? assignableSwitcherConnections(current) : [];
  });
  const workFlows = createMemo(() => {
    const current = map();
    if (!current) return [];
    return Object.values(current.flows).filter((flow) => flow.connectionIds.length > 0);
  });
  const tests = createMemo(() => Object.values(map()?.tests ?? {}));
  const selectedTest = createMemo(
    () => tests().find((work) => work.id === selectedTestId()) ?? tests()[0],
  );
  const bodyFlow = createMemo(() => {
    const current = map();
    if (!current) return undefined;
    const chosen = workFlowId().trim();
    if (chosen && current.flows[chosen]) return current.flows[chosen];
    const skip = new Set([inConnectionId(), outConnectionId()].filter(Boolean));
    const id = localeLoopBodyFlowId(current, [...skip][0]);
    return id ? current.flows[id] : undefined;
  });
  const savedSets = createMemo(() => Object.values(map()?.variables ?? {}));
  const activeSet = createMemo(() => {
    const draft = draftSet();
    if (draft && (!activeSetId() || activeSetId() === draft.id)) return draft;
    return (
      savedSets().find((set) => set.id === activeSetId()) ??
      savedSets().find((set) => set.kind === kind()) ??
      savedSets()[0] ??
      draft
    );
  });
  const selectedOptionIds = createMemo(() => {
    const chosen = selectedIds();
    if (chosen.length) return chosen;
    return activeSet()?.options.map((option) => option.id) ?? [];
  });
  const combinationCount = createMemo(() => selectedOptionIds().length);
  const canRunTest = createMemo(() => Boolean(selectedTest() || bodyFlow()));
  const variableLabel = createMemo(() => activeSet()?.name || kind());
  const matrixValues = createMemo((): CombineValue[] => {
    const set = activeSet();
    if (!set) return [];
    const selected = new Set(selectedOptionIds());
    return set.options
      .filter((option) => selected.has(option.id))
      .map((option) => ({ id: option.id, label: combineValueLabel(option) }));
  });
  const matrixTests = createMemo((): CombineTestColumn[] => {
    const test = selectedTest();
    if (test) {
      return [{ id: test.id, name: test.name, kind: test.kind === "tour" ? "tour" : "path" }];
    }
    const flow = bodyFlow();
    if (flow) return [{ id: flow.id, name: flow.name, kind: "path" }];
    return [];
  });
  const headline = createMemo(() =>
    combineHeadline({
      variableName: activeSet() ? variableLabel() : undefined,
      testName: matrixTests()[0]?.name,
      cellCount: matrixValues().length * Math.max(1, matrixTests().length),
    }),
  );
  const subhead = createMemo(() =>
    combineSubhead({
      cellCount: matrixValues().length * matrixTests().length,
      hasVariable: Boolean(activeSet()?.options.length),
      hasTest: matrixTests().length > 0,
    }),
  );

  async function refreshLiveRows() {
    setReadingList(true);
    try {
      const snap = await server.captureUiSnapshot();
      setLiveRows(teachableLocaleRows(snap?.nodes ?? []));
    } finally {
      setReadingList(false);
    }
  }

  onMount(() => {
    const flow = workFlows()[0];
    if (flow) setWorkFlowId(flow.id);
    const firstTest = tests()[0];
    if (firstTest) setSelectedTestId(firstTest.id);
    const firstSet = savedSets()[0];
    if (firstSet) {
      setActiveSetId(firstSet.id);
      setSelectedIds(firstSet.options.map((option) => option.id));
      if (KINDS.some((item) => item.id === firstSet.kind)) {
        setKind(firstSet.kind as AppMapVariableKind);
      }
    }
  });

  function pickLiveRow(row: { identifier?: string; label?: string; value?: string }) {
    const example = taughtExampleFromSnapshotNode(row);
    if (!pickedA()) {
      setExampleA(example.locale);
      setLabelA(example.label ?? "");
      setIdA(example.identifier ?? "");
      setPickedA(true);
      return;
    }
    setExampleB(example.locale);
    setLabelB(example.label ?? "");
    setIdB(example.identifier ?? "");
    setPickedB(true);
  }

  function useSavedSet(id: string) {
    const set = savedSets().find((item) => item.id === id);
    if (!set) return;
    setActiveSetId(id);
    setDraftSet(null);
    setSelectedIds(set.options.map((option) => option.id));
    if (KINDS.some((item) => item.id === set.kind)) setKind(set.kind as AppMapVariableKind);
  }

  async function inferFromScreen() {
    setBusy(true);
    try {
      const snap = await server.captureUiSnapshot();
      if (!snap?.nodes?.length) {
        toast("Show the list on the device, then infer again", "warning");
        return;
      }
      setLiveRows(teachableLocaleRows(snap.nodes));
      const examples = [
        {
          id: exampleA().trim(),
          ...(idA().trim() ? { identifier: idA().trim() } : {}),
          ...(labelA().trim() ? { label: labelA().trim() } : {}),
        },
        {
          id: exampleB().trim(),
          ...(idB().trim() ? { identifier: idB().trim() } : {}),
          ...(labelB().trim() ? { label: labelB().trim() } : {}),
        },
      ].filter((example) => example.id);
      if (!examples.length) {
        toast("Tap one or two rows on the live list first", "warning");
        return;
      }
      const currentMap = map();
      const result = await server.inferVariableFromDevice(snap.nodes, examples, {
        kind: kind(),
        appMapId: currentMap?.id,
        ...(inConnectionId() ? { inConnectionId: inConnectionId() } : {}),
        ...(outConnectionId() ? { outConnectionId: outConnectionId() } : {}),
      });
      setDraftSet(result.variable);
      setActiveSetId(result.variable.id);
      setSelectedIds(result.variable.options.map((option) => option.id));
      const now = Date.now();
      if (currentMap) {
        await server.saveVariable({
          appMapId: currentMap.id,
          expectedRevision: currentMap.revision,
          variable: {
            ...result.variable,
            organizationId: currentMap.organizationId,
            projectId: currentMap.projectId,
            appMapId: currentMap.id,
            createdAt: now,
            updatedAt: now,
          },
        });
      }
      toast(`Saved ${result.variable.options.length} ${kind()} values`, "success");
    } catch (error) {
      toast(humanError(error, "Could not read this list"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function runTest(input: { optionIds?: string[]; testId?: string } = {}) {
    const currentMap = map();
    const test =
      (input.testId ? tests().find((item) => item.id === input.testId) : undefined) ??
      selectedTest();
    const flow = bodyFlow();
    if (!currentMap || (!test && !flow)) {
      toast("Record a path on the map first", "warning");
      return;
    }
    const primary = activeSet();
    const optionIds = input.optionIds ?? selectedOptionIds();
    if (!primary) {
      toast("Add a list of values first", "warning");
      return;
    }
    if (optionIds.length < 1) {
      toast("Select at least one value", "warning");
      return;
    }
    setBusy(true);
    try {
      const valueLabel =
        optionIds.length === 1
          ? combineValueLabel(
              primary?.options.find((option) => option.id === optionIds[0]) ?? {
                id: optionIds[0]!,
              },
            )
          : primary?.name;
      let combineId: string | undefined;
      if (test && optionIds.length > 1) {
        const now = Date.now();
        combineId = `${primary.id}-x-${test.id}`;
        const existing = currentMap.combines?.[combineId];
        await server.saveCombine({
          appMapId: currentMap.id,
          expectedRevision: currentMap.revision,
          combine: {
            id: combineId,
            organizationId: currentMap.organizationId,
            projectId: currentMap.projectId,
            appMapId: currentMap.id,
            name: `${primary.name} × ${test.name}`,
            variableIds: [primary.id],
            testIds: [test.id],
            strategy: "zip",
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
          },
        });
        await server.refreshAppMaps();
      }
      await server.runPathAcrossVariables({
        appMapId: currentMap.id,
        ...(combineId ? { combineId } : test ? { testId: test.id } : { flowId: flow!.id }),
        variableIds: [primary.id],
        selected: { [primary.id]: optionIds },
        strategy: "zip",
        title: `${valueLabel} × ${test?.name ?? flow!.name}`,
      });
      props.onClose();
    } catch (error) {
      toast(humanError(error, "Could not start the run"), "error");
    } finally {
      setBusy(false);
    }
  }

  function toggleOption(id: string) {
    setSelectedIds((current) => {
      const base = current.length
        ? current
        : (activeSet()?.options.map((option) => option.id) ?? []);
      return base.includes(id) ? base.filter((item) => item !== id) : [...base, id];
    });
  }

  const showSetup = createMemo(
    () => !matrixValues().length || !matrixTests().length || showTeach() || showOptions(),
  );

  return (
    <section class="grid gap-4" aria-label="Run paths with data">
      <header class="flex items-start justify-between gap-3">
        <div>
          <p class="m-0 text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-weaker)]">
            Run with data
          </p>
          <h2 class="m-0 mt-1 text-[16px] font-semibold tracking-[-0.02em] text-[var(--text-strong)]">
            {headline()}
          </h2>
          <p class="m-0 mt-1 max-w-[52ch] text-[12.5px]/[1.45] text-[var(--text-weak)]">
            {subhead()}
          </p>
        </div>
        <button
          type="button"
          class="grid size-11 place-items-center rounded-[8px] text-[var(--text-weak)] hover:bg-[var(--surface-base-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
          aria-label="Close data runs"
          onClick={props.onClose}
        >
          <Icon name="x" size={14} />
        </button>
      </header>

      <Show when={matrixValues().length > 0 && matrixTests().length > 0}>
        <div class="overflow-auto rounded-[10px] border border-[var(--border-weak-base)]">
          <table class="w-full min-w-[320px] border-collapse text-left">
            <caption class="sr-only">
              Each run uses one {variableLabel().toLocaleLowerCase()} value
            </caption>
            <thead>
              <tr class="border-b border-[var(--border-weak-base)] bg-[var(--surface-base)]">
                <th class="sticky left-0 px-3 py-2 text-[11px] font-semibold text-[var(--text-weaker)]">
                  {variableLabel()}
                </th>
                <For each={matrixTests()}>
                  {(test) => (
                    <th class="px-3 py-2 text-[11px] font-semibold text-[var(--text-weaker)]">
                      {test.name}
                    </th>
                  )}
                </For>
              </tr>
            </thead>
            <tbody>
              <For each={matrixValues()}>
                {(value) => (
                  <tr class="border-b border-[var(--border-weak-base)] last:border-b-0">
                    <th class="sticky left-0 bg-[var(--background-base)] px-3 py-1.5 text-[13px] font-medium text-[var(--text-strong)]">
                      {value.label}
                    </th>
                    <For each={matrixTests()}>
                      {(test) => (
                        <td class="px-2 py-1.5">
                          <button
                            type="button"
                            class="inline-flex min-h-10 min-w-10 items-center justify-center gap-1 rounded-[8px] px-2.5 text-[12px] font-medium text-[var(--text-interactive-base)] hover:bg-[var(--product-accent-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--border-focus)] disabled:opacity-40"
                            disabled={busy()}
                            aria-label={`Run ${test.name} in ${value.label}`}
                            onClick={() =>
                              void runTest({
                                optionIds: [value.id],
                                testId: tests().some((item) => item.id === test.id)
                                  ? test.id
                                  : undefined,
                              })
                            }
                          >
                            <Icon name="play" size={12} />
                            Run
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

      <Show when={combinationCount() > 1}>
        <div class="flex justify-end">
          <Button
            variant="primary"
            disabled={busy() || !canRunTest()}
            onClick={() => void runTest()}
          >
            <Icon name="play" size={13} />
            Run all {combinationCount()}
          </Button>
        </div>
      </Show>

      <section class="grid gap-2.5" aria-labelledby="combine-variable">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3
            id="combine-variable"
            class="m-0 text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-weaker)]"
          >
            Repeat with
          </h3>
          <Show when={savedSets().length && !showSetup()}>
            <button
              type="button"
              class="min-h-11 text-[12px] text-[var(--text-interactive-base)] underline-offset-2 hover:underline"
              onClick={() => setShowOptions(true)}
            >
              Edit values
            </button>
          </Show>
        </div>
        <Show when={showSetup()}>
          <>
            <Show when={savedSets().length}>
              <div class="flex flex-wrap gap-1.5">
                <For each={savedSets()}>
                  {(set) => (
                    <button
                      type="button"
                      class="inline-flex min-h-11 items-center rounded-[8px] border px-2.5 text-[12px]"
                      classList={{
                        "border-[var(--text-interactive-base)] bg-[var(--product-accent-soft)]":
                          activeSet()?.id === set.id,
                        "border-[var(--border-weak-base)] bg-[var(--surface-base)] hover:bg-[var(--surface-base-hover)]":
                          activeSet()?.id !== set.id,
                      }}
                      aria-pressed={activeSet()?.id === set.id}
                      onClick={() => useSavedSet(set.id)}
                    >
                      {set.name}
                      <span class="ml-1 tabular-nums text-[var(--text-weak)]">
                        {set.options.length}
                      </span>
                    </button>
                  )}
                </For>
              </div>
              <div class="flex flex-wrap gap-x-3 gap-y-1">
                <button
                  type="button"
                  class="min-h-11 text-[12px] text-[var(--text-interactive-base)] underline-offset-2 hover:underline"
                  onClick={() => setShowOptions((open) => !open)}
                >
                  {showOptions()
                    ? "Hide values"
                    : `${selectedOptionIds().length} selected — change`}
                </button>
                <button
                  type="button"
                  class="min-h-11 text-[12px] text-[var(--text-interactive-base)] underline-offset-2 hover:underline"
                  onClick={() => setShowTeach((open) => !open)}
                >
                  {showTeach() ? "Hide new list" : "Teach a new list"}
                </button>
              </div>
            </Show>
            <Show when={!savedSets().length && !showTeach()}>
              <div class="grid gap-2 rounded-[9px] border border-[var(--border-weak-base)] p-3">
                <div>
                  <strong class="block text-[12.5px] font-medium text-[var(--text-strong)]">
                    Add a device list
                  </strong>
                  <p class="m-0 mt-1 text-[11px]/[1.45] text-[var(--text-weak)]">
                    Use a list already visible on the device, such as languages, models, or themes.
                  </p>
                </div>
                <div class="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={props.onOpenDevice}>
                    <Icon name="smartphone" size={12} /> Open device
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={readingList()}
                    onClick={() => {
                      setShowTeach(true);
                      void refreshLiveRows();
                    }}
                  >
                    <Icon
                      name={readingList() ? "refresh" : "scan"}
                      size={12}
                      class={readingList() ? "ui-refresh-spin" : undefined}
                    />
                    {readingList() ? "Reading…" : "Read current list"}
                  </Button>
                </div>
              </div>
            </Show>
            <Show when={showTeach()}>
              <p class="m-0 text-[12.5px] text-[var(--text-weak)]">
                Choose one or two rows. Relay uses them to recognize the rest of the list.
              </p>
              <label class="grid gap-1">
                <span class="text-[11px] font-medium text-[var(--text-weak)]">List type</span>
                <select
                  class="h-10 rounded-[8px] border border-[var(--border-weak-base)] bg-[var(--surface-base)] px-2.5 text-[13px]"
                  value={kind()}
                  onChange={(event) => setKind(event.currentTarget.value as AppMapVariableKind)}
                >
                  <For each={KINDS}>{(item) => <option value={item.id}>{item.label}</option>}</For>
                </select>
              </label>
              <Show when={liveRows().length}>
                <div class="flex flex-wrap gap-1.5">
                  <For each={liveRows()}>
                    {(row) => {
                      const picked =
                        (pickedA() &&
                          ((idA() && idA() === row.identifier) ||
                            (labelA() && labelA() === (row.label || row.value)))) ||
                        (pickedB() &&
                          ((idB() && idB() === row.identifier) ||
                            (labelB() && labelB() === (row.label || row.value))));
                      return (
                        <button
                          type="button"
                          class="inline-flex min-h-11 max-w-full items-center rounded-[8px] border px-2.5 text-left text-[12px]"
                          classList={{
                            "border-[var(--text-interactive-base)] bg-[var(--product-accent-soft)]":
                              Boolean(picked),
                            "border-[var(--border-weak-base)] bg-[var(--surface-base)] hover:bg-[var(--surface-base-hover)]":
                              !picked,
                          }}
                          aria-pressed={Boolean(picked)}
                          onClick={() => pickLiveRow(row)}
                        >
                          <span class="truncate">{row.label}</span>
                        </button>
                      );
                    }}
                  </For>
                </div>
              </Show>
              <Show when={!readingList() && !liveRows().length}>
                <p class="m-0 rounded-[8px] bg-[var(--surface-base)] px-2.5 py-2 text-[11px] text-[var(--text-weak)]">
                  No list rows found. Open the list on the device, then try again.
                </p>
              </Show>
              <div class="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={readingList()}
                  onClick={() => void refreshLiveRows()}
                >
                  <Icon
                    name="refresh"
                    size={12}
                    class={readingList() ? "ui-refresh-spin" : undefined}
                  />
                  {readingList() ? "Reading…" : "Read again"}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={busy() || (!pickedA() && !pickedB())}
                  onClick={() => void inferFromScreen()}
                >
                  <Icon name="scan" size={13} />
                  {busy() ? "Creating…" : "Create list"}
                </Button>
              </div>
            </Show>
            <Show when={activeSet()?.options.length && (!savedSets().length || showOptions())}>
              <ul class="m-0 grid max-h-40 list-none gap-0.5 overflow-auto p-0">
                <For each={activeSet()!.options}>
                  {(option) => (
                    <li>
                      <label class="flex min-h-10 items-center gap-2 rounded-[8px] px-2 hover:bg-[var(--surface-base)]">
                        <input
                          type="checkbox"
                          checked={selectedOptionIds().includes(option.id)}
                          onChange={() => toggleOption(option.id)}
                        />
                        <span class="text-[13px] text-[var(--text-strong)]">
                          {option.label || option.id}
                        </span>
                      </label>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
            <Show when={showTeach()}>
              <button
                type="button"
                class="justify-self-start text-[12px] text-[var(--text-interactive-base)] underline-offset-2 hover:underline"
                onClick={() => setShowHow((open) => !open)}
              >
                {showHow() ? "Hide setup paths" : "Set up switching paths"}
              </button>
              <Show when={showHow()}>
                <div class="grid gap-2">
                  <label class="grid gap-1">
                    <span class="text-[11px] font-medium text-[var(--text-weak)]">
                      Path that opens the list
                    </span>
                    <select
                      class="h-11 rounded-[8px] border border-[var(--border-weak-base)] bg-[var(--surface-base)] px-2.5 text-[13px]"
                      value={inConnectionId()}
                      onChange={(event) => setInConnectionId(event.currentTarget.value)}
                    >
                      <option value="">None</option>
                      <For each={connections()}>
                        {(item) => <option value={item.id}>{item.label}</option>}
                      </For>
                    </select>
                  </label>
                  <label class="grid gap-1">
                    <span class="text-[11px] font-medium text-[var(--text-weak)]">
                      Path after switching
                    </span>
                    <select
                      class="h-11 rounded-[8px] border border-[var(--border-weak-base)] bg-[var(--surface-base)] px-2.5 text-[13px]"
                      value={outConnectionId()}
                      onChange={(event) => setOutConnectionId(event.currentTarget.value)}
                    >
                      <option value="">Stay on this screen</option>
                      <For each={connections()}>
                        {(item) => <option value={item.id}>{item.label}</option>}
                      </For>
                    </select>
                  </label>
                </div>
              </Show>
            </Show>
          </>
        </Show>
      </section>

      <Show when={tests().length > 1 || (!tests().length && workFlows().length > 1)}>
        <section
          class="grid gap-2.5 rounded-[10px] border border-[var(--border-weak-base)] bg-[var(--surface-base)] p-3"
          aria-labelledby="combine-test"
        >
          <h3
            id="combine-test"
            class="m-0 text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-weaker)]"
          >
            Path to repeat
          </h3>
          <Show
            when={tests().length}
            fallback={
              <select
                aria-label="Path to repeat"
                class="h-11 rounded-[8px] border border-[var(--border-weak-base)] bg-[var(--background-base)] px-2.5 text-[13px]"
                value={bodyFlow()?.id ?? ""}
                onChange={(event) => setWorkFlowId(event.currentTarget.value)}
              >
                <For each={workFlows()}>
                  {(flow) => <option value={flow.id}>{flow.name}</option>}
                </For>
              </select>
            }
          >
            <ul class="m-0 grid list-none gap-1 p-0">
              <For each={tests()}>
                {(work) => (
                  <li>
                    <label class="flex min-h-11 items-center gap-2 rounded-[8px] px-1">
                      <input
                        type="radio"
                        name="combine-test"
                        checked={selectedTest()?.id === work.id}
                        onChange={() => setSelectedTestId(work.id)}
                      />
                      <span class="text-[13px] text-[var(--text-strong)]">
                        {work.name}
                        <span class="text-[var(--text-weak)]">
                          {work.kind === "tour" ? " · visit every row" : " · recorded path"}
                        </span>
                      </span>
                    </label>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </section>
      </Show>
    </section>
  );
}
