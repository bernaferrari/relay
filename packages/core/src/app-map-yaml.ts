import { isAlias, isMap, isNode, isScalar, isSeq, parseDocument, stringify } from "yaml";
import type {
  AppMap,
  AppMapEntity,
  AppMapScope,
  Proposal,
  ProposalChange,
  SerializedAppMap,
} from "@relay/protocol";
import { serializeAppMap, validateAppMap } from "./app-map.js";

const MAX_APP_MAP_YAML_BYTES = 5_000_000;
const APP_MAP_FIELDS = new Set([
  "schemaVersion",
  "id",
  "organizationId",
  "projectId",
  "name",
  "description",
  "revision",
  "notes",
  "groups",
  "logicalStates",
  "actionIntents",
  "screens",
  "screenVariants",
  "connections",
  "caseStacks",
  "variables",
  "tests",
  "combines",
  "routines",
  "flows",
  "runs",
  "targetResults",
  "proposals",
  "activity",
  "createdAt",
  "updatedAt",
]);
const ENTITY_FIELDS = [
  "notes",
  "groups",
  "logicalStates",
  "actionIntents",
  "screens",
  "screenVariants",
  "connections",
  "caseStacks",
  "variables",
  "tests",
  "combines",
  "routines",
  "flows",
  "runs",
  "targetResults",
  "proposals",
  "activity",
] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertSafeNode(node: unknown): void {
  if (!node) return;
  if (!isNode(node)) throw new Error("unsupported YAML node in Relay App Map file");
  if (isAlias(node) || ("anchor" in node && Boolean(node.anchor))) {
    throw new Error("YAML anchors and aliases are not supported in Relay App Map files");
  }
  if (node.tag) throw new Error("custom YAML tags are not supported in Relay App Map files");
  if (isMap(node)) {
    for (const item of node.items) {
      assertSafeNode(item.key);
      assertSafeNode(item.value);
    }
  } else if (isSeq(node)) {
    for (const item of node.items) assertSafeNode(item);
  } else if (!isScalar(node)) throw new Error("unsupported YAML node in Relay App Map file");
}

function entityRecord(value: unknown, field: string): Record<string, unknown> {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  const record: Record<string, unknown> = {};
  for (const [index, entity] of value.entries()) {
    if (!isObject(entity)) throw new Error(`${field}[${index}] must be an object`);
    if (typeof entity.id !== "string" || !entity.id.trim()) {
      throw new Error(`${field}[${index}].id must be a non-empty string`);
    }
    if (record[entity.id]) throw new Error(`${field} contains duplicate id ${entity.id}`);
    record[entity.id] = entity;
  }
  return record;
}

function scoped<T extends AppMapEntity>(value: T, scope: AppMapScope): T {
  return { ...value, ...scope };
}

function scopedProposalChange(value: ProposalChange, scope: AppMapScope): ProposalChange {
  if (value.kind === "screen.add") {
    return {
      ...value,
      input: {
        screen: scoped(value.input.screen, scope),
        ...(value.input.variants
          ? { variants: value.input.variants.map((variant) => scoped(variant, scope)) }
          : {}),
      },
    };
  }
  if (value.kind === "screen.update" && value.input.upsertVariants) {
    return {
      ...value,
      input: {
        ...value.input,
        upsertVariants: value.input.upsertVariants.map((variant) => scoped(variant, scope)),
      },
    };
  }
  if (value.kind === "connection.connect") {
    return { ...value, connection: scoped(value.connection, scope) };
  }
  if (value.kind === "group.save") {
    return { ...value, group: scoped(value.group, scope) };
  }
  return structuredClone(value);
}

/** Rebinds a portable map to its destination project without changing stable entity ids. */
export function rescopeAppMap(
  value: AppMap,
  destination: { organizationId: string; projectId: string; appMapId?: string },
): AppMap {
  const appMapId = destination.appMapId ?? value.id;
  const scope = {
    organizationId: destination.organizationId,
    projectId: destination.projectId,
    appMapId,
  };
  const mapEntities = <T extends AppMapEntity>(record: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.entries(record).map(([id, entity]) => [id, scoped(entity, scope)]));
  const proposals = Object.fromEntries(
    Object.entries(value.proposals).map(([id, proposal]) => [
      id,
      {
        ...scoped(proposal, scope),
        changes: proposal.changes.map((change) => scopedProposalChange(change, scope)),
      } satisfies Proposal,
    ]),
  );
  const activity = Object.fromEntries(
    Object.entries(value.activity).map(([id, event]) => [id, { ...event, ...scope }]),
  );
  return validateAppMap({
    ...value,
    id: appMapId,
    organizationId: destination.organizationId,
    projectId: destination.projectId,
    notes: mapEntities(value.notes),
    groups: mapEntities(value.groups),
    logicalStates: mapEntities(value.logicalStates ?? {}),
    actionIntents: mapEntities(value.actionIntents ?? {}),
    screens: mapEntities(value.screens),
    screenVariants: mapEntities(value.screenVariants),
    connections: mapEntities(value.connections),
    caseStacks: mapEntities(value.caseStacks),
    variables: mapEntities(value.variables ?? {}),
    tests: mapEntities(value.tests ?? {}),
    combines: mapEntities(value.combines ?? {}),
    routines: mapEntities(value.routines),
    flows: mapEntities(value.flows),
    runs: mapEntities(value.runs),
    targetResults: mapEntities(value.targetResults),
    proposals,
    activity,
  });
}

export function parseAppMapYaml(
  source: string,
  destination?: { organizationId: string; projectId: string; appMapId?: string },
): AppMap {
  if (Buffer.byteLength(source, "utf8") > MAX_APP_MAP_YAML_BYTES) {
    throw new Error("Relay App Map YAML exceeds the 5 MB limit");
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
  const value = document.toJS({ maxAliasCount: 0 });
  if (!isObject(value)) throw new Error("Relay App Map YAML must contain an object at the root");
  for (const key of Object.keys(value)) {
    if (!APP_MAP_FIELDS.has(key)) throw new Error(`unknown Relay App Map field: ${key}`);
  }
  for (const field of ENTITY_FIELDS) {
    const raw =
      value[field] ??
      (field === "variables" ||
      field === "tests" ||
      field === "combines" ||
      field === "logicalStates" ||
      field === "actionIntents"
        ? []
        : value[field]);
    value[field] = entityRecord(raw, field);
  }
  const appMap = validateAppMap(value as AppMap);
  return destination ? rescopeAppMap(appMap, destination) : appMap;
}

export function formatAppMapYaml(value: AppMap): string {
  return stringify(serializeAppMap(value) satisfies SerializedAppMap, {
    indent: 2,
    lineWidth: 100,
    sortMapEntries: false,
    aliasDuplicateObjects: false,
  });
}

export function appMapYamlFilename(id: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,95}$/.test(id)) throw new Error("invalid App Map id");
  return `${id}.relay.map.yaml`;
}
