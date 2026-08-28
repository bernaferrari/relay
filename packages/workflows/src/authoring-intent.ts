import type { AppMap, AppMapScenarioTest } from "@relay/protocol";
import { isAlias, isMap, isNode, isScalar, isSeq, parseDocument, stringify } from "yaml";
import type {
  IntentDocument,
  IntentDocumentStep,
  IntentRepeatDimension,
} from "./intent-document.js";

const SCHEMA_VERSION = 1 as const;
const MAX_YAML_BYTES = 256_000;
const MAX_STEPS = 200;
const MAX_REPEAT_DIMENSIONS = 8;
const MAX_REPEAT_VALUES = 1_000;

export const AUTHORING_INTENT_YAML_SUFFIX = ".relay.intent.yaml" as const;

export type AuthoringIntentStep = {
  id: string;
  intent: string;
  use?: string;
  path?: string[];
  bindings?: Record<string, string>;
  checkpoint?: string;
  check?: string;
};

export type AuthoringIntentDocument = {
  schemaVersion: typeof SCHEMA_VERSION;
  kind: "authoring-intent";
  name: string;
  description?: string;
  appMap: string;
  test: string;
  steps: AuthoringIntentStep[];
  repeat?: {
    strategy?: "cartesian" | "zip" | "pairwise";
    dimensions: Array<{ variable: string; values: "all" | "supported" | string[] }>;
  };
};

export type AuthoringIntentBindingDecision = {
  path: string;
  referenceKind:
    | "app-map"
    | "test"
    | "connection"
    | "module"
    | "screen"
    | "check"
    | "variable"
    | "value";
  query: string;
  reason: "not-found" | "ambiguous" | "identity-mismatch";
  candidates: Array<{ id: string; name: string }>;
};

export type AuthoringIntentBindingResult =
  | { status: "bound"; document: IntentDocument }
  | { status: "unresolved"; decisions: AuthoringIntentBindingDecision[] };

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertSafeNode(node: unknown): void {
  if (!node) return;
  if (!isNode(node)) throw new Error("unsupported YAML node in Relay authoring intent");
  if (isAlias(node) || ("anchor" in node && Boolean(node.anchor))) {
    throw new Error("YAML anchors and aliases are not supported in Relay authoring intents");
  }
  if (node.tag) throw new Error("custom YAML tags are not supported in Relay authoring intents");
  if (isMap(node)) {
    for (const item of node.items) {
      assertSafeNode(item.key);
      assertSafeNode(item.value);
    }
  } else if (isSeq(node)) {
    for (const item of node.items) assertSafeNode(item);
  } else if (!isScalar(node)) {
    throw new Error("unsupported YAML node in Relay authoring intent");
  }
}

function assertKnownFields(value: Record<string, unknown>, allowed: string[], field: string): void {
  const known = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!known.has(key)) throw new Error(`unknown ${field} field: ${key}`);
  }
}

function text(value: unknown, field: string, maxLength = 2_000): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  if (value.length > maxLength) throw new Error(`${field} exceeds ${maxLength} characters`);
  return value;
}

function optionalText(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  if (value.length > maxLength) throw new Error(`${field} exceeds ${maxLength} characters`);
  return value;
}

function stepId(value: unknown, field: string): string {
  const id = text(value, field, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(id)) {
    throw new Error(`${field} must be a canonical Relay step id`);
  }
  return id;
}

function bindings(value: unknown, field: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value)) throw new Error(`${field} must be a string mapping`);
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/u.test(key)) {
      throw new Error(`${field}.${key} is not a valid binding name`);
    }
    result[key] = text(raw, `${field}.${key}`);
  }
  return Object.keys(result).length ? result : undefined;
}

