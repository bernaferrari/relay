import { createEffect, createMemo, createSignal, type Accessor } from "solid-js";
import type {
  AppMapCombineCellTargetBinding,
  CampaignCapacityCohortDurationEvidence,
  CampaignCapacityCohortDurationEstimateRequest,
  CampaignCapacityCohortDurationEstimateResponse,
  LocalAgentDeviceExecutionTargetRef,
  LocalCampaignAdmissionRequest,
  LocalCampaignAdmissionPreflightRequest,
  LocalCampaignAdmissionPreflightResponse,
} from "@relay/protocol";
import { MAX_CAMPAIGN_DURATION_EVIDENCE_AGE_MS } from "@relay/protocol";
import type { DeviceInfo } from "./api-types";
import {
  combineAdmissionCohorts,
  combineAdmissionWorkItems,
  localAdmissionRequestForCombine,
  type CombineAdmissionCell,
  type LocalCombineAdmissionDraft,
  type LocalCombineAdmissionPreview,
  type LocalCombineAdmissionWorkItem,
} from "./app-map-combine-admission";
import {
  bindingsForCombineCells,
  combineCellTargetBindingFor,
  isBoundLocalCombineTargetReady,
  localCombineTargetOptions,
  upsertCombineCellTargetBinding,
  type LocalCombineTargetOption,
} from "./app-map-combine-targets";

const MIN_OBSERVED_SAMPLES = 5;

type LocalAdmissionServer = {
  devices: Accessor<DeviceInfo[]>;
  health: Accessor<string>;
  estimateCampaignDurationCohorts: (
    input: CampaignCapacityCohortDurationEstimateRequest,
  ) => Promise<CampaignCapacityCohortDurationEstimateResponse>;
  preflightLocalCampaignAdmission: (
    input: LocalCampaignAdmissionPreflightRequest,
  ) => Promise<LocalCampaignAdmissionPreflightResponse>;
};

export type LocalCombineAdmissionSelection = {
  cohorts: ReturnType<typeof combineAdmissionCohorts>;
  workItems: LocalCombineAdmissionWorkItem[];
  bindings: AppMapCombineCellTargetBinding[];
};

export type LocalCombineAdmissionRequestSelection = LocalCombineAdmissionSelection & {
  request: LocalCampaignAdmissionRequest;
};

function previewIsReady(preview: LocalCombineAdmissionPreview | undefined): boolean {
  return Boolean(
    preview?.targetPreflights.length &&
    preview.targetPreflights.every((target) => target.deadline.achievableWithCurrentCapacity),
  );
}

function scopeKey(input: {
  appMapId?: string;
  cells: readonly CombineAdmissionCell[];
  bindings: readonly AppMapCombineCellTargetBinding[];
}): string {
  return JSON.stringify({
    appMapId: input.appMapId ?? "",
    cells: input.cells.map((cell) => ({ testId: cell.testId, values: cell.values })),
    bindings: input.bindings.map((binding) => ({
      testId: binding.testId,
      values: binding.values,
      target: binding.target,
    })),
  });
}

/**
 * Owns only ephemeral local execution/admission state. The saved Combine still
 * owns reviewed variables, Tests, and runtime evidence profiles; a serial is
 * deliberately rebound on each admission instead of persisting stale hardware
 * as map truth.
 */
