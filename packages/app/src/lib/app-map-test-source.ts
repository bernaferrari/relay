import {
  combineIdFor,
  variableCanApply,
  type AppMap,
  type AppMapBatchChange,
  type AppMapCombine,
  type AppMapScenarioTest,
  type RepeatSpec,
} from "@relay/protocol";
import {
  applyIntentDocumentToScenarioTest,
  bindAuthoringIntent,
  formatAuthoringIntentYaml,
  formatIntentDocumentYaml,
  intentDocumentFromScenarioTest,
  parseAuthoringIntentYaml,
  parseIntentDocumentYaml,
  type AuthoringIntentBindingDecision,
  type AuthoringIntentDocument,
  type IntentDocument,
} from "@relay/workflows";

export type AppMapTestSourceMode = "intent" | "bound";

export type AppMapTestSourceProjection =
  | {
      kind: "ready";
      mode: AppMapTestSourceMode;
      source: string;
      bindingDecisions?: AuthoringIntentBindingDecision[];
    }
  | { kind: "unsupported"; mode: AppMapTestSourceMode; message: string };

export type AppMapTestSourceApply =
  | { ok: true; test: AppMapScenarioTest; repeatChanges: AppMapBatchChange[] }
  | { ok: false; message: string; bindingDecisions?: AuthoringIntentBindingDecision[] };

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
    return {
      id: variableId,
      values: selected
        ? [...selected]
        : (combine.repeatPolicy?.valueModes?.[variableId] ?? ("all" as const)),
    };
  });
  const strategy = combine.strategy;
  return {
    ...(strategy ? { strategy } : {}),
    ...(combine.repeatPolicy?.pilot ? { pilot: structuredClone(combine.repeatPolicy.pilot) } : {}),
    ...(combine.repeatPolicy?.resume ? { resume: combine.repeatPolicy.resume } : {}),
    dimensions,
  };
}

function boundDocument(map: AppMap, test: AppMapScenarioTest): IntentDocument {
  const combine = repeatCombine(map, test);
  return {
    ...intentDocumentFromScenarioTest(map, test),
    ...(combine ? { repeat: projectRepeat(map, combine) } : {}),
  };
}

function namedReference(
  id: string,
  value: { name?: string; title?: string; label?: string } | undefined,
  kind: string,
): string {
  if (!value) throw new Error(`${kind} ${id} is missing`);
  return value.name ?? value.title ?? value.label ?? id;
}

function authoringDocument(
  map: AppMap,
  test: AppMapScenarioTest,
  bound: IntentDocument,
): AuthoringIntentDocument {
  if (bound.repeat?.pilot || bound.repeat?.resume) {
    throw new Error(
      "Intent mode cannot represent the advanced Repeat pilot or resume policy; use Bound mode",
    );
  }
  return {
    schemaVersion: 1,
    kind: "authoring-intent",
    name: bound.name,
    ...(bound.description !== undefined ? { description: bound.description } : {}),
    appMap: map.name,
    test: test.name,
    steps: bound.steps.map((step) => {
      const base = { id: step.id, intent: step.intent };
      if (step.kind === "module") {
        return {
          ...base,
          use: namedReference(step.moduleId, map.routines[step.moduleId], "module"),
          ...(step.bindings ? { bindings: { ...step.bindings } } : {}),
        };
      }
      if (step.kind === "path") {
        return {
          ...base,
          path: step.connectionIds.map((id) =>
            namedReference(id, map.connections[id], "connection"),
          ),
          ...(step.checkpointScreenId
            ? {
                checkpoint: namedReference(
                  step.checkpointScreenId,
                  map.screens[step.checkpointScreenId],
                  "checkpoint Screen",
                ),
              }
            : {}),
        };
      }
      if (step.kind === "checkpoint") {
        return {
          ...base,
          checkpoint: namedReference(
            step.screenId,
            map.screens[step.screenId],
            "checkpoint Screen",
          ),
        };
      }
      const check = test.steps.find(
        (candidate) => candidate.kind === "validation" && candidate.id === step.testStepId,
      );
      if (!check) throw new Error(`check ${step.testStepId} is missing`);
      return { ...base, check: check.intent };
    }),
    ...(bound.repeat
      ? {
          repeat: {
            ...(bound.repeat.strategy ? { strategy: bound.repeat.strategy } : {}),
            dimensions: bound.repeat.dimensions.map((dimension) => {
              const variable = map.variables[dimension.id];
              if (!variable) throw new Error(`Repeat Variable ${dimension.id} is missing`);
              return {
                variable: variable.name,
                values: Array.isArray(dimension.values)
                  ? dimension.values.map((id) => {
                      const option = variable.options.find((candidate) => candidate.id === id);
                      if (!option) throw new Error(`Repeat value ${id} is missing`);
                      return option.label ?? option.text ?? option.identifier ?? option.id;
                    })
                  : dimension.values,
              };
            }),
          },
        }
      : {}),
  };
}

