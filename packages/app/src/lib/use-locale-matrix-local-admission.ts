import { createEffect, createMemo, createSignal, type Accessor } from "solid-js";
import type {
  CampaignCapacityCohortDurationEvidence,
  CampaignCapacityCohortDurationEstimateRequest,
  CampaignCapacityCohortDurationEstimateResponse,
  LocalAgentDeviceExecutionTargetRef,
  LocalCampaignAdmissionPreflightRequest,
  LocalCampaignAdmissionPreflightResponse,
  LocaleMatrixCase,
  LocaleMatrixMaterialization,
} from "@relay/protocol";
import { MAX_CAMPAIGN_DURATION_EVIDENCE_AGE_MS } from "@relay/protocol";
import type { DeviceInfo } from "./api-types";
import {
  isBoundLocalExecutionTargetReady,
  localExecutionTargetOptions,
  type LocalExecutionTargetOption,
} from "./local-execution-targets";
import {
  type LocalCampaignAdmissionDraft,
  type LocalCampaignAdmissionPreview,
} from "./local-campaign-admission";
import {
  bindingsForLocaleMatrixCases,
  localeMatrixAdmissionSelection,
  localAdmissionRequestForLocaleMatrix,
  upsertLocaleMatrixCaseTargetBinding,
  type LocaleMatrixAdmissionRequestSelection,
  type LocaleMatrixAdmissionSelection,
  type LocaleMatrixCaseTargetBinding,
} from "./locale-matrix-admission";

const MIN_OBSERVED_SAMPLES = 5;

export type LocaleMatrixLocalAdmissionServer = {
  devices: Accessor<DeviceInfo[]>;
  health: Accessor<string>;
  estimateCampaignDurationCohorts: (
    input: CampaignCapacityCohortDurationEstimateRequest,
  ) => Promise<CampaignCapacityCohortDurationEstimateResponse>;
  preflightLocalCampaignAdmission: (
    input: LocalCampaignAdmissionPreflightRequest,
  ) => Promise<LocalCampaignAdmissionPreflightResponse>;
};

function previewIsReady(preview: LocalCampaignAdmissionPreview | undefined): boolean {
  return Boolean(
    preview?.targetPreflights.length &&
    preview.targetPreflights.every((target) => target.deadline.achievableWithCurrentCapacity),
  );
}

function scopeKey(input: {
  materialization?: Pick<
    LocaleMatrixMaterialization,
    "cases" | "durationCohort" | "scope" | "source"
  >;
  bindings: readonly LocaleMatrixCaseTargetBinding[];
}): string {
  return JSON.stringify({
    source: input.materialization?.source,
    scope: input.materialization?.scope,
    durationCohort: input.materialization?.durationCohort,
    cases: input.materialization?.cases,
    bindings: input.bindings.map((binding) => ({
      caseIndex: binding.caseIndex,
      locale: binding.locale,
      executionTarget: binding.executionTarget,
    })),
  });
}

/**
 * Target-affine local admission for one frozen locale plan. The selected
 * device is intentionally absent from this API: entering local campaign mode
 * means every materialized case must name its own ready Android/iOS target.
 */
