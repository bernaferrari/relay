import { isAlias, isMap, isNode, isScalar, isSeq, parseDocument, stringify } from "yaml";
import type { RepeatDimensionSpec, RepeatSpec } from "@relay/protocol";

const INTENT_DOCUMENT_SCHEMA_VERSION = 1 as const;
const MAX_INTENT_YAML_BYTES = 256_000;
const MAX_STEPS = 200;
const MAX_REPEAT_DIMENSIONS = 8;
const MAX_REPEAT_VALUES = 1_000;
export const BOUND_TEST_YAML_SUFFIX = ".relay.test.yaml" as const;

type IntentStepBase = {
  /** Stable id of the canonical Test step this sentence projects. */
  id: string;
  intent: string;
};

export type IntentModuleStep = IntentStepBase & {
  kind: "module";
  /** Reviewed canonical Routine/module id. Raw actions never enter this document. */
  moduleId: string;
  bindings?: Record<string, string>;
};

export type IntentPathStep = IntentStepBase & {
  kind: "path";
  /** Reviewed canonical App Map connections, in execution order. */
  connectionIds: string[];
  /** A capture after this path, bound to its reviewed destination screen. */
  checkpointScreenId?: string;
};

export type IntentCheckpointStep = IntentStepBase & {
  kind: "checkpoint";
  /** Canonical App Map screen captured after the owning Test step. */
  screenId: string;
};

export type IntentCheckStep = IntentStepBase & {
  kind: "check";
  /** Stable id of the canonical validation Test step. */
  testStepId: string;
};

export type IntentDocumentStep =
  | IntentPathStep
  | IntentModuleStep
  | IntentCheckpointStep
  | IntentCheckStep;

export type IntentRepeatDimension = RepeatDimensionSpec;

/**
 * A small authoring projection over one canonical App Map Test.
 *
 * This is deliberately not an execution plan, App Map export, or evidence bundle.
 * A caller must bind its ids against the exact App Map revision before execution.
 */
export type IntentDocument = {
  schemaVersion: typeof INTENT_DOCUMENT_SCHEMA_VERSION;
  kind: "bound-test";
  name: string;
  description?: string;
  appMapId: string;
  testId: string;
  steps: IntentDocumentStep[];
  repeat?: RepeatSpec;
};

export type IntentDocumentReferences = {
  appMapId: string;
  testId: string;
  connectionIds: string[];
  moduleIds: string[];
  screenIds: string[];
  testStepIds: string[];
  variableIds: string[];
};

type IntentYamlStep = {
  id: string;
  intent: string;
  use?: string;
  path?: string[];
  bindings?: Record<string, string>;
  checkpoint?: string;
  check?: string;
};

type IntentYamlDocument = {
  schemaVersion: number;
  kind: "bound-test";
  name: string;
  description?: string;
  appMap: string;
  test: string;
  steps: IntentYamlStep[];
  repeat?: {
    strategy?: "cartesian" | "zip" | "pairwise";
    pilot?: RepeatSpec["pilot"];
    resume?: RepeatSpec["resume"];
    dimensions: Array<{ variable: string; values: "all" | "supported" | string[] }>;
  };
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertSafeNode(node: unknown): void {
  if (!node) return;
  if (!isNode(node)) throw new Error("unsupported YAML node in Relay intent file");
  if (isAlias(node) || ("anchor" in node && Boolean(node.anchor))) {
    throw new Error("YAML anchors and aliases are not supported in Relay intent files");
  }
  if (node.tag) throw new Error("custom YAML tags are not supported in Relay intent files");
  if (isMap(node)) {
    for (const item of node.items) {
      assertSafeNode(item.key);
      assertSafeNode(item.value);
    }
  } else if (isSeq(node)) {
    for (const item of node.items) assertSafeNode(item);
  } else if (!isScalar(node)) {
    throw new Error("unsupported YAML node in Relay intent file");
  }
}

function assertKnownFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  field: string,
): void {
  const known = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!known.has(key)) throw new Error(`unknown ${field} field: ${key}`);
  }
}

