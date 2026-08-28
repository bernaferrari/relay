import {
  CaseExpansionError,
  expandCaseIndexes,
  type AppMap,
  type AppMapCombine,
  type AppMapVariable,
} from "@relay/protocol";
import type { DeviceInfo, PersistedRun } from "./api-types";
import { bindingForCell } from "./app-map-combine-profiles";
import type { FirstTestTargetStatus } from "./onboarding";
import { liveInspectionHint } from "./stage-presentation";

export const FIRST_OPERATOR_RUN_STORAGE_KEY = "onboarding:first-operator-run:v1";

export type FirstOperatorRunPreference = {
  version: 1;
  dismissedAt?: number;
  completedAt?: number;
};

export const EMPTY_FIRST_OPERATOR_RUN_PREFERENCE: FirstOperatorRunPreference = { version: 1 };

export type FirstOperatorRunStage = "device" | "bind" | "run" | "complete";

export type FirstOperatorRunState = {
  stage: FirstOperatorRunStage;
  title: string;
  detail: string;
  actionLabel: string;
  action: "device" | "combine" | "test" | "done";
  deviceLabel: string;
  deviceDetail: string;
  hasWork: boolean;
  combineId?: string;
  testId?: string;
};

function timestamp(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function parseFirstOperatorRunPreference(
  value: string | null | undefined,
): FirstOperatorRunPreference {
  if (!value) return { ...EMPTY_FIRST_OPERATOR_RUN_PREFERENCE };
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return { ...EMPTY_FIRST_OPERATOR_RUN_PREFERENCE };
    const candidate = parsed as Record<string, unknown>;
    if (candidate.version !== 1) return { ...EMPTY_FIRST_OPERATOR_RUN_PREFERENCE };
    const dismissedAt = timestamp(candidate.dismissedAt);
    const completedAt = timestamp(candidate.completedAt);
    return {
      version: 1,
      ...(dismissedAt ? { dismissedAt } : {}),
      ...(completedAt ? { completedAt } : {}),
    };
  } catch {
    return { ...EMPTY_FIRST_OPERATOR_RUN_PREFERENCE };
  }
}

export function serializeFirstOperatorRunPreference(
  preference: FirstOperatorRunPreference,
): string {
  return JSON.stringify({
    version: 1,
    ...(timestamp(preference.dismissedAt) ? { dismissedAt: preference.dismissedAt } : {}),
    ...(timestamp(preference.completedAt) ? { completedAt: preference.completedAt } : {}),
  });
}

function selectedVariableValues(combine: AppMapCombine, variable: AppMapVariable): string[] {
  const available = variable.options.map((option) => option.id);
  if (!Object.hasOwn(combine.selected ?? {}, variable.id)) return available;
  const allowed = new Set(available);
  return [...new Set((combine.selected?.[variable.id] ?? []).filter((id) => allowed.has(id)))];
}

/** Same worlds as the Combine grid and execution. A zip diagonal is not a
 * cartesian product, and a mid-expansion cap would drop later variables. */
function combineWorlds(
  combine: AppMapCombine,
  variables: Record<string, AppMapVariable> | undefined,
): Record<string, string>[] | undefined {
  const sets = combine.variableIds.map((id) => {
    const variable = variables?.[id];
    if (!variable) return undefined;
    const values = selectedVariableValues(combine, variable);
    return values.length ? values : undefined;
  });
  if (sets.some((set) => !set)) return undefined;
  let rows: number[][];
  try {
    rows = expandCaseIndexes(
      sets.map((set) => set!.length),
      combine.strategy ?? "cartesian",
    );
  } catch (error) {
    if (error instanceof CaseExpansionError) return undefined;
    throw error;
  }
  return rows.map((indexes) =>
    Object.fromEntries(
      combine.variableIds.map((id, index) => [id, sets[index]![indexes[index]!]!]),
    ),
  );
}

function combineHasUnboundCell(
  combine: AppMapCombine,
  variables: Record<string, AppMapVariable> | undefined,
): boolean {
  if (!combine.testIds.length || !combine.variableIds.length) return false;
  const worlds = combineWorlds(combine, variables);
  if (!worlds) return true;
  if (!worlds.length) return (combine.cellRuntimeProfiles ?? []).length === 0;
  for (const testId of combine.testIds) {
    for (const values of worlds) {
      if (!bindingForCell(combine.cellRuntimeProfiles ?? [], testId, values)) return true;
    }
  }
  return false;
}

export type FirstOperatorInspection = {
  inspectable?: boolean;
  inspectionState?: string;
  nodeCount?: number;
  source?: string;
  inspectionError?: string;
};