function parseStep(value: unknown, index: number): AuthoringIntentStep {
  const field = `steps[${index}]`;
  if (!isObject(value)) throw new Error(`${field} must be an object`);
  assertKnownFields(
    value,
    ["id", "intent", "use", "path", "bindings", "checkpoint", "check"],
    field,
  );
  const use = value.use === undefined ? undefined : text(value.use, `${field}.use`, 200);
  const check = value.check === undefined ? undefined : text(value.check, `${field}.check`, 200);
  const checkpoint =
    value.checkpoint === undefined ? undefined : text(value.checkpoint, `${field}.checkpoint`, 200);
  const path = value.path;
  if (path !== undefined && (!Array.isArray(path) || path.length === 0)) {
    throw new Error(`${field}.path must be a non-empty list of connection names`);
  }
  const pathNames = Array.isArray(path)
    ? path.map((item, pathIndex) => text(item, `${field}.path[${pathIndex}]`, 200))
    : undefined;
  const actions = [use !== undefined, pathNames !== undefined, check !== undefined].filter(Boolean);
  if (checkpoint !== undefined && pathNames === undefined) actions.push(true);
  if (actions.length !== 1) {
    throw new Error(`${field} must define exactly one of use, path, checkpoint, or check`);
  }
  const stepBindings = bindings(value.bindings, `${field}.bindings`);
  if (stepBindings && !use) throw new Error(`${field}.bindings is supported only for use steps`);
  return {
    id: stepId(value.id, `${field}.id`),
    intent: text(value.intent, `${field}.intent`),
    ...(use ? { use } : {}),
    ...(pathNames ? { path: pathNames } : {}),
    ...(stepBindings ? { bindings: stepBindings } : {}),
    ...(checkpoint ? { checkpoint } : {}),
    ...(check ? { check } : {}),
  };
}

function parseValue(value: unknown): AuthoringIntentDocument {
  if (!isObject(value))
    throw new Error("Relay authoring intent must contain an object at the root");
  assertKnownFields(
    value,
    ["schemaVersion", "kind", "name", "description", "appMap", "test", "steps", "repeat"],
    "Relay authoring intent",
  );
  if (value.schemaVersion !== SCHEMA_VERSION)
    throw new Error("unsupported authoring intent schemaVersion");
  if (value.kind !== "authoring-intent") throw new Error("kind must be authoring-intent");
  if (!Array.isArray(value.steps)) throw new Error("steps must be an array");
  if (value.steps.length > MAX_STEPS) throw new Error(`steps exceeds the ${MAX_STEPS} step limit`);
  const steps = value.steps.map(parseStep);
  const ids = new Set<string>();
  for (const step of steps) {
    if (ids.has(step.id)) throw new Error(`duplicate step id: ${step.id}`);
    ids.add(step.id);
  }
  let repeat: AuthoringIntentDocument["repeat"];
  if (value.repeat !== undefined) {
    if (!isObject(value.repeat)) throw new Error("repeat must be an object");
    assertKnownFields(value.repeat, ["strategy", "dimensions"], "repeat");
    const strategy = value.repeat.strategy;
    if (
      strategy !== undefined &&
      strategy !== "cartesian" &&
      strategy !== "zip" &&
      strategy !== "pairwise"
    ) {
      throw new Error("repeat.strategy must be cartesian, zip, or pairwise");
    }
    if (!Array.isArray(value.repeat.dimensions) || value.repeat.dimensions.length === 0) {
      throw new Error("repeat.dimensions must be a non-empty array");
    }
    if (value.repeat.dimensions.length > MAX_REPEAT_DIMENSIONS) {
      throw new Error(`repeat.dimensions exceeds the ${MAX_REPEAT_DIMENSIONS} dimension limit`);
    }
    const dimensions = value.repeat.dimensions.map((raw, index) => {
      const field = `repeat.dimensions[${index}]`;
      if (!isObject(raw)) throw new Error(`${field} must be an object`);
      assertKnownFields(raw, ["variable", "values"], field);
      const variable = text(raw.variable, `${field}.variable`, 200);
      if (raw.values === "all" || raw.values === "supported") {
        return { variable, values: raw.values as "all" | "supported" };
      }
      if (!Array.isArray(raw.values) || raw.values.length === 0) {
        throw new Error(
          `${field}.values must be all, supported, or a non-empty list of value names`,
        );
      }
      if (raw.values.length > MAX_REPEAT_VALUES) {
        throw new Error(`${field}.values exceeds the ${MAX_REPEAT_VALUES} value limit`);
      }
      return {
        variable,
        values: raw.values.map((item, valueIndex) =>
          text(item, `${field}.values[${valueIndex}]`, 200),
        ),
      };
    });
    repeat = { ...(strategy ? { strategy } : {}), dimensions };
  }
  const description = optionalText(value.description, "description", 4_000);
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: "authoring-intent",
    name: text(value.name, "name", 200),
    ...(description !== undefined ? { description } : {}),
    appMap: text(value.appMap, "appMap", 200),
    test: text(value.test, "test", 200),
    steps,
    ...(repeat ? { repeat } : {}),
  };
}