function withoutRecordingSources(document: IntentDocument): IntentDocument {
  const copy = structuredClone(document);
  delete copy.recordingSources;
  return copy;
}

function projectAuthoringSource(
  map: AppMap,
  test: AppMapScenarioTest,
  bound: IntentDocument,
): Extract<AppMapTestSourceProjection, { kind: "ready" }> {
  const document = authoringDocument(map, test, bound);
  const source = formatAuthoringIntentYaml(document);
  const binding = bindAuthoringIntent({ map, current: test, document });
  if (binding.status === "unresolved") {
    return { kind: "ready", mode: "intent", source, bindingDecisions: binding.decisions };
  }
  if (
    JSON.stringify(withoutRecordingSources(binding.document)) !==
    JSON.stringify(withoutRecordingSources(bound))
  ) {
    throw new Error("Intent mode cannot losslessly represent this bound Test; use Bound mode");
  }
  return { kind: "ready", mode: "intent", source };
}

function repeatChanges(input: {
  map: AppMap;
  test: AppMapScenarioTest;
  repeat: RepeatSpec | undefined;
  updatedAt: number;
}): AppMapBatchChange[] {
  const previous = repeatCombine(input.map, input.test);
  if (!input.repeat) {
    return previous ? [{ kind: "combine.remove", combineId: previous.id }] : [];
  }
  const variableIds = input.repeat.dimensions.map((dimension) => dimension.id);
  const selected: Record<string, string[]> = {};
  for (const dimension of input.repeat.dimensions) {
    const variable = input.map.variables[dimension.id];
    if (!variable) throw new Error(`Repeat Variable ${dimension.id} is missing`);
    if (!variableCanApply(variable)) {
      throw new Error(`Repeat Variable ${variable.name} cannot apply and undo`);
    }
    if (dimension.values === "all" || dimension.values === "supported") continue;
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
    ...(input.repeat.pilot ||
    input.repeat.resume ||
    input.repeat.dimensions.some((dimension) => !Array.isArray(dimension.values))
      ? {
          repeatPolicy: {
            ...(input.repeat.pilot ? { pilot: structuredClone(input.repeat.pilot) } : {}),
            ...(input.repeat.resume ? { resume: input.repeat.resume } : {}),
            valueModes: Object.fromEntries(
              input.repeat.dimensions.flatMap((dimension) =>
                Array.isArray(dimension.values) ? [] : [[dimension.id, dimension.values] as const],
              ),
            ),
          },
        }
      : {}),
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
  mode: AppMapTestSourceMode = "bound",
): AppMapTestSourceProjection {
  try {
    const document = boundDocument(map, test);
    if (mode === "intent") return projectAuthoringSource(map, test, document);
    return { kind: "ready", mode, source: formatIntentDocumentYaml(document) };
  } catch (error) {
    return { kind: "unsupported", mode, message: messageFor(error) };
  }
}

function applyBoundDocument(input: {
  map: AppMap;
  current: AppMapScenarioTest;
  document: IntentDocument;
  updatedAt: number;
}): Extract<AppMapTestSourceApply, { ok: true }> {
  const testDocument = { ...input.document };
  delete testDocument.repeat;
  return {
    ok: true,
    test: applyIntentDocumentToScenarioTest({
      map: input.map,
      current: input.current,
      document: testDocument,
      updatedAt: input.updatedAt,
    }),
    repeatChanges: repeatChanges({
      map: input.map,
      test: input.current,
      repeat: input.document.repeat,
      updatedAt: input.updatedAt,
    }),
  };
}

/** Parse and bind source in memory before the Test document queues a save. No
 * caller can persist a partial parse or a document for another Test. */
export function applyAppMapTestSource(input: {
  map: AppMap;
  current: AppMapScenarioTest;
  source: string;
  mode?: AppMapTestSourceMode;
  updatedAt?: number;
}): AppMapTestSourceApply {
  try {
    const updatedAt = input.updatedAt ?? input.current.updatedAt;
    if ((input.mode ?? "bound") === "bound") {
      return applyBoundDocument({
        map: input.map,
        current: input.current,
        document: parseIntentDocumentYaml(input.source),
        updatedAt,
      });
    }
    const binding = bindAuthoringIntent({
      map: input.map,
      current: input.current,
      document: parseAuthoringIntentYaml(input.source),
    });
    if (binding.status === "unresolved") {
      return {
        ok: false,
        message: `Intent needs ${binding.decisions.length} binding decision${binding.decisions.length === 1 ? "" : "s"} before it can be applied`,
        bindingDecisions: binding.decisions,
      };
    }
    const canonical = boundDocument(input.map, input.current);
    const document: IntentDocument = {
      ...binding.document,
      ...(canonical.recordingSources
        ? { recordingSources: structuredClone(canonical.recordingSources) }
        : {}),
    };
    return applyBoundDocument({ map: input.map, current: input.current, document, updatedAt });
  } catch (error) {
    return { ok: false, message: messageFor(error) };
  }
}
