import { Show, createEffect, createMemo, createSignal, onMount } from "solid-js";
import type {
  AppMapCapturePolicy,
  AppMapCombinePreflight,
  AppMapVariable,
  CaseExpansionStrategy,
} from "@relay/protocol";
import { useServer } from "../context/server";
import { toast } from "../context/toast";
import { humanError } from "../lib/human-error";
import { targetIsReady } from "../lib/target-presentation";
import {
  combineHeadline,
  combineSubhead,
  combineValueLabel,
  projectCombine,
} from "../lib/app-map-combine-presentation";
import { combineWithoutVariable, initialCombineDraft } from "../lib/app-map-combine-edit";
import { matrixId, savedTestId, testCandidates } from "../lib/app-map-combine-candidates";
import type { CanvasCombineSection } from "../lib/app-map-combine-canvas";
import { confirmAction } from "./confirm-dialog";
import { AppMapCombinePreflightSummary } from "./app-map-combine-preflight";
import {
  AppMapCombinePlan,
  AppMapCombineFooter,
  AppMapCombineHeader,
  candidateKey,
  defaultCaptureMode,
  type SimpleCaptureMode,
  type TestCandidate,
} from "./app-map-combine-controls";
import { AppMapStateSetEditor } from "./app-map-state-set-editor";
import { Icon } from "./icon";
import { useAppMapCombineSectionFocus } from "../lib/use-app-map-combine-section-focus";