function stringValue(value: unknown, field: string, maxLength = 2_000): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  if (value.length > maxLength) throw new Error(`${field} exceeds ${maxLength} characters`);
  return value;
}

function optionalString(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  if (value.length > maxLength) throw new Error(`${field} exceeds ${maxLength} characters`);
  return value;
}

function canonicalId(value: unknown, field: string): string {
  const id = stringValue(value, field, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(id)) {
    throw new Error(`${field} must be a canonical Relay id`);
  }
  return id;
}

function stringRecord(value: unknown, field: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value)) throw new Error(`${field} must be a string mapping`);
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/u.test(key)) {
      throw new Error(`${field}.${key} is not a valid binding name`);
    }
    if (typeof raw !== "string") throw new Error(`${field}.${key} must be a string`);
    if (raw.length > 2_000) throw new Error(`${field}.${key} exceeds 2000 characters`);
    result[key] = raw;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function sortedRecord(value: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function parseStep(value: unknown, index: number): IntentDocumentStep {
  const field = `steps[${index}]`;
  if (!isObject(value)) throw new Error(`${field} must be an object`);
  assertKnownFields(
    value,
    ["id", "intent", "use", "path", "bindings", "checkpoint", "check"],
    field,
  );
  const id = canonicalId(value.id, `${field}.id`);
  const intent = stringValue(value.intent, `${field}.intent`);
  const actions = ["use", "path", "check"].filter((key) => value[key] !== undefined);
  if (value.checkpoint !== undefined && value.path === undefined) actions.push("checkpoint");
  if (actions.length !== 1) {
    throw new Error(`${field} must define exactly one of use, path, checkpoint, or check`);
  }
  if (actions[0] === "use") {
    const bindings = stringRecord(value.bindings, `${field}.bindings`);
    return {
      kind: "module",
      id,
      intent,
      moduleId: canonicalId(value.use, `${field}.use`),
      ...(bindings ? { bindings } : {}),
    };
  }
  if (actions[0] === "path") {
    if (value.bindings !== undefined) {
      throw new Error(`${field}.bindings is supported only for use steps`);
    }
    if (!Array.isArray(value.path) || value.path.length === 0) {
      throw new Error(`${field}.path must be a non-empty list of canonical connection ids`);
    }
    const connectionIds = value.path.map((item, pathIndex) =>
      canonicalId(item, `${field}.path[${pathIndex}]`),
    );
    if (new Set(connectionIds).size !== connectionIds.length) {
      throw new Error(`${field}.path must not contain duplicate connections`);
    }
    return {
      kind: "path",
      id,
      intent,
      connectionIds,
      ...(value.checkpoint === undefined
        ? {}
        : { checkpointScreenId: canonicalId(value.checkpoint, `${field}.checkpoint`) }),
    };
  }
  if (value.bindings !== undefined) {
    throw new Error(`${field}.bindings is supported only for use steps`);
  }
  if (actions[0] === "checkpoint") {
    return {
      kind: "checkpoint",
      id,
      intent,
      screenId: canonicalId(value.checkpoint, `${field}.checkpoint`),
    };
  }
  return {
    kind: "check",
    id,
    intent,
    testStepId: canonicalId(value.check, `${field}.check`),
  };
}

function parseRepeat(value: unknown): IntentDocument["repeat"] {
  if (value === undefined) return undefined;
  if (!isObject(value)) throw new Error("repeat must be an object");
  assertKnownFields(value, ["strategy", "pilot", "resume", "dimensions"], "repeat");
  const strategy = value.strategy;
  if (
    strategy !== undefined &&
    strategy !== "cartesian" &&
    strategy !== "zip" &&
    strategy !== "pairwise"
  ) {
    throw new Error("repeat.strategy must be cartesian, zip, or pairwise");
  }
  if (!Array.isArray(value.dimensions) || value.dimensions.length === 0) {
    throw new Error("repeat.dimensions must be a non-empty array");
  }
  if (value.dimensions.length > MAX_REPEAT_DIMENSIONS) {
    throw new Error(`repeat.dimensions exceeds the ${MAX_REPEAT_DIMENSIONS} dimension limit`);
  }
  const seen = new Set<string>();
  const dimensions = value.dimensions.map((raw, index): IntentRepeatDimension => {
    const field = `repeat.dimensions[${index}]`;
    if (!isObject(raw)) throw new Error(`${field} must be an object`);
    assertKnownFields(raw, ["variable", "values"], field);
    const id = canonicalId(raw.variable, `${field}.variable`);
    if (seen.has(id)) throw new Error(`duplicate repeat variable: ${id}`);
    seen.add(id);
    if (raw.values === "all" || raw.values === "supported") return { id, values: raw.values };
    if (!Array.isArray(raw.values) || raw.values.length === 0) {
      throw new Error(`${field}.values must be all or a non-empty list of canonical value ids`);
    }
    if (raw.values.length > MAX_REPEAT_VALUES) {
      throw new Error(`${field}.values exceeds the ${MAX_REPEAT_VALUES} value limit`);
    }
    const values = raw.values.map((item, valueIndex) =>
      canonicalId(item, `${field}.values[${valueIndex}]`),
    );
    if (new Set(values).size !== values.length) {
      throw new Error(`${field}.values must not contain duplicates`);
    }
    return { id, values };
  });
  const pilot = value.pilot;
  let normalizedPilot: RepeatSpec["pilot"];
  if (pilot !== undefined) {
    if (!isObject(pilot)) throw new Error("repeat.pilot must be an object");
    assertKnownFields(pilot, ["mode", "case"], "repeat.pilot");
    if (pilot.mode !== "representative" && pilot.mode !== "first" && pilot.mode !== "specified") {
      throw new Error("repeat.pilot.mode must be representative, first, or specified");
    }
    if (pilot.mode === "specified") {
      if (!isObject(pilot.case)) throw new Error("repeat.pilot.case must be an object");
      const specified = Object.fromEntries(
        Object.entries(pilot.case).map(([id, rawValue]) => [
          canonicalId(id, "repeat.pilot.case dimension"),
          canonicalId(rawValue, `repeat.pilot.case.${id}`),
        ]),
      );
      if (
        Object.keys(specified).length !== dimensions.length ||
        dimensions.some((dimension) => !Object.hasOwn(specified, dimension.id))
      ) {
        throw new Error("repeat.pilot.case must name every Repeat dimension exactly once");
      }
      normalizedPilot = { mode: "specified", case: specified };
    } else if (pilot.case !== undefined) {
      throw new Error("repeat.pilot.case is supported only for specified pilots");
    } else {
      normalizedPilot = { mode: pilot.mode };
    }
  }
  const resume = value.resume;
  if (resume !== undefined && resume !== "untouched" && resume !== "failed" && resume !== "all") {
    throw new Error("repeat.resume must be untouched, failed, or all");
  }
  return {
    ...(strategy ? { strategy } : {}),
    ...(normalizedPilot ? { pilot: normalizedPilot } : {}),
    ...(resume ? { resume } : {}),
    dimensions,
  };
}

function parseIntentValue(value: unknown): IntentDocument {
  if (!isObject(value)) throw new Error("Relay intent YAML must contain an object at the root");
  assertKnownFields(
    value,
    ["schemaVersion", "kind", "name", "description", "appMap", "test", "steps", "repeat"],
    "Relay intent",
  );
  if (value.schemaVersion !== INTENT_DOCUMENT_SCHEMA_VERSION) {
    throw new Error("unsupported Relay intent schemaVersion");
  }
  if (value.kind !== "bound-test" && value.kind !== "test-intent") {
    throw new Error("kind must be bound-test");
  }
  if (!Array.isArray(value.steps)) throw new Error("steps must be an array");
  if (value.steps.length > MAX_STEPS) throw new Error(`steps exceeds the ${MAX_STEPS} step limit`);
  const steps = value.steps.map(parseStep);
  const stepIds = new Set<string>();
  for (const step of steps) {
    if (stepIds.has(step.id)) throw new Error(`duplicate step id: ${step.id}`);
    stepIds.add(step.id);
  }
  const description = optionalString(value.description, "description", 4_000);
  const repeat = parseRepeat(value.repeat);
  return {
    schemaVersion: INTENT_DOCUMENT_SCHEMA_VERSION,
    kind: "bound-test",
    name: stringValue(value.name, "name", 200),
    ...(description !== undefined ? { description } : {}),
    appMapId: canonicalId(value.appMap, "appMap"),
    testId: canonicalId(value.test, "test"),
    steps,
    ...(repeat ? { repeat } : {}),
  };
}

function yamlShape(document: IntentDocument): IntentYamlDocument {
  return {
    schemaVersion: document.schemaVersion,
    kind: document.kind,
    name: document.name,
    ...(document.description !== undefined ? { description: document.description } : {}),
    appMap: document.appMapId,
    test: document.testId,
    steps: document.steps.map((step): IntentYamlStep => {
      if (step.kind === "module") {
        return {
          id: step.id,
          intent: step.intent,
          use: step.moduleId,
          ...(step.bindings ? { bindings: sortedRecord(step.bindings) } : {}),
        };
      }
      if (step.kind === "path") {
        return {
          id: step.id,
          intent: step.intent,
          path: [...step.connectionIds],
          ...(step.checkpointScreenId ? { checkpoint: step.checkpointScreenId } : {}),
        };
      }
      if (step.kind === "checkpoint") {
        return { id: step.id, intent: step.intent, checkpoint: step.screenId };
      }
      return { id: step.id, intent: step.intent, check: step.testStepId };
    }),
    ...(document.repeat
      ? {
          repeat: {
            dimensions: document.repeat.dimensions.map((dimension) => ({
              variable: dimension.id,
              values: dimension.values,
            })),
            ...(document.repeat.strategy ? { strategy: document.repeat.strategy } : {}),
            ...(document.repeat.pilot ? { pilot: document.repeat.pilot } : {}),
            ...(document.repeat.resume ? { resume: document.repeat.resume } : {}),
          },
        }
      : {}),
  };
}

export function parseIntentDocumentYaml(source: string): IntentDocument {
  if (new TextEncoder().encode(source).byteLength > MAX_INTENT_YAML_BYTES) {
    throw new Error("Relay intent YAML exceeds the 256 KB limit");
  }
  const document = parseDocument(source, {
    version: "1.2",
    schema: "core",
    strict: true,
    uniqueKeys: true,
    prettyErrors: true,
    stringKeys: true,
    merge: false,
  });
  if (document.errors.length > 0) throw new Error(document.errors[0]!.message);
  assertSafeNode(document.contents);
  return parseIntentValue(document.toJS({ maxAliasCount: 0 }));
}

export function formatIntentDocumentYaml(document: IntentDocument): string {
  // Reparse the plain projection so runtime callers cannot serialize unsupported
  // fields by casting an arbitrary object to IntentDocument.
  const canonical = parseIntentValue(yamlShape(document));
  return stringify(yamlShape(canonical), {
    indent: 2,
    lineWidth: 100,
    sortMapEntries: false,
    aliasDuplicateObjects: false,
  });
}

export function intentDocumentReferences(document: IntentDocument): IntentDocumentReferences {
  const canonical = parseIntentValue(yamlShape(document));
  return {
    appMapId: canonical.appMapId,
    testId: canonical.testId,
    moduleIds: canonical.steps
      .filter((step): step is IntentModuleStep => step.kind === "module")
      .map((step) => step.moduleId),
    connectionIds: canonical.steps
      .filter((step): step is IntentPathStep => step.kind === "path")
      .flatMap((step) => step.connectionIds),
    screenIds: canonical.steps.flatMap((step) => {
      if (step.kind === "checkpoint") return [step.screenId];
      if (step.kind === "path" && step.checkpointScreenId) return [step.checkpointScreenId];
      return [];
    }),
    testStepIds: canonical.steps.map((step) => (step.kind === "check" ? step.testStepId : step.id)),
    variableIds: canonical.repeat?.dimensions.map((dimension) => dimension.id) ?? [],
  };
}

export function intentDocumentYamlFilename(testId: string): string {
  return `${canonicalId(testId, "testId")}${BOUND_TEST_YAML_SUFFIX}`;
}
