import {
  combineIdFor,
  variableCanApply,
  type AppMap,
  type AppMapBatchChange,
  type AppMapCombine,
  type AppMapScenarioTest,
} from "@relay/protocol";
import {
  applyIntentDocumentToScenarioTest,
  formatIntentDocumentYaml,
  intentDocumentFromScenarioTest,
  parseIntentDocumentYaml,
} from "@relay/workflows";

export type AppMapTestSourceProjection =
  | { kind: "ready"; source: string }
  | { kind: "unsupported"; message: string };

export type AppMapTestSourceApply =
  | { ok: true; test: AppMapScenarioTest; repeatChanges: AppMapBatchChange[] }
  | { ok: false; message: string };

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function repeatCombine(map: AppMap, test: AppMapScenarioTest): AppMapCombine | undefined {
  const candidates = Object.values(map.combines ?? {}).filter(
    (combine) => combine.testIds.length === 1 && combine.testIds[0] === test.id,
  );
  if (candidates.length > 1) {
    throw new Error(
      "this Test has multiple saved Repeat definitions; choose one in the advanced Repeat editor first",
    );
  }
  return candidates[0];
}

function projectRepeat(map: AppMap, combine: AppMapCombine) {
  const dimensions = combine.variableIds.map((variableId) => {
    const variable = map.variables[variableId];
    if (!variable) throw new Error(`Repeat Variable ${variableId} is missing`);
    const selected = combine.selected?.[variableId];
    if (selected) {
      const available = new Set(variable.options.map((option) => option.id));
      const missing = selected.find((valueId) => !available.has(valueId));
      if (missing)
        throw new Error(`Repeat value ${missing} is missing from Variable ${variableId}`);
    }
    return { variableId, values: selected ? [...selected] : ("all" as const) };
  });
  const strategy = combine.strategy;
  return { ...(strategy ? { strategy } : {}), dimensions };
}

function repeatChanges(input: {
  map: AppMap;
  test: AppMapScenarioTest;
  repeat: ReturnType<typeof projectRepeat> | undefined;
  updatedAt: number;
}): AppMapBatchChange[] {
  const previous = repeatCombine(input.map, input.test);
  if (!input.repeat) {
    return previous ? [{ kind: "combine.remove", combineId: previous.id }] : [];
  }
  const variableIds = input.repeat.dimensions.map((dimension) => dimension.variableId);
  const selected: Record<string, string[]> = {};
  for (const dimension of input.repeat.dimensions) {
    const variable = input.map.variables[dimension.variableId];
    if (!variable) throw new Error(`Repeat Variable ${dimension.variableId} is missing`);
    if (!variableCanApply(variable)) {
      throw new Error(`Repeat Variable ${variable.name} cannot apply and undo`);
    }
    if (dimension.values === "all") continue;
    const available = new Set(variable.options.map((option) => option.id));
    const missing = dimension.values.find((valueId) => !available.has(valueId));
    if (missing) throw new Error(`Repeat value ${missing} is missing from Variable ${variable.id}`);
    selected[variable.id] = [...dimension.values];
  }
  const id = combineIdFor(variableIds, [input.test.id]);
  const existing = input.map.combines[id];
  const variableNames = variableIds.map((id) => input.map.variables[id]!.name);
  const combine: AppMapCombine = {
    id,
    organizationId: input.map.organizationId,
    projectId: input.map.projectId,
    appMapId: input.map.id,
    name: existing?.name ?? `${variableNames.join(" × ")} × ${input.test.name}`,
    variableIds,
    testIds: [input.test.id],
    ...(Object.keys(selected).length ? { selected } : {}),
    ...(input.repeat.strategy ? { strategy: input.repeat.strategy } : {}),
    ...(existing?.captures ? { captures: structuredClone(existing.captures) } : {}),
    ...(existing?.cellRuntimeProfiles
      ? { cellRuntimeProfiles: structuredClone(existing.cellRuntimeProfiles) }
      : {}),
    createdAt: existing?.createdAt ?? input.updatedAt,
    updatedAt: input.updatedAt,
  };
  return [
    ...(previous && previous.id !== id
      ? ([{ kind: "combine.remove", combineId: previous.id }] satisfies AppMapBatchChange[])
      : []),
    { kind: "combine.save", combine },
  ];
}

/** A fail-closed projection over the same canonical Test. Unsupported steps
 * stay untouched in the advanced editor instead of being dropped from YAML. */
export function projectAppMapTestSource(
  map: AppMap,
  test: AppMapScenarioTest,
): AppMapTestSourceProjection {
  try {
    const combine = repeatCombine(map, test);
    const document = intentDocumentFromScenarioTest(map, test);
    return {
      kind: "ready",
      source: formatIntentDocumentYaml({
        ...document,
        ...(combine ? { repeat: projectRepeat(map, combine) } : {}),
      }),
    };
  } catch (error) {
    return { kind: "unsupported", message: messageFor(error) };
  }
}

/** Parse and bind source in memory before the Test document queues a save. No
 * caller can persist a partial parse or a document for another Test. */
export function applyAppMapTestSource(input: {
  map: AppMap;
  current: AppMapScenarioTest;
  source: string;
  updatedAt?: number;
}): AppMapTestSourceApply {
  try {
    const document = parseIntentDocumentYaml(input.source);
    const testDocument = { ...document };
    delete testDocument.repeat;
    const updatedAt = input.updatedAt ?? input.current.updatedAt;
    return {
      ok: true,
      test: applyIntentDocumentToScenarioTest({
        map: input.map,
        current: input.current,
        document: testDocument,
        updatedAt,
      }),
      repeatChanges: repeatChanges({
        map: input.map,
        test: input.current,
        repeat: document.repeat,
        updatedAt,
      }),
    };
  } catch (error) {
    return { ok: false, message: messageFor(error) };
  }
}
