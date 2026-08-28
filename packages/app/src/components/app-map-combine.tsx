import { Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type {
  AppMapCombineCellRuntimeProfile,
  AppMapCombinePreflight,
  AppMapVariable,
  CaseExpansionStrategy,
  CombineCampaign,
} from "@relay/protocol";
import {
  bindingForCell,
  mapRuntimeProfileOptions,
  upsertCellRuntimeProfile,
} from "../lib/app-map-combine-profiles";
import { createAppMapCombineLocalAdmission } from "../lib/use-app-map-combine-local-admission";
import { createAppMapCombineCampaignActions } from "../lib/use-app-map-combine-campaign-actions";
import { useServer } from "../context/server";
import { toast } from "../context/toast";
import { humanError } from "../lib/human-error";
import { targetIsReady } from "../lib/target-presentation";
import {
  combineCells,
  combineHeadline,
  combineSubhead,
  combineValueLabel,
  projectCombine,
} from "../lib/app-map-combine-presentation";
import { combineWithoutVariable, initialCombineDraft } from "../lib/app-map-combine-edit";
import { savedTestId, testCandidates } from "../lib/app-map-combine-candidates";
import { buildCombineForPersistence } from "../lib/app-map-combine-persistence";
import type { CanvasCombineSection } from "../lib/app-map-combine-canvas";
import { confirmAction } from "./confirm-dialog";
import {
  AppMapCombinePlan,
  AppMapCombineFooter,
  AppMapCombineHeader,
  candidateKey,
  defaultCaptureMode,
  type SimpleCaptureMode,
  type TestCandidate,
} from "./app-map-combine-controls";
import { AppMapVariableEditor } from "./app-map-variable-editor";
import { useAppMapCombineSectionFocus } from "../lib/use-app-map-combine-section-focus";
import { AppMapCombineRunStatus } from "./app-map-combine-run-status";

const [MAX_DEVICE_WORLDS, MAX_PREVIEW_WORLDS] = [250, 40];
const campaignStorageKey = (map: string, grid: string) => `relay:combine-campaign:${map}:${grid}`;
export function AppMapCombine(props: {
  onClose: () => void;
  onOpenDevice: () => void;
  combineId?: string;
  focusSection?: CanvasCombineSection;
  collapsed?: boolean;
  onOpenRun: (runId?: string) => void;
}) {
  const server = useServer();
  const [selectedVariableIds, setSelectedVariableIds] = createSignal<string[]>([]);
  const [selectedValues, setSelectedValues] = createSignal<Record<string, string[]>>({});
  const [selectedTestKeys, setSelectedTestKeys] = createSignal<string[]>([]);
  const [captureModes, setCaptureModes] = createSignal<Record<string, SimpleCaptureMode>>({});
  const [strategy, setStrategy] = createSignal<CaseExpansionStrategy>("cartesian");
  const [editingValuesFor, setEditingValuesFor] = createSignal<string>();
  const [creatingSet, setCreatingSet] = createSignal(false);
  const [editingVariableId, setEditingVariableId] = createSignal<string>();
  const [busy, setBusy] = createSignal(false);
  const [savingOnly, setSavingOnly] = createSignal(false);
  const [preflight, setPreflight] = createSignal<AppMapCombinePreflight>();
  const [campaign, setCampaign] = createSignal<CombineCampaign>();
  const [campaignId, setCampaignId] = createSignal<string>();
  const [pilotJobId, setPilotJobId] = createSignal<string>();
  const [campaignReviewed, setCampaignReviewed] = createSignal(false);
  const [cellRuntimeProfiles, setCellRuntimeProfiles] = createSignal<
    AppMapCombineCellRuntimeProfile[]
  >([]);
  let initializedFor = "";
  const map = createMemo(() => server.selectedAppMap());
  const selectedDevice = () =>
    server.devices().find((device) => device.serial === server.selectedDevice());
  const canRunOnDevice = createMemo(() =>
    targetIsReady(selectedDevice(), server.health() === "online"),
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
  createEffect(() => {
    const id = campaignId();
    if (!id) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        const next = await server.combineCampaign.get(id);
        if (disposed) return;
        setCampaign(next);
        setPilotJobId(next.cases.find((item) => item.phase === "pilot")?.jobId);
        if (next.status === "pilot-running" || next.status === "running") {
          timer = setTimeout(() => void refresh(), 1_000);
        }
      } catch {
        // The selected campaign remains visible; explicit actions surface errors.
      }
    };
    void refresh();
    onCleanup(() => {
      disposed = true;
      if (timer) clearTimeout(timer);
    });
  });
  const variableBeingEdited = createMemo(() => {
    const id = editingVariableId();
    return id ? map()?.variables[id] : undefined;
  });
  const variableEditorOpen = () => creatingSet() || Boolean(editingVariableId());
  const observeScrollArea = useAppMapCombineSectionFocus({
    section: () => props.focusSection,
    editorOpen: variableEditorOpen,
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
  const currentCells = createMemo(() => combineCells(projection().worlds, selectedTests()));
  const localAdmission = createAppMapCombineLocalAdmission({
    appMapId: () => map()?.id,
    cells: currentCells,
    server,
  });
  const canExecute = createMemo(() =>
    localAdmission.localCampaignMode() ? server.health() === "online" : canRunOnDevice(),
  );
  const campaignActions = createAppMapCombineCampaignActions({
    campaignId,
    pilotJobId,
    reviewed: campaignReviewed,
    busy,
    setBusy,
    setCampaign,
    combineCampaign: server.combineCampaign,
    openRun: props.onOpenRun,
    showDevice: props.onOpenDevice,
  });
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
  const draftIssue = createMemo(() => {
    if (!selectedVariables().length) return "Choose at least one Variable.";
    const empty = selectedVariables().find((variable) => valuesFor(variable).length === 0);
    if (empty) return `Choose at least one ${empty.name} value.`;
    if (!selectedTests().length) return "Choose at least one Test.";
    if (projection().issue) return projection().issue!;
    if (projection().totalWorlds > MAX_DEVICE_WORLDS) {
      return `This creates ${projection().totalWorlds} device runs. Select fewer values or use matched rows (maximum ${MAX_DEVICE_WORLDS}).`;
    }
    return "";
  });
  const runIssue = createMemo(() => {
    const draft = draftIssue();
    if (draft) return draft;
    if (localAdmission.localCampaignMode() && projection().truncated) {
      return `This local campaign has more than ${projection().worlds.length} rows. Select fewer values before binding every target explicitly.`;
    }
    const unbound = currentCells().filter(
      (cell) => !bindingForCell(cellRuntimeProfiles(), cell.testId, cell.values),
    );
    if (unbound.length) {
      const first = unbound[0]!;
      return unbound.length === 1
        ? `Bind a runtime profile to ${first.testName} · ${first.worldLabel}.`
        : `Bind a runtime profile to every selected cell. ${unbound.length} cells have no profile.`;
    }
    if (localAdmission.localCampaignMode()) {
      const selection = localAdmission.fullSelection();
      if ("issue" in selection) return selection.issue;
      if (!localAdmission.targetsReady()) {
        return "A bound local target is not ready. Refresh or rebind this cell before admission.";
      }
      const admission = localAdmission.fullRequest();
      if ("issue" in admission) return admission.issue;
      if (!localAdmission.previewIsReady()) {
        return "Refresh measured timing evidence, then check current local capacity before starting.";
      }
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
    setCellRuntimeProfiles(existing?.cellRuntimeProfiles ?? []);
    localAdmission.resetBindings();
    if (existing && typeof localStorage !== "undefined") {
      setCampaignId(localStorage.getItem(campaignStorageKey(current.id, existing.id)) || undefined);
    } else {
      setCampaignId();
      setCampaign();
      setPilotJobId();
    }
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
  async function deleteVariable(variable: AppMapVariable) {
    const currentMap = map();
    if (!currentMap || busy()) return;
    const dependentCombines = Object.values(currentMap.combines ?? {}).filter((combine) =>
      combine.variableIds.includes(variable.id),
    );
    confirmAction({
      title: `Delete ${variable.name}?`,
      body: dependentCombines.length
        ? `Relay will remove this variable from ${dependentCombines.length} ${dependentCombines.length === 1 ? "combine" : "combines"}. Tests and map evidence remain.`
        : "The variable will be removed. Tests and map evidence remain.",
      confirmLabel: "Delete variable",
      tone: "destructive",
      onConfirm: async () => {
        setBusy(true);
        try {
          let revision = currentMap.revision;
          for (const combine of dependentCombines) {
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
          setEditingVariableId(undefined);
          toast(`Deleted ${variable.name}`, "success");
        } catch (error) {
          toast(humanError(error, `Could not delete ${variable.name}`), "error");
        } finally {
          setBusy(false);
        }
      },
    });
  }
  function deleteCombine() {
    const currentMap = map();
    const id = props.combineId?.trim();
    const existing = id ? currentMap?.combines[id] : undefined;
    if (!currentMap || !existing || busy()) return;
    confirmAction({
      title: `Delete ${existing.name}?`,
      body: "This removes the saved combine from the canvas. Its variables, Tests, and map evidence remain.",
      confirmLabel: "Delete combine",
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
  async function persistCombine(currentMap: NonNullable<ReturnType<typeof map>>) {
    const saved = buildCombineForPersistence({
      map: currentMap,
      combineId: props.combineId,
      name: headline(),
      variables: selectedVariables(),
      tests: selectedTests(),
      valueIdsFor: valuesFor,
      captureModeFor: (candidate) =>
        captureModes()[candidateKey(candidate)] ?? defaultCaptureMode(candidate),
      cellRuntimeProfiles: cellRuntimeProfiles(),
      strategy: strategy(),
    });
    await server.saveCombine({
      appMapId: currentMap.id,
      expectedRevision: currentMap.revision,
      combine: saved.combine,
    });
    await server.refreshAppMaps();
    return saved;
  }
  async function saveCombine() {
    const currentMap = map();
    if (!currentMap || draftIssue() || busy()) return;
    setBusy(true);
    setSavingOnly(true);
    try {
      await persistCombine(currentMap);
      toast(`Saved ${headline()} on the canvas`, "success");
      props.onClose();
    } catch (error) {
      toast(humanError(error, "Could not save this combine"), "error");
    } finally {
      setSavingOnly(false);
      setBusy(false);
    }
  }

  async function runCombine(input?: { worldIndex: number; test: TestCandidate }) {
    const currentMap = map();
    if (!currentMap || (!input && runIssue())) {
      toast(runIssue() || "This combine is incomplete", "warning");
      return;
    }
    if (!canExecute()) {
      toast(
        localAdmission.localCampaignMode()
          ? "Relay is not connected to inspect local capacity"
          : "Connect a ready device to run this combine",
        "warning",
      );
      return;
    }
    setBusy(true);
    try {
      const variableIds = selectedVariables().map((variable) => variable.id);
      const world = input ? projection().worlds[input.worldIndex] : undefined;
      const selected = input
        ? Object.fromEntries(
            selectedVariables().map((variable) => {
              const value = world?.values[variable.id];
              return [variable.id, value ? [value.id] : []];
            }),
          )
        : Object.fromEntries(
            selectedVariables().map((variable) => [variable.id, valuesFor(variable)]),
          );
      const values = input
        ? Object.fromEntries(
            selectedVariables().map((variable) => [
              variable.id,
              world?.values[variable.id]?.id ?? "",
            ]),
          )
        : undefined;
      const localStart = localAdmission.localCampaignMode()
        ? await localAdmission.prepareForStart(
            input
              ? currentCells().filter(
                  (cell) =>
                    cell.testId === input.test.id &&
                    Object.entries(values!).every(([id, value]) => cell.values[id] === value),
                )
              : currentCells(),
          )
        : undefined;
      if (localAdmission.localCampaignMode() && !localStart) {
        toast(localAdmission.feedback() || "Could not admit local capacity", "warning");
        return;
      }
      const localCampaign = localStart
        ? {
            cellTargetBindings: localStart.bindings,
            localAdmission: localStart.request,
          }
        : {};
      if (input) {
        const testId = input.test.id;
        const started = await server.runPathAcrossVariables({
          appMapId: currentMap.id,
          testId,
          capture: {
            mode: captureModes()[candidateKey(input.test)] ?? defaultCaptureMode(input.test),
          },
          variableIds,
          selected,
          strategy: "zip",
          title: `${projection().worlds[input.worldIndex]?.label ?? "State"} → ${input.test.name}`,
          cellRuntimeProfiles: cellRuntimeProfiles().filter(
            (binding) =>
              binding.testId === testId &&
              selectedVariables().every(
                (variable) => binding.values[variable.id] === values![variable.id],
              ),
          ),
          ...localCampaign,
        });
        if (!started) return;
      } else {
        if (localStart) setPreflight();
        const persisted = await persistCombine(currentMap);
        if (!localStart) {
          const checked = await server.preflightCombine({
            appMapId: currentMap.id,
            combineId: persisted.id,
            serial: server.selectedDevice() || undefined,
          });
          setPreflight(checked);
          if (!checked.ok) {
            toast(checked.blockers[0]?.message ?? "This combine is not ready", "warning");
            return;
          }
        }
        const started = await server.runPathAcrossVariables({
          appMapId: currentMap.id,
          combineId: persisted.id,
          variableIds: persisted.variableIds,
          selected: persisted.selected,
          strategy: strategy(),
          title: headline(),
          executionMode: projection().cellCount > 1 ? "pilot" : "all",
          cellRuntimeProfiles: cellRuntimeProfiles(),
          ...localCampaign,
        });
        if (!started) return;
        if (started?.campaignId) {
          setCampaignId(started.campaignId);
          if (typeof localStorage !== "undefined") {
            localStorage.setItem(
              campaignStorageKey(currentMap.id, persisted.id),
              started.campaignId,
            );
          }
          setPilotJobId(started.jobId ?? undefined);
          setCampaignReviewed(false);
          setCampaign(await server.combineCampaign.get(started.campaignId));
          props.onOpenDevice();
          return;
        }
      }
      props.onClose();
      props.onOpenDevice();
    } catch (error) {
      const readable = humanError(error, "Could not start this combine");
      if (localAdmission.localCampaignMode()) localAdmission.reportFeedback(readable);
      toast(readable, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section class="flex min-h-0 w-full flex-1 flex-col" aria-label="Combine">
      <AppMapCombineHeader headline={headline()} subhead={subhead()} onClose={props.onClose} />
      <div
        ref={observeScrollArea}
        class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3"
        onWheel={(event) => event.stopPropagation()}
      >
        <Show
          when={!variableEditorOpen()}
          fallback={
            <AppMapVariableEditor
              collapsed={props.collapsed}
              variable={variableBeingEdited()}
              onDelete={
                variableBeingEdited()
                  ? () => void deleteVariable(variableBeingEdited()!)
                  : undefined
              }
              onOpenDevice={props.onOpenDevice}
              onCancel={() => {
                setCreatingSet(false);
                setEditingVariableId(undefined);
              }}
              onSaved={(id) => {
                setCreatingSet(false);
                setEditingVariableId(undefined);
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
              canRunOnDevice={canExecute()}
              cellTargetBindings={localAdmission.cellTargetBindings()}
              localTargets={localAdmission.localTargets()}
              localCampaignMode={localAdmission.localCampaignMode()}
              onCreateVariable={() => {
                setEditingVariableId(undefined);
                setCreatingSet(true);
              }}
              onEditVariable={(id) => {
                setCreatingSet(false);
                setEditingVariableId(id);
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
              onRunCell={(worldIndex, test) => void runCombine({ worldIndex, test })}
              cellRuntimeProfiles={cellRuntimeProfiles()}
              runtimeProfiles={mapRuntimeProfileOptions(map() ?? undefined)}
              device={selectedDevice()}
              onBindCell={(testId, values, targetProfileId) =>
                setCellRuntimeProfiles((current) =>
                  upsertCellRuntimeProfile(current, { testId, values, targetProfileId }),
                )
              }
              onBindCellTarget={localAdmission.bindCellTarget}
            />

            <AppMapCombineRunStatus
              admission={localAdmission}
              cellCount={currentCells().length}
              issue={runIssue()}
              preflight={preflight()}
              campaign={campaign()}
              reviewed={campaignReviewed()}
              busy={busy()}
              onReviewed={setCampaignReviewed}
              onOpenPilot={campaignActions.openPilot}
              onResume={campaignActions.resume}
              onCancel={campaignActions.cancel}
            />
          </div>
        </Show>
      </div>

      <Show when={!variableEditorOpen()}>
        <AppMapCombineFooter
          canDelete={Boolean(props.combineId && map()?.combines[props.combineId])}
          combinations={projection().totalWorlds || 0}
          testCount={selectedTests().length}
          cellCount={projection().cellCount}
          canRunOnDevice={canExecute()}
          issue={runIssue()}
          saveIssue={draftIssue()}
          busy={busy()}
          savingOnly={savingOnly()}
          onDelete={deleteCombine}
          onSave={() => void saveCombine()}
          onRun={() => void runCombine()}
          pilot={projection().cellCount > 1}
        />
      </Show>
    </section>
  );
}
