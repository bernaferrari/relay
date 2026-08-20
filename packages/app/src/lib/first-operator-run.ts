import type { AppMap, AppMapCombine } from "@relay/protocol";
import type { DeviceInfo, PersistedRun } from "./api-types";
import { bindingForCell } from "./app-map-combine-profiles";
import type { FirstTestTargetStatus } from "./onboarding";

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

function combineHasUnboundCell(combine: AppMapCombine): boolean {
  if (!combine.testIds.length || !combine.variableIds.length) return false;
  const selected = combine.selected ?? {};
  const worlds = cartesianPreview(combine.variableIds, selected);
  if (!worlds.length) return (combine.cellRuntimeProfiles ?? []).length === 0;
  for (const testId of combine.testIds) {
    for (const values of worlds) {
      if (!bindingForCell(combine.cellRuntimeProfiles ?? [], testId, values)) return true;
    }
  }
  return false;
}

function cartesianPreview(
  variableIds: readonly string[],
  selected: Record<string, string[]>,
): Record<string, string>[] {
  let worlds: Record<string, string>[] = [{}];
  for (const variableId of variableIds) {
    const values = selected[variableId] ?? [];
    if (!values.length) return [];
    worlds = worlds.flatMap((world) => values.map((value) => ({ ...world, [variableId]: value })));
    if (worlds.length > 24) break;
  }
  return worlds;
}

function runMatchesMap(run: PersistedRun, appMapId: string): boolean {
  if (run.action.includes("combine") && run.title) return true;
  return (run.artifacts ?? []).some((artifact) => {
    if (!artifact.data || typeof artifact.data !== "object") return false;
    const data = artifact.data as Record<string, unknown>;
    return data.appMapId === appMapId;
  });
}

function succeeded(run: PersistedRun): boolean {
  return run.status === "ok" || run.status === "healed";
}

export function deriveFirstOperatorRunState(input: {
  target: FirstTestTargetStatus;
  device?: Pick<DeviceInfo, "name" | "serial" | "platform">;
  map?: Pick<AppMap, "id" | "tests" | "variables" | "combines">;
  runs?: readonly PersistedRun[];
}): FirstOperatorRunState {
  const deviceLabel =
    input.target.kind === "ready"
      ? input.target.title
      : input.device?.name?.trim() || input.device?.serial || "No device";
  const deviceDetail = input.target.detail;
  const tests = Object.values(input.map?.tests ?? {});
  const combines = Object.values(input.map?.combines ?? {});
  const unbound = combines.find(combineHasUnboundCell);
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
      actionLabel: "actionLabel" in input.target ? input.target.actionLabel : "Open device",
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
