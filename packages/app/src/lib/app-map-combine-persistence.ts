import type {
  AppMap,
  AppMapCapturePolicy,
  AppMapCombine,
  AppMapCombineCellRuntimeProfile,
  AppMapVariable,
  CaseExpansionStrategy,
} from "@relay/protocol";
import { combineIdFor, savedTestId, type TestCandidate } from "./app-map-combine-candidates";

/** Build the reviewed, saveable Combine document independently of local target
 * admission. Hardware bindings are intentionally session-only and never
 * become stale App Map truth. */
export function buildCombineForPersistence(input: {
  map: AppMap;
  combineId?: string;
  name: string;
  variables: readonly AppMapVariable[];
  tests: readonly TestCandidate[];
  valueIdsFor: (variable: AppMapVariable) => string[];
  captureModeFor: (test: TestCandidate) => Exclude<AppMapCapturePolicy["mode"], "checkpoints">;
  cellRuntimeProfiles: AppMapCombineCellRuntimeProfile[];
  strategy: CaseExpansionStrategy;
  now?: number;
}): {
  id: string;
  variableIds: string[];
  selected: Record<string, string[]>;
  combine: AppMapCombine;
} {
  const variableIds = input.variables.map((variable) => variable.id);
  const testIds = input.tests.map(savedTestId);
  const id = input.combineId?.trim() || combineIdFor(variableIds, testIds);
  const selected = Object.fromEntries(
    input.variables.map((variable) => [variable.id, input.valueIdsFor(variable)]),
  );
  const captures = Object.fromEntries(
    input.tests.map((test) => [savedTestId(test), { mode: input.captureModeFor(test) }]),
  );
  const now = input.now ?? Date.now();
  const existing = input.map.combines?.[id];
  return {
    id,
    variableIds,
    selected,
    combine: {
      id,
      organizationId: input.map.organizationId,
      projectId: input.map.projectId,
      appMapId: input.map.id,
      name: input.name,
      variableIds,
      testIds,
      selected,
      captures,
      cellRuntimeProfiles: input.cellRuntimeProfiles,
      strategy: input.strategy,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    },
  };
}