export function createLocaleMatrixLocalAdmission(input: {
  materialization: Accessor<LocaleMatrixMaterialization | undefined>;
  server: LocaleMatrixLocalAdmissionServer;
}) {
  const [caseTargetBindings, setCaseTargetBindings] = createSignal<LocaleMatrixCaseTargetBinding[]>(
    [],
  );
  // This is intent, rather than a derivation of the currently valid rows. A
  // refreshed plan can invalidate every saved binding; that must still stay
  // fail-closed instead of silently resuming the legacy selected-device path.
  const [explicitTargetMode, setExplicitTargetMode] = createSignal(false);
  const [draft, setDraft] = createSignal<LocalCampaignAdmissionDraft>({
    deadlineMinutes: "3",
    setupHeadroomMinutes: "",
    recoveryHeadroomMinutes: "",
  });
  const [evidence, setEvidence] = createSignal<CampaignCapacityCohortDurationEvidence[]>([]);
  const [preview, setPreview] = createSignal<LocalCampaignAdmissionPreview>();
  const [feedback, setFeedback] = createSignal<string>();
  const [loadingEvidence, setLoadingEvidence] = createSignal(false);
  const [checking, setChecking] = createSignal(false);

  const localTargets = createMemo(() =>
    localExecutionTargetOptions(
      input.server.devices(),
      input.server.health() === "online",
      input.materialization()?.targetPlatform,
    ),
  );
  const scopedBindings = createMemo(() =>
    bindingsForLocaleMatrixCases(caseTargetBindings(), input.materialization()?.cases ?? []),
  );
  /** Once a person has interacted with a per-case target, remain in explicit
   * mode until they deliberately reset to the legacy selected-device path. */
  const localCampaignMode = createMemo(() => explicitTargetMode());
  const targetsReady = createMemo(() => bindingsReady(scopedBindings()));

  function bindingsReady(bindings: readonly LocaleMatrixCaseTargetBinding[]): boolean {
    return bindings.every((binding) =>
      isBoundLocalExecutionTargetReady(binding.executionTarget, localTargets()),
    );
  }

  function selectionForCases(
    cases: readonly LocaleMatrixCase[],
  ): LocaleMatrixAdmissionSelection | { issue: string } {
    const materialization = input.materialization();
    if (!materialization)
      return { issue: "Materialize the locale plan before assigning a target." };
    return localeMatrixAdmissionSelection({
      cases,
      bindings: caseTargetBindings(),
      durationCohort: materialization.durationCohort,
    });
  }

  function requestForCases(
    cases: readonly LocaleMatrixCase[],
  ): LocaleMatrixAdmissionRequestSelection | { issue: string } {
    const selection = selectionForCases(cases);
    if ("issue" in selection) return selection;
    const result = localAdmissionRequestForLocaleMatrix({
      draft: draft(),
      cohorts: selection.cohorts,
      evidence: evidence(),
    });
    return "issue" in result ? result : { ...selection, request: result.request };
  }

  const fullSelection = createMemo(() => selectionForCases(input.materialization()?.cases ?? []));
  const fullRequest = createMemo(() => requestForCases(input.materialization()?.cases ?? []));
  const boundCases = createMemo(() => {
    const materialization = input.materialization();
    if (!materialization) return [];
    return materialization.cases.filter((item) =>
      scopedBindings().some((binding) => binding.caseIndex === item.caseIndex),
    );
  });
  const boundSelection = createMemo(() => selectionForCases(boundCases()));
  const cohorts = createMemo(() => {
    const selection = boundSelection();
    return "issue" in selection ? [] : selection.cohorts;
  });

  let lastScope = "";
  createEffect(() => {
    const key = scopeKey({ materialization: input.materialization(), bindings: scopedBindings() });
    if (key === lastScope) return;
    lastScope = key;
    setEvidence([]);
    setPreview();
    setFeedback();
  });

  function bindCaseTarget(
    item: LocaleMatrixCase,
    executionTarget?: LocalAgentDeviceExecutionTargetRef,
  ): void {
    setExplicitTargetMode(true);
    setCaseTargetBindings((current) =>
      upsertLocaleMatrixCaseTargetBinding(current, item, executionTarget),
    );
    // Clear synchronously as well as in the scope effect: a rapid click on
    // “Refresh timings” must never reuse evidence from the previous case map.
    setEvidence([]);
    setPreview();
    setFeedback();
  }

  function resetBindings(): void {
    setExplicitTargetMode(false);
    setCaseTargetBindings([]);
    setEvidence([]);
    setPreview();
    setFeedback();
  }

  function updateDraft(patch: Partial<LocalCampaignAdmissionDraft>): void {
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
      materialization: input.materialization(),
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
        scopeKey({ materialization: input.materialization(), bindings: scopedBindings() })
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

  async function prepareForStart(): Promise<LocaleMatrixAdmissionRequestSelection | undefined> {
    const selected = fullRequest();
    if ("issue" in selected) {
      setFeedback(selected.issue);
      return undefined;
    }
    if (!bindingsReady(selected.bindings)) {
      setFeedback(
        "A bound local target is not ready. Refresh or rebind that locale case before admission.",
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
        "The current local target/worker snapshot cannot meet this deadline. Rebind cases, refresh evidence, reduce work, or request more time.",
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
    await prepareForStart();
  }

  return {
    caseTargetBindings: scopedBindings,
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
    bindCaseTarget,
    resetBindings,
    updateDraft,
    reportFeedback,
    refreshEvidence,
    prepareForStart,
    checkCapacity,
    previewIsReady: () => previewIsReady(preview()),
  };
}

export type LocaleMatrixLocalAdmissionState = ReturnType<typeof createLocaleMatrixLocalAdmission>;
export type { LocalExecutionTargetOption };
