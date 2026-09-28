import type {
  AppMapCapturePolicy,
  AppMapCombine,
  AppMapCombineCellRuntimeProfile,
} from "@relay/protocol";

export function ephemeralCombineFromTest(input: {
  mapId: string;
  organizationId: string;
  projectId: string;
  testId: string;
  variableIds: string[];
  selected?: Record<string, string[]>;
  strategy?: "zip" | "cartesian" | "pairwise";
  capture?: AppMapCapturePolicy;
  cellRuntimeProfiles?: AppMapCombineCellRuntimeProfile[];
}): AppMapCombine {
  const now = Date.now();
  return {
    id: "ad-hoc",
    organizationId: input.organizationId,
    projectId: input.projectId,
    appMapId: input.mapId,
    name: input.testId,
    variableIds: input.variableIds,
    testIds: [input.testId],
    ...(input.selected ? { selected: input.selected } : {}),
    ...(input.strategy ? { strategy: input.strategy } : {}),
    ...(input.capture ? { captures: { [input.testId]: input.capture } } : {}),
    ...(input.cellRuntimeProfiles ? { cellRuntimeProfiles: input.cellRuntimeProfiles } : {}),
    createdAt: now,
    updatedAt: now,
  };
}