export function parseAuthoringIntentYaml(source: string): AuthoringIntentDocument {
  if (new TextEncoder().encode(source).byteLength > MAX_YAML_BYTES) {
    throw new Error("Relay authoring intent exceeds the 256 KB limit");
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
  if (document.errors.length) throw new Error(document.errors[0]!.message);
  assertSafeNode(document.contents);
  return parseValue(document.toJS({ maxAliasCount: 0 }));
}

export function formatAuthoringIntentYaml(document: AuthoringIntentDocument): string {
  const canonical = parseValue(document);
  return stringify(canonical, {
    indent: 2,
    lineWidth: 100,
    sortMapEntries: false,
    aliasDuplicateObjects: false,
  });
}

export function authoringIntentYamlFilename(testName: string): string {
  const slug = testName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 80);
  if (!slug) throw new Error("testName must contain a letter or number");
  return `${slug}${AUTHORING_INTENT_YAML_SUFFIX}`;
}

type NamedCandidate = { id: string; name: string };

function normalized(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase("en-US");
}

function resolveName(input: {
  query: string;
  candidates: NamedCandidate[];
  path: string;
  referenceKind: AuthoringIntentBindingDecision["referenceKind"];
  decisions: AuthoringIntentBindingDecision[];
}): string | undefined {
  const query = normalized(input.query);
  const idMatches = input.candidates.filter((candidate) => normalized(candidate.id) === query);
  if (idMatches.length === 1) return idMatches[0]!.id;
  const matches = input.candidates.filter((candidate) => normalized(candidate.name) === query);
  if (matches.length === 1) return matches[0]!.id;
  input.decisions.push({
    path: input.path,
    referenceKind: input.referenceKind,
    query: input.query,
    reason: matches.length === 0 ? "not-found" : "ambiguous",
    candidates: (matches.length === 0 ? input.candidates : matches).slice(0, 25),
  });
  return undefined;
}

/** Bind friendly names to one exact App Map revision. This pure module never
 * executes or persists anything: it returns a bound document only when every
 * reference is unique, otherwise callers receive the decisions that need
 * review and no partially bound source. */