function artifactMatchesThisMap(
  artifact: NonNullable<PersistedRun["artifacts"]>[number],
  appMapId: string,
): boolean {
  if (!artifact.data || typeof artifact.data !== "object") return false;
  const data = artifact.data as Record<string, unknown>;
  if (data.appMapId !== appMapId) return false;
  return artifact.kind === "app-map-test-plan" || artifact.kind === "frozen-inputs";
}

function runMatchesMap(run: PersistedRun, appMapId: string): boolean {
  return (run.artifacts ?? []).some((artifact) => artifactMatchesThisMap(artifact, appMapId));
}

function succeeded(run: PersistedRun): boolean {
  return run.status === "ok" || run.status === "healed";
}

function deviceHonesty(input: {
  target: FirstTestTargetStatus;
  device?: Pick<DeviceInfo, "name" | "serial" | "platform">;
  inspection?: FirstOperatorInspection;
}): { deviceLabel: string; deviceDetail: string } {
  const pixelsOnly =
    input.inspection?.inspectable === false || input.inspection?.source === "pixels-only";
  if (input.target.kind === "ready" && pixelsOnly) {
    const hint = liveInspectionHint({
      inspectable: false,
      inspectionState: input.inspection?.inspectionState,
      nodeCount: input.inspection?.nodeCount,
      inspectionError: input.inspection?.inspectionError,
      platform: input.device?.platform,
    });
    return {
      deviceLabel: hint?.title ?? "Pixels only",
      deviceDetail: hint?.detail ?? "The picture works. Names are not available on this screen.",
    };
  }
  if (input.target.kind === "ready") {
    return { deviceLabel: input.target.title, deviceDetail: input.target.detail };
  }
  return {
    deviceLabel: input.device?.name?.trim() || input.device?.serial || "No device",
    deviceDetail: input.target.detail,
  };
}

export function deriveFirstOperatorRunState(input: {
  target: FirstTestTargetStatus;
  device?: Pick<DeviceInfo, "name" | "serial" | "platform">;
  inspection?: FirstOperatorInspection;
  map?: Pick<AppMap, "id" | "tests" | "variables" | "combines">;
  runs?: readonly PersistedRun[];
}): FirstOperatorRunState {
  const { deviceLabel, deviceDetail } = deviceHonesty(input);
  const tests = Object.values(input.map?.tests ?? {});
  const combines = Object.values(input.map?.combines ?? {});
  const unbound = combines.find((combine) => combineHasUnboundCell(combine, input.map?.variables));
  const hasTest = tests.length > 0;
  const hasVariable = Object.keys(input.map?.variables ?? {}).length > 0;
  const completed = (input.runs ?? []).find(
    (run) => input.map && runMatchesMap(run, input.map.id) && succeeded(run),
  );
  const hasWork = hasTest || combines.length > 0;
  const base = { deviceLabel, deviceDetail, hasWork };

  if (input.target.kind !== "ready") {
    return {
      ...base,
      stage: "device",
      title: input.target.title,
      detail: input.target.detail,
      actionLabel: "actionLabel" in input.target ? input.target.actionLabel : "Open Device",
      action: "device",
    };
  }
  if (unbound || (hasTest && hasVariable && !combines.length)) {
    return {
      ...base,
      stage: "bind",
      title: unbound ? "Bind a Combine cell" : "Open Combine to bind one cell",
      detail: unbound
        ? `${unbound.name} has selected cells with no runtime profile. Save stays available; Run needs every selected cell bound.`
        : "Choose a Variable × Test cell and bind a saved runtime profile. Relay will not infer a locale from the live screen.",
      actionLabel: "Open Combine",
      action: "combine",
      combineId: unbound?.id,
      testId: tests[0]?.id,
    };
  }
  if (hasTest && !completed) {
    return {
      ...base,
      stage: "run",
      title: "Run one cell",
      detail:
        "The target is ready. Run one bound Combine cell or one Test — Relay will not start a hidden retry.",
      actionLabel: combines[0] ? "Open Combine" : "Open Test",
      action: combines[0] ? "combine" : "test",
      combineId: combines[0]?.id,
      testId: tests[0]?.id,
    };
  }
  return {
    ...base,
    stage: "complete",
    title: "First run is on the map",
    detail:
      "Device state, bindings, and reports stay on this App Map. Open Combine or a Test to run the next cell.",
    actionLabel: "Done",
    action: "done",
    combineId: combines[0]?.id,
    testId: tests[0]?.id,
  };
}

export function shouldShowFirstOperatorRun(
  preference: FirstOperatorRunPreference,
  state: FirstOperatorRunState,
  firstTestVisible: boolean,
): boolean {
  if (firstTestVisible || preference.dismissedAt || !state.hasWork) return false;
  if (state.stage === "complete") return !preference.completedAt;
  return true;
}
