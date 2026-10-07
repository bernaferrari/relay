import type { AppMap, AppMapEntity } from "./app-map.js";

export const APP_MAP_GET_LISTS = ["variables", "tests", "combines"] as const;
export type AppMapGetList = (typeof APP_MAP_GET_LISTS)[number];

export type AppMapSummaryPresentation = {
  list?: AppMapGetList;
  commandPath?: string;
  input?: unknown;
};

const commandPathLists: Record<string, AppMapGetList> = {
  "variable list": "variables",
  "test list": "tests",
  "combine list": "combines",
};

export function appMapGetListForCommandPath(
  commandPath: string | undefined,
): AppMapGetList | undefined {
  return commandPath ? commandPathLists[commandPath] : undefined;
}

export function appMapGetListFromInput(input: unknown): AppMapGetList | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const list = (input as { list?: unknown }).list;
  return list === "variables" || list === "tests" || list === "combines" ? list : undefined;
}

export function resolveAppMapGetList(
  presentation?: AppMapSummaryPresentation,
): AppMapGetList | undefined {
  return (
    presentation?.list ??
    appMapGetListFromInput(presentation?.input) ??
    appMapGetListForCommandPath(presentation?.commandPath)
  );
}

function connectGetId(presentation?: AppMapSummaryPresentation): string | undefined {
  if (presentation?.commandPath !== "connect get") return undefined;
  if (
    !presentation.input ||
    typeof presentation.input !== "object" ||
    Array.isArray(presentation.input)
  ) {
    throw new Error("connect get requires a connectionId");
  }
  if (!("connectionId" in presentation.input)) {
    throw new Error("connect get requires a connectionId");
  }
  const connectionId = presentation.input.connectionId;
  if (typeof connectionId !== "string" || !connectionId.trim()) {
    throw new Error("connect get requires a connectionId");
  }
  return connectionId;
}