export function bindAuthoringIntent(input: {
  map: AppMap;
  current: AppMapScenarioTest;
  document: AuthoringIntentDocument;
}): AuthoringIntentBindingResult {
  const { map, current } = input;
  const document = parseValue(input.document);
  const decisions: AuthoringIntentBindingDecision[] = [];
  resolveName({
    query: document.appMap,
    candidates: [{ id: map.id, name: map.name }],
    path: "appMap",
    referenceKind: "app-map",
    decisions,
  });
  resolveName({
    query: document.test,
    candidates: [{ id: current.id, name: current.name }],
    path: "test",
    referenceKind: "test",
    decisions,
  });

  const connections = Object.values(map.connections).map((connection) => ({
    id: connection.id,
    name: connection.label ?? connection.id,
  }));
  const modules = Object.values(map.routines).map((routine) => ({
    id: routine.id,
    name: routine.name,
  }));
  const screens = Object.values(map.screens).map((screen) => ({
    id: screen.id,
    name: screen.title,
  }));
  const checks = current.steps
    .filter((step) => step.kind === "validation")
    .map((step) => ({ id: step.id, name: step.intent }));
  const variables = Object.values(map.variables).map((variable) => ({
    id: variable.id,
    name: variable.name,
  }));
  const boundSteps: IntentDocumentStep[] = [];

  document.steps.forEach((step, index) => {
    if (step.use) {
      const moduleId = resolveName({
        query: step.use,
        candidates: modules,
        path: `steps[${index}].use`,
        referenceKind: "module",
        decisions,
      });
      if (moduleId)
        boundSteps.push({
          kind: "module",
          id: step.id,
          intent: step.intent,
          moduleId,
          ...(step.bindings ? { bindings: { ...step.bindings } } : {}),
        });
      return;
    }
    if (step.path) {
      const connectionIds = step.path.map((query, pathIndex) =>
        resolveName({
          query,
          candidates: connections,
          path: `steps[${index}].path[${pathIndex}]`,
          referenceKind: "connection",
          decisions,
        }),
      );
      const checkpointScreenId = step.checkpoint
        ? resolveName({
            query: step.checkpoint,
            candidates: screens,
            path: `steps[${index}].checkpoint`,
            referenceKind: "screen",
            decisions,
          })
        : undefined;
      if (
        connectionIds.every((id): id is string => Boolean(id)) &&
        new Set(connectionIds).size !== connectionIds.length
      ) {
        decisions.push({
          path: `steps[${index}].path`,
          referenceKind: "connection",
          query: step.path.join(", "),
          reason: "ambiguous",
          candidates: connections
            .filter((candidate) => connectionIds.includes(candidate.id))
            .slice(0, 25),
        });
        return;
      }
      if (
        connectionIds.every((id): id is string => Boolean(id)) &&
        (!step.checkpoint || checkpointScreenId)
      ) {
        boundSteps.push({
          kind: "path",
          id: step.id,
          intent: step.intent,
          connectionIds,
          ...(checkpointScreenId ? { checkpointScreenId } : {}),
        });
      }
      return;
    }
    if (step.checkpoint) {
      const screenId = resolveName({
        query: step.checkpoint,
        candidates: screens,
        path: `steps[${index}].checkpoint`,
        referenceKind: "screen",
        decisions,
      });
      if (screenId)
        boundSteps.push({ kind: "checkpoint", id: step.id, intent: step.intent, screenId });
      return;
    }
    const testStepId = resolveName({
      query: step.check!,
      candidates: checks,
      path: `steps[${index}].check`,
      referenceKind: "check",
      decisions,
    });
    if (testStepId && step.id !== testStepId) {
      decisions.push({
        path: `steps[${index}].id`,
        referenceKind: "check",
        query: step.id,
        reason: "identity-mismatch",
        candidates: checks.filter((candidate) => candidate.id === testStepId),
      });
      return;
    }
    if (testStepId)
      boundSteps.push({ kind: "check", id: step.id, intent: step.intent, testStepId });
  });

  let repeat: IntentDocument["repeat"];
  if (document.repeat) {
    const dimensions: IntentRepeatDimension[] = [];
    const boundVariableIds = new Set<string>();
    document.repeat.dimensions.forEach((dimension, index) => {
      const variableId = resolveName({
        query: dimension.variable,
        candidates: variables,
        path: `repeat.dimensions[${index}].variable`,
        referenceKind: "variable",
        decisions,
      });
      if (!variableId) return;
      const variable = map.variables[variableId]!;
      if (boundVariableIds.has(variableId)) {
        decisions.push({
          path: `repeat.dimensions[${index}].variable`,
          referenceKind: "variable",
          query: dimension.variable,
          reason: "ambiguous",
          candidates: [{ id: variable.id, name: variable.name }],
        });
        return;
      }
      boundVariableIds.add(variableId);
      if (dimension.values === "all" || dimension.values === "supported") {
        dimensions.push({ id: variableId, values: dimension.values });
        return;
      }
      const options = variable.options.map((option) => ({
        id: option.id,
        name: option.label ?? option.text ?? option.identifier ?? option.id,
      }));
      const valueIds = dimension.values.map((query, valueIndex) =>
        resolveName({
          query,
          candidates: options,
          path: `repeat.dimensions[${index}].values[${valueIndex}]`,
          referenceKind: "value",
          decisions,
        }),
      );
      if (
        valueIds.every((id): id is string => Boolean(id)) &&
        new Set(valueIds).size !== valueIds.length
      ) {
        decisions.push({
          path: `repeat.dimensions[${index}].values`,
          referenceKind: "value",
          query: dimension.values.join(", "),
          reason: "ambiguous",
          candidates: options.filter((option) => valueIds.includes(option.id)).slice(0, 25),
        });
      } else if (valueIds.every((id): id is string => Boolean(id))) {
        dimensions.push({ id: variableId, values: valueIds });
      }
    });
    if (dimensions.length === document.repeat.dimensions.length) {
      repeat = {
        ...(document.repeat.strategy ? { strategy: document.repeat.strategy } : {}),
        dimensions,
      };
    }
  }

  if (decisions.length) return { status: "unresolved", decisions };
  return {
    status: "bound",
    document: {
      schemaVersion: 1,
      kind: "bound-test",
      name: document.name,
      ...(document.description !== undefined ? { description: document.description } : {}),
      appMapId: map.id,
      testId: current.id,
      steps: boundSteps,
      ...(repeat ? { repeat } : {}),
    },
  };
}