const [MAX_DEVICE_WORLDS, MAX_PREVIEW_WORLDS] = [250, 40];
export function AppMapCombine(props: {
  onClose: () => void;
  onOpenDevice: () => void;
  combineId?: string;
  focusSection?: CanvasCombineSection;
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
  const [preflight, setPreflight] = createSignal<AppMapCombinePreflight>();
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
    return current ? testCandidates(current) : [];
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

  const observeScrollArea = useAppMapCombineSectionFocus({
    section: () => props.focusSection,
    editorOpen: modifierEditorOpen,
  });

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
      MAX_PREVIEW_WORLDS,
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
          return mode !== "every-screen";
        })
          ? projection().totalWorlds *
            selectedTests().reduce((total, test) => {
              const mode = captureModes()[candidateKey(test)] ?? defaultCaptureMode(test);
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
    const initial = initialCombineDraft(
      existing,
      current.variables,
      candidates()
        .filter((candidate) => candidate.source === "test")
        .map((candidate) => candidate.id),
    );
    setSelectedVariableIds(initial.variableIds);
    setSelectedValues(initial.selected);
    setSelectedTestKeys(
      initial.testIds
        .map((id) =>
          candidates().find((candidate) => candidate.source === "test" && candidate.id === id),
        )
        .filter((candidate): candidate is TestCandidate => Boolean(candidate))
        .map(candidateKey),
    );
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

  createEffect(() => {
    const current = map();
    const id = props.combineId?.trim();
    if (!current || !id || !current.combines[id]) {
      setPreflight();
      return;
    }
    const revision = current.revision;
    const serial = server.selectedDevice() || undefined;
    void server
      .preflightCombine({ appMapId: current.id, combineId: id, serial })
      .then((result) => {
        if (map()?.revision === revision && props.combineId?.trim() === id) setPreflight(result);
      })
      .catch(() => setPreflight());
  });

  createEffect(() => {
    selectedVariableIds();
    selectedValues();
    selectedTestKeys();
    captureModes();
    strategy();
    setPreflight();
  });

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

  function selectedTestIds(): string[] {
    return selectedTests().map(savedTestId);
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
        ? `Relay will remove this modifier from ${dependentMatrices.length} ${dependentMatrices.length === 1 ? "run matrix" : "run matrices"}. Tests and map evidence remain.`
        : "The modifier will be removed. Tests and map evidence remain.",
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
      body: "This removes the saved matrix from the canvas. Its modifiers, Tests, and map evidence remain.",
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
    const testIds = selectedTestIds();
    const variableIds = selectedVariables().map((variable) => variable.id);
    const selected = selectedOptionIds();
    const id = props.combineId?.trim() || matrixId(variableIds, testIds);
    const existing = currentMap.combines?.[id];
    const captures = Object.fromEntries(
      selectedTests().map((candidate, index) => [
        testIds[index]!,
        {
          mode: captureModes()[candidateKey(candidate)] ?? defaultCaptureMode(candidate),
        } satisfies AppMapCapturePolicy,
      ]),
    );
    const now = Date.now();
    await server.saveCombine({
      appMapId: currentMap.id,
      expectedRevision: currentMap.revision,
      combine: {
        id,
        organizationId: currentMap.organizationId,
        projectId: currentMap.projectId,
        appMapId: currentMap.id,
        name: headline(),
        variableIds,
        testIds,
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
        const testId = input.test.id;
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
        const checked = await server.preflightCombine({
          appMapId: currentMap.id,
          combineId: persisted.id,
          serial: server.selectedDevice() || undefined,
        });
        setPreflight(checked);
        if (!checked.ok) {
          toast(checked.blockers[0]?.message ?? "This run matrix is not ready", "warning");
          return;
        }
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
      window.dispatchEvent(new CustomEvent("relay:open-device-panel"));
    } catch (error) {
      toast(humanError(error, "Could not start this run matrix"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section class="flex min-h-0 w-full flex-1 flex-col" aria-label="Run matrix">
      <AppMapCombineHeader headline={headline()} subhead={subhead()} onClose={props.onClose} />

      <div
        ref={observeScrollArea}
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
            <AppMapCombinePlan
              variables={variables()}
              selectedVariableIds={selectedVariableIds()}
              selectedVariables={selectedVariables()}
              valuesFor={valuesFor}
              editingValuesFor={editingValuesFor()}
              candidates={candidates()}
              selectedTestKeys={selectedTestKeys()}
              selectedTests={selectedTests()}
              captureModes={captureModes()}
              strategy={strategy()}
              projection={projection()}
              busy={busy()}
              canRunOnDevice={canRunOnDevice()}
              onCreateModifier={() => {
                setEditingModifierId(undefined);
                setCreatingSet(true);
              }}
              onEditModifier={(id) => {
                setCreatingSet(false);
                setEditingModifierId(id);
              }}
              onToggleVariable={toggleVariable}
              onToggleValues={setEditingValuesFor}
              onValuesChange={(variableId, ids) =>
                setSelectedValues((current) => ({ ...current, [variableId]: ids }))
              }
              onStrategyChange={setStrategy}
              onToggleTest={toggleTest}
              onCaptureModeChange={(candidate, mode) =>
                setCaptureModes((current) => ({
                  ...current,
                  [candidateKey(candidate)]: mode,
                }))
              }
              onRunCell={(worldIndex, test) => void runMatrix({ worldIndex, test })}
            />

            <Show when={runIssue()}>
              <p class="m-0 flex items-start gap-2 rounded-lg bg-[var(--surface-base)] px-2.5 py-2 text-micro/[1.4] text-[var(--text-base)]">
                <Icon name="info" size={12} class="mt-0.5 shrink-0" /> {runIssue()}
              </p>
            </Show>
            <Show when={preflight()}>
              {(value) => <AppMapCombinePreflightSummary preflight={value()} />}
            </Show>
          </div>
        </Show>
      </div>

      <Show when={!modifierEditorOpen()}>
        <AppMapCombineFooter
          canDelete={Boolean(props.combineId && map()?.combines[props.combineId])}
          combinations={projection().totalWorlds || 0}
          testCount={selectedTests().length}
          cellCount={projection().cellCount}
          canRunOnDevice={canRunOnDevice()}
          issue={runIssue()}
          busy={busy()}
          savingOnly={savingOnly()}
          onDelete={deleteMatrix}
          onSave={() => void saveMatrix()}
          onRun={() => void runMatrix()}
        />
      </Show>
    </section>
  );
}