export function summarizeAppMapOperationResult(
  operationId: string,
  result: unknown,
  presentation?: AppMapSummaryPresentation,
): unknown {
  if (!operationId.startsWith("app-map.")) return result;
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  if (operationId === "app-map.list") {
    const appMaps = (result as { appMaps?: unknown }).appMaps;
    if (!Array.isArray(appMaps)) return result;
    const summaries = appMaps.map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
      const map = value as AppMap;
      if (
        typeof map.id !== "string" ||
        typeof map.name !== "string" ||
        typeof map.revision !== "number" ||
        !map.screens ||
        !map.screenVariants ||
        !map.connections ||
        !map.flows
      )
        return undefined;
      return {
        id: map.id,
        name: map.name,
        ...(map.description ? { description: map.description } : {}),
        revision: map.revision,
        counts: {
          screens: Object.keys(map.screens).length,
          variants: Object.keys(map.screenVariants).length,
          connections: Object.keys(map.connections).length,
          flows: Object.keys(map.flows).length,
        },
        createdAt: map.createdAt,
        updatedAt: map.updatedAt,
      };
    });
    if (summaries.some((summary) => !summary)) return result;
    return { ...(result as Record<string, unknown>), appMaps: summaries };
  }
  const appMap = (result as { appMap?: unknown }).appMap;
  if (!appMap || typeof appMap !== "object" || Array.isArray(appMap)) return result;
  const map = appMap as AppMap;
  if (
    typeof map.id !== "string" ||
    typeof map.name !== "string" ||
    typeof map.revision !== "number" ||
    !map.screens ||
    !map.connections
  )
    return result;

  const connectionId = operationId === "app-map.get" ? connectGetId(presentation) : undefined;
  if (connectionId) {
    const connection = map.connections[connectionId];
    if (!connection) throw new Error(`Unknown connection: ${connectionId}`);
    return {
      connection: {
        id: connection.id,
        ...(connection.label ? { label: connection.label } : {}),
        fromScreenId: connection.fromScreenId,
        destination: connection.destination,
        state: connection.state,
        actions: connection.actions,
      },
    };
  }

  const byId = <T extends AppMapEntity>(values: Record<string, T>): T[] =>
    Object.values(values).sort((left, right) => left.id.localeCompare(right.id));

  const variables = byId(map.variables ?? {}).map((set) => ({
    id: set.id,
    name: set.name,
    kind: set.kind,
    optionCount: set.options.length,
    options: set.options.map((option) => ({
      id: option.id,
      ...(option.value !== undefined ? { value: option.value } : {}),
      ...(option.label ? { label: option.label } : {}),
      ...(option.text ? { text: option.text } : {}),
      ...(option.identifier ? { identifier: option.identifier } : {}),
    })),
    sandwich:
      set.apply.kind === "list"
        ? {
            in: Boolean(set.apply.inConnectionId || set.apply.entryPath?.length),
            list: set.options.length > 0,
            out: Boolean(set.apply.outConnectionId || set.apply.exitPath?.length),
          }
        : set.apply.kind === "input"
          ? { inputId: set.apply.inputId }
          : { toggle: true },
  }));
  const tests = byId(map.tests ?? {}).map((work) => ({
    id: work.id,
    name: work.name,
    kind: work.kind,
    ...(work.capture ? { capture: work.capture } : {}),
    stepCount: work.steps.length,
  }));
  const combines = byId(map.combines ?? {}).map((combine) => ({
    id: combine.id,
    name: combine.name,
    formula: [
      ...combine.variableIds.map((id) => map.variables?.[id]?.name ?? id),
      ...combine.testIds.map((id) => map.tests?.[id]?.name ?? id),
    ].join(" × "),
    variableIds: combine.variableIds,
    testIds: combine.testIds,
    ...(combine.selected ? { selected: combine.selected } : {}),
    selectedCounts: Object.fromEntries(
      combine.variableIds.map((id) => [
        id,
        combine.selected?.[id]?.length ?? map.variables?.[id]?.options.length ?? 0,
      ]),
    ),
    ...(combine.captures ? { captures: combine.captures } : {}),
    strategy: combine.strategy ?? (combine.variableIds.length > 1 ? "cartesian" : "zip"),
  }));
  const counts = {
    screens: Object.keys(map.screens).length,
    variants: Object.keys(map.screenVariants).length,
    connections: Object.keys(map.connections).length,
    groups: Object.keys(map.groups).length,
    caseStacks: Object.keys(map.caseStacks).length,
    variables: Object.keys(map.variables ?? {}).length,
    tests: Object.keys(map.tests ?? {}).length,
    combines: Object.keys(map.combines ?? {}).length,
    routines: Object.keys(map.routines).length,
    flows: Object.keys(map.flows).length,
    runs: Object.keys(map.runs).length,
    targetResults: Object.keys(map.targetResults).length,
    proposals: Object.keys(map.proposals).length,
  };

  const list = operationId === "app-map.get" ? resolveAppMapGetList(presentation) : undefined;
  if (list === "variables") return { variables, counts: { variables: counts.variables } };
  if (list === "tests") return { tests };
  if (list === "combines") return { combines };

  return {
    ...(result as Record<string, unknown>),
    appMap: {
      id: map.id,
      name: map.name,
      ...(map.description ? { description: map.description } : {}),
      revision: map.revision,
      screens: byId(map.screens).map((screen) => ({
        id: screen.id,
        title: screen.title,
        variantCount: screen.variantIds.length,
      })),
      connections: byId(map.connections).map((connection) => ({
        id: connection.id,
        ...(connection.label ? { label: connection.label } : {}),
        fromScreenId: connection.fromScreenId,
        destination: connection.destination,
        state: connection.state,
        actionCount: connection.actions.length,
        ...(connection.return
          ? {
              return: {
                kind: connection.return.kind,
                screenId: connection.return.expectedDestination.screenId,
                ...(connection.return.expectedApp
                  ? { expectedApp: connection.return.expectedApp }
                  : {}),
              },
            }
          : {}),
      })),
      groups: byId(map.groups).map((group) => ({
        id: group.id,
        name: group.name,
        screenIds: group.screenIds,
      })),
      flows: byId(map.flows).map((flow) => ({
        id: flow.id,
        name: flow.name,
        startScreenId: flow.startScreenId,
        ...(flow.setup ? { setup: flow.setup } : {}),
        connectionIds: flow.connectionIds,
      })),
      variables,
      tests,
      combines,
      counts,
      createdAt: map.createdAt,
      updatedAt: map.updatedAt,
    },
  };
}