export function createAppMapCombineLocalAdmission(input: {
  appMapId: Accessor<string | undefined>;
  cells: Accessor<readonly CombineAdmissionCell[]>;
  server: LocalAdmissionServer;
}) {
  const [cellTargetBindings, setCellTargetBindings] = createSignal<
    AppMapCombineCellTargetBinding[]
  >([]);
  const [draft, setDraft] = createSignal<LocalCombineAdmissionDraft>({
    deadlineMinutes: "3",
    setupHeadroomMinutes: "",
    recoveryHeadroomMinutes: "",
  });
  const [evidence, setEvidence] = createSignal<CampaignCapacityCohortDurationEvidence[]>([]);
  const [preview, setPreview] = createSignal<LocalCombineAdmissionPreview>();
  const [feedback, setFeedback] = createSignal<string>();
  const [loadingEvidence, setLoadingEvidence] = createSignal(false);
  const [checking, setChecking] = createSignal(false);

  const localTargets = createMemo(() =>
    localCombineTargetOptions(input.server.devices(), input.server.health() === "online"),
  );
  const scopedBindings = createMemo(() =>
    bindingsForCombineCells(cellTargetBindings(), input.cells()),
  );
  const localCampaignMode = createMemo(() => scopedBindings().length > 0);
  const targetsReady = createMemo(() => bindingsReady(scopedBindings()));

  function bindingsReady(bindings: readonly AppMapCombineCellTargetBinding[]): boolean {
    return bindings.every((binding) => isBoundLocalCombineTargetReady(binding, localTargets()));
  }

  function selectionForCells(
    cells: readonly CombineAdmissionCell[],
  ): LocalCombineAdmissionSelection | { issue: string } {
    const appMapId = input.appMapId()?.trim();
    if (!appMapId) return { issue: "Choose an App Map before requesting local capacity." };
    if (!cells.length) return { issue: "Bind at least one cell to a local Android or iOS target." };
    const bindings = bindingsForCombineCells(cellTargetBindings(), cells);
    const workItems = combineAdmissionWorkItems({ appMapId, cells, bindings });
    if (!workItems || workItems.length !== cells.length) {
      return { issue: "Bind each selected cell to an attached local Android or iOS target." };
    }
    const cohorts = combineAdmissionCohorts({ appMapId, cells, bindings });
    if (!cohorts.length) {
      return { issue: "No coherent local Android or iOS target cohorts are selected." };
    }
    return { cohorts, workItems, bindings };
  }

  function requestForCells(
    cells: readonly CombineAdmissionCell[],
  ): LocalCombineAdmissionRequestSelection | { issue: string } {
    const selection = selectionForCells(cells);
    if ("issue" in selection) return selection;
    const result = localAdmissionRequestForCombine({
      draft: draft(),
      cohorts: selection.cohorts,
      evidence: evidence(),
    });
    return "issue" in result ? result : { ...selection, request: result.request };
  }

  const fullSelection = createMemo(() => selectionForCells(input.cells()));
  const fullRequest = createMemo(() => requestForCells(input.cells()));
  const boundSelection = createMemo(() =>
    selectionForCells(
      input
        .cells()
        .filter((cell) => Boolean(combineCellTargetBindingFor(cellTargetBindings(), cell))),
    ),
  );
  const cohorts = createMemo(() => {
    const selection = boundSelection();
    return "issue" in selection ? [] : selection.cohorts;
  });

  let lastScope = "";
  createEffect(() => {
    const key = scopeKey({
      appMapId: input.appMapId(),
      cells: input.cells(),
      bindings: scopedBindings(),
    });
    if (key === lastScope) return;
    lastScope = key;
    setEvidence([]);
    setPreview();
    setFeedback();
  });

  function bindCellTarget(
    testId: string,
    values: Record<string, string>,
    target?: LocalAgentDeviceExecutionTargetRef,
  ): void {
    setCellTargetBindings((current) =>
      upsertCombineCellTargetBinding(current, { testId, values }, target),
    );
  }

  function resetBindings(): void {
    setCellTargetBindings([]);
    setEvidence([]);
    setPreview();
    setFeedback();
  }

  function updateDraft(patch: Partial<LocalCombineAdmissionDraft>): void {
    setDraft((current) => ({ ...current, ...patch }));
    setPreview();
    setFeedback();
  }

  function reportFeedback(message?: string): void {
    setFeedback(message);
  }

  async function refreshEvidence(): Promise<void> {
    const selection = boundSelection();
    if ("issue" in selection) {
      setFeedback(selection.issue);
      return;
    }
    const requestedScope = scopeKey({
      appMapId: input.appMapId(),
      cells: input.cells(),
      bindings: scopedBindings(),
    });
    setLoadingEvidence(true);
    setFeedback();
    try {
      const result = await input.server.estimateCampaignDurationCohorts({
        cohorts: selection.cohorts,
        maxAgeMs: MAX_CAMPAIGN_DURATION_EVIDENCE_AGE_MS,
        percentile: "p95",
        minSamples: MIN_OBSERVED_SAMPLES,
      });
      if (
        requestedScope !==
        scopeKey({
          appMapId: input.appMapId(),
          cells: input.cells(),
          bindings: scopedBindings(),
        })
      ) {
        return;
      }
      const nextEvidence = result.estimates.flatMap((item) =>
        item.evidence ? [item.evidence] : [],
      );
      setEvidence(nextEvidence);
      setPreview();
      const unavailable = result.estimates.filter((item) => !item.evidence);
      if (unavailable.length) {
        setFeedback(
          unavailable.length === 1
            ? "No current measured p95 timing is available for one selected target/Test cohort. Run and retain successful evidence first."
            : `No current measured p95 timing is available for ${unavailable.length} selected target/Test cohorts. Run and retain successful evidence first.`,
        );
      }
    } catch (error) {
      setEvidence([]);
      setPreview();
      setFeedback(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingEvidence(false);
    }
  }

  async function prepareForStart(
    cells: readonly CombineAdmissionCell[],
  ): Promise<LocalCombineAdmissionRequestSelection | undefined> {
    const selected = requestForCells(cells);
    if ("issue" in selected) {
      setFeedback(selected.issue);
      return undefined;
    }
    if (!bindingsReady(selected.bindings)) {
      setFeedback(
        "A bound local target is not ready. Refresh or rebind this cell before admission.",
      );
      return undefined;
    }
    setChecking(true);
    setFeedback();
    try {
      const result = await input.server.preflightLocalCampaignAdmission({
        workItems: selected.workItems,
        request: selected.request,
      });
      setPreview(result);
      if (previewIsReady(result)) return selected;
      setFeedback(
        "The current local target/worker snapshot cannot meet this deadline. Rebind cells, refresh evidence, reduce work, or request more time.",
      );
    } catch (error) {
      setPreview();
      setFeedback(error instanceof Error ? error.message : String(error));
    } finally {
      setChecking(false);
    }
    return undefined;
  }

  async function checkCapacity(): Promise<void> {
    await prepareForStart(input.cells());
  }

  return {
    cellTargetBindings: scopedBindings,
    localTargets,
    localCampaignMode,
    draft,
    evidence,
    preview,
    feedback,
    loadingEvidence,
    checking,
    cohorts,
    fullSelection,
    fullRequest,
    targetsReady,
    bindCellTarget,
    resetBindings,
    updateDraft,
    reportFeedback,
    refreshEvidence,
    prepareForStart,
    checkCapacity,
    previewIsReady: () => previewIsReady(preview()),
    requestForCells,
  };
}

export type AppMapCombineLocalAdmissionState = ReturnType<typeof createAppMapCombineLocalAdmission>;
export type { LocalCombineTargetOption };
