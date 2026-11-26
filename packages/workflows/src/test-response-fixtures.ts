import type { AppMap, AppMapCompiledTest, AppMapVariable } from "@relay/protocol";

export function appMapFixture(
  id: string,
  revision: number,
  overrides: Partial<AppMap> = {},
): AppMap {
  return {
    schemaVersion: 1,
    id,
    organizationId: "local",
    projectId: "default",
    name: id,
    revision,
    notes: {},
    groups: {},
    screens: {},
    screenVariants: {},
    connections: {},
    caseStacks: {},
    variables: {},
    tests: {},
    combines: {},
    routines: {},
    flows: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: 1,
    updatedAt: revision,
    ...overrides,
  };
}

export function appMapVariableFixture(
  variable: Pick<AppMapVariable, "id" | "name" | "kind" | "apply" | "options">,
): AppMapVariable {
  return {
    organizationId: "local",
    projectId: "default",
    appMapId: "settings",
    createdAt: 1,
    updatedAt: 1,
    ...variable,
  };
}

export function compiledTestFixture(
  appMapId: string,
  appMapRevision: number,
  testId: string,
  rootRecipeId: string,
  overrides: Partial<AppMapCompiledTest> = {},
): AppMapCompiledTest {
  return {
    schemaVersion: 1,
    appMapId,
    appMapRevision,
    test: { id: testId, name: testId, kind: "scenario", intentSchemaVersion: 1 },
    rootRecipeId,
    recipes: { [rootRecipeId]: { id: rootRecipeId, title: testId, parameters: [], steps: [] } },
    stepProvenance: [],
    performance: {
      executableOperations: 0,
      moduleCalls: 0,
      operationCounts: {},
      screenshotCount: 0,
      destinationProofCount: 0,
    },
    startup: { mode: "warm" },
    ...overrides,
  };
}
