import type {
  JourneyCanvasNote,
  JourneyGraphFlow,
  JourneyGraphScreen,
  JourneyGraphTransition,
  JourneyMetadata,
} from "@relay/protocol";
import * as Y from "yjs";
import {
  COLLABORATIVE_JOURNEY_DRAFT_KEYS,
  COLLABORATIVE_JOURNEY_LIMITS,
  COLLABORATIVE_JOURNEY_ORDER_FIELD,
  COLLABORATIVE_JOURNEY_ROOT_KEY,
  COLLABORATIVE_JOURNEY_ROOT_KEYS,
  COLLABORATIVE_JOURNEY_SCHEMA_VERSION,
} from "./constants.js";
import { cloneBytes, fromYValue, isPlainRecord, toYValue } from "./y-values.js";

export * from "./constants.js";

export type CollaborativeJourneyIssueCode =
  | "bounds"
  | "dangling-reference"
  | "duplicate-id"
  | "forbidden-field"
  | "invalid-schema"
  | "invalid-shape"
  | "missing-id"
  | "server-owned-field";

export type CollaborativeJourneyIssue = {
  code: CollaborativeJourneyIssueCode;
  path: string;
  message: string;
};

export type ServerOwnedJourneyField = {
  path: string;
  entity: "screen" | "connection";
  entityId: string;
  field:
    | "representativeStepId"
    | "stepIds"
    | "evidenceIds"
    | "takeId"
    | "videoTakeId"
    | "videoClip"
    | "review"
    | "recordedState";
  value: unknown;
};

export type ServerOwnedFieldDecision = "preserve" | "strip" | "reject";
export type ServerOwnedFieldValidator = (
  field: Readonly<ServerOwnedJourneyField>,
) => ServerOwnedFieldDecision;

export type CollaborativeJourneyMaterializationOptions = {
  /**
   * Called for every field that can point at executable steps, committed
   * evidence, or reviewed state. Omitted validators strip those fields. A
   * server may return `preserve` only after matching the value to its own
   * authoritative aggregate; untrusted direct edits should use `reject`.
   */
  validateServerOwnedField?: ServerOwnedFieldValidator;
};

export type CollaborativeJourneyReconciliationOptions =
  CollaborativeJourneyMaterializationOptions & {
    /** Transaction origin forwarded to the live document for undo and presence semantics. */
    origin?: unknown;
  };

export type CollaborativeJourneyValidationResult = {
  ok: boolean;
  metadata?: JourneyMetadata;
  issues: CollaborativeJourneyIssue[];
  serverOwnedFields: Array<ServerOwnedJourneyField & { decision: ServerOwnedFieldDecision }>;
};

export class CollaborativeJourneyValidationError extends Error {
  readonly result: CollaborativeJourneyValidationResult;

  constructor(result: CollaborativeJourneyValidationResult) {
    super(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    this.name = "CollaborativeJourneyValidationError";
    this.result = result;
  }
}

type RootCollectionKey =
  | typeof COLLABORATIVE_JOURNEY_ROOT_KEYS.screens
  | typeof COLLABORATIVE_JOURNEY_ROOT_KEYS.connections
  | typeof COLLABORATIVE_JOURNEY_ROOT_KEYS.flows
  | typeof COLLABORATIVE_JOURNEY_ROOT_KEYS.positions
  | typeof COLLABORATIVE_JOURNEY_ROOT_KEYS.notes;

type MutableContext = {
  issues: CollaborativeJourneyIssue[];
  serverOwnedFields: Array<ServerOwnedJourneyField & { decision: ServerOwnedFieldDecision }>;
  validateServerOwnedField?: ServerOwnedFieldValidator;
};

const ROOT_KEY_SET = new Set<string>(Object.values(COLLABORATIVE_JOURNEY_ROOT_KEYS));
const DRAFT_KEY_SET = new Set<string>(Object.values(COLLABORATIVE_JOURNEY_DRAFT_KEYS));

function issue(
  context: MutableContext,
  code: CollaborativeJourneyIssueCode,
  path: string,
  message: string,
): void {
  context.issues.push({ code, path, message });
}

function assertOpaqueBytes(value: Uint8Array, maximum: number, label: string): void {
  if (!(value instanceof Uint8Array)) throw new TypeError(`${label} must be a Uint8Array`);
  if (value.byteLength > maximum) throw new RangeError(`${label} exceeds ${maximum} bytes`);
}

function assertEntityIds(
  values: ReadonlyArray<{ id: string }>,
  path: string,
  maximum: number,
): void {
  if (values.length > maximum) throw new Error(`${path} exceeds ${maximum} entities`);
  const ids = new Set<string>();
  for (let index = 0; index < values.length; index += 1) {
    const id = values[index]?.id;
    if (typeof id !== "string" || !id.trim()) throw new Error(`${path}[${index}].id is required`);
    if (id.length > COLLABORATIVE_JOURNEY_LIMITS.idLength) {
      throw new Error(`${path}[${index}].id exceeds the ID length bound`);
    }
    if (ids.has(id)) throw new Error(`${path} contains duplicate id ${id}`);
    ids.add(id);
  }
}

function assertCanonicalBootstrap(
  metadata: JourneyMetadata,
): asserts metadata is JourneyMetadata & {
  schemaVersion: 6;
  graph: NonNullable<JourneyMetadata["graph"]>;
} {
  if (metadata.schemaVersion !== 6) throw new Error("JourneyMetadata schemaVersion must be 6");
  if (metadata.graph?.schemaVersion !== 1) throw new Error("Journey graph schemaVersion must be 1");
  assertEntityIds(metadata.graph.screens, "graph.screens", COLLABORATIVE_JOURNEY_LIMITS.screens);
  assertEntityIds(
    metadata.graph.transitions,
    "graph.transitions",
    COLLABORATIVE_JOURNEY_LIMITS.connections,
  );
  assertEntityIds(metadata.graph.flows, "graph.flows", COLLABORATIVE_JOURNEY_LIMITS.flows);
  assertEntityIds(metadata.notes ?? [], "notes", COLLABORATIVE_JOURNEY_LIMITS.notes);
}

function setEntityFields(map: Y.Map<unknown>, value: Record<string, unknown>, order: number): void {
  map.set(COLLABORATIVE_JOURNEY_ORDER_FIELD, order);
  for (const key of Object.keys(value).sort()) {
    if (key === "id" || value[key] === undefined) continue;
    map.set(key, toYValue(value[key]));
  }
}

function writeEntities<T extends { id: string }>(
  root: Y.Map<unknown>,
  key: RootCollectionKey,
  values: readonly T[],
): void {
  const collection = new Y.Map<Y.Map<unknown>>();
  values.forEach((value, order) => {
    const entity = new Y.Map<unknown>();
    setEntityFields(entity, value as unknown as Record<string, unknown>, order);
    collection.set(value.id, entity);
  });
  root.set(key, collection);
}

function writePositions(root: Y.Map<unknown>, positions: JourneyMetadata["positions"]): void {
  const collection = new Y.Map<Y.Map<unknown>>();
  for (const id of Object.keys(positions).sort()) {
    const position = new Y.Map<unknown>();
    position.set("x", positions[id]!.x);
    position.set("y", positions[id]!.y);
    collection.set(id, position);
  }
  root.set(COLLABORATIVE_JOURNEY_ROOT_KEYS.positions, collection);
}

function writeDraft(root: Y.Map<unknown>, metadata: JourneyMetadata): void {
  const draft = new Y.Map<unknown>();
  for (const [key, values] of [
    [COLLABORATIVE_JOURNEY_DRAFT_KEYS.screenTitles, metadata.screenTitles ?? {}],
    [COLLABORATIVE_JOURNEY_DRAFT_KEYS.edgeLabels, metadata.edgeLabels],
    [COLLABORATIVE_JOURNEY_DRAFT_KEYS.edgeKinds, metadata.edgeKinds],
  ] as const) {
    const map = new Y.Map<string>();
    for (const id of Object.keys(values).sort()) map.set(id, values[id]!);
    draft.set(key, map);
  }
  root.set(COLLABORATIVE_JOURNEY_ROOT_KEYS.draft, draft);
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  return left.every((value, index) => value === right[index]);
}

function reconcileArray(target: Y.Array<unknown>, desired: readonly unknown[]): void {
  const sharedLength = Math.min(target.length, desired.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const current = target.get(index);
    const next = desired[index];
    if (current instanceof Y.Map && isPlainRecord(next) && !(next instanceof Uint8Array)) {
      reconcileMap(current, next);
    } else if (current instanceof Y.Array && Array.isArray(next)) {
      reconcileArray(current, next);
    } else if (
      !Object.is(current, next) &&
      !(current instanceof Uint8Array && next instanceof Uint8Array && equalBytes(current, next))
    ) {
      target.delete(index, 1);
      target.insert(index, [toYValue(next)]);
    }
  }
  if (target.length > desired.length) target.delete(desired.length, target.length - desired.length);
  if (desired.length > target.length) {
    target.insert(target.length, desired.slice(target.length).map(toYValue));
  }
}

function reconcileMap(target: Y.Map<unknown>, desired: Readonly<Record<string, unknown>>): void {
  const desiredKeys = new Set(Object.keys(desired).filter((key) => desired[key] !== undefined));
  for (const key of [...target.keys()].sort()) {
    if (!desiredKeys.has(key)) target.delete(key);
  }
  for (const key of [...desiredKeys].sort()) {
    const current = target.get(key);
    const next = desired[key];
    if (current instanceof Y.Map && isPlainRecord(next) && !(next instanceof Uint8Array)) {
      reconcileMap(current, next);
    } else if (current instanceof Y.Array && Array.isArray(next)) {
      reconcileArray(current, next);
    } else if (
      !Object.is(current, next) &&
      !(current instanceof Uint8Array && next instanceof Uint8Array && equalBytes(current, next))
    ) {
      target.set(key, toYValue(next));
    }
  }
}

function ensureMap(target: Y.Map<unknown>, key: string): Y.Map<unknown> {
  const current = target.get(key);
  if (current instanceof Y.Map) return current;
  const created = new Y.Map<unknown>();
  target.set(key, created);
  return created;
}

function reconcileEntityCollection<T extends { id: string }>(
  root: Y.Map<unknown>,
  key: RootCollectionKey,
  values: readonly T[],
): void {
  const collection = ensureMap(root, key);
  const desiredIds = new Set(values.map((value) => value.id));
  for (const id of [...collection.keys()].sort()) {
    if (!desiredIds.has(id)) collection.delete(id);
  }
  values.forEach((value, order) => {
    const current = collection.get(value.id);
    const entity = current instanceof Y.Map ? current : new Y.Map<unknown>();
    if (entity !== current) collection.set(value.id, entity);
    const { id: _id, ...fields } = value;
    reconcileMap(entity, { ...fields, [COLLABORATIVE_JOURNEY_ORDER_FIELD]: order });
  });
}

function reconcileKeyedRecords(
  root: Y.Map<unknown>,
  key: RootCollectionKey,
  values: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
): void {
  const collection = ensureMap(root, key);
  const desiredIds = new Set(Object.keys(values));
  for (const id of [...collection.keys()].sort()) {
    if (!desiredIds.has(id)) collection.delete(id);
  }
  for (const id of [...desiredIds].sort()) {
    const current = collection.get(id);
    const entity = current instanceof Y.Map ? current : new Y.Map<unknown>();
    if (entity !== current) collection.set(id, entity);
    reconcileMap(entity, values[id]!);
  }
}

function reconcileStringMap(
  parent: Y.Map<unknown>,
  key: string,
  values: Readonly<Record<string, string>>,
): void {
  reconcileMap(ensureMap(parent, key), values);
}

function reconcileCanonicalProjection(doc: Y.Doc, metadata: JourneyMetadata): void {
  const root = getCollaborativeJourneyRoot(doc);
  for (const key of [...root.keys()].sort()) {
    if (!ROOT_KEY_SET.has(key)) root.delete(key);
  }
  if (
    root.get(COLLABORATIVE_JOURNEY_ROOT_KEYS.schemaVersion) !== COLLABORATIVE_JOURNEY_SCHEMA_VERSION
  ) {
    root.set(COLLABORATIVE_JOURNEY_ROOT_KEYS.schemaVersion, COLLABORATIVE_JOURNEY_SCHEMA_VERSION);
  }
  reconcileEntityCollection(root, COLLABORATIVE_JOURNEY_ROOT_KEYS.screens, metadata.graph!.screens);
  reconcileEntityCollection(
    root,
    COLLABORATIVE_JOURNEY_ROOT_KEYS.connections,
    metadata.graph!.transitions,
  );
  reconcileEntityCollection(root, COLLABORATIVE_JOURNEY_ROOT_KEYS.flows, metadata.graph!.flows);
  reconcileKeyedRecords(root, COLLABORATIVE_JOURNEY_ROOT_KEYS.positions, metadata.positions);
  reconcileEntityCollection(root, COLLABORATIVE_JOURNEY_ROOT_KEYS.notes, metadata.notes ?? []);
  const draft = ensureMap(root, COLLABORATIVE_JOURNEY_ROOT_KEYS.draft);
  for (const key of [...draft.keys()].sort()) {
    if (!DRAFT_KEY_SET.has(key)) draft.delete(key);
  }
  reconcileStringMap(
    draft,
    COLLABORATIVE_JOURNEY_DRAFT_KEYS.screenTitles,
    metadata.screenTitles ?? {},
  );
  reconcileStringMap(draft, COLLABORATIVE_JOURNEY_DRAFT_KEYS.edgeLabels, metadata.edgeLabels);
  reconcileStringMap(draft, COLLABORATIVE_JOURNEY_DRAFT_KEYS.edgeKinds, metadata.edgeKinds);
}

/**
 * Purely projects canonical v6 authoring metadata into a new Y.Doc. Takes,
 * Journey review, prototype verification/device state, recipes, Runs, leases,
 * Authoring Sessions, recording state, and evidence bytes have no root key and
 * are intentionally absent. Canonical step/review/evidence references remain
 * available for display, but materialization strips them unless server-verified.
 */
export function createCollaborativeJourneyDoc(metadata: JourneyMetadata): Y.Doc {
  assertCanonicalBootstrap(metadata);
  const doc = new Y.Doc({ gc: true });
  const root = getCollaborativeJourneyRoot(doc);
  doc.transact(() => {
    root.set(COLLABORATIVE_JOURNEY_ROOT_KEYS.schemaVersion, COLLABORATIVE_JOURNEY_SCHEMA_VERSION);
    writeEntities(root, COLLABORATIVE_JOURNEY_ROOT_KEYS.screens, metadata.graph.screens);
    writeEntities(root, COLLABORATIVE_JOURNEY_ROOT_KEYS.connections, metadata.graph.transitions);
    writeEntities(root, COLLABORATIVE_JOURNEY_ROOT_KEYS.flows, metadata.graph.flows);
    writePositions(root, metadata.positions);
    writeEntities(root, COLLABORATIVE_JOURNEY_ROOT_KEYS.notes, metadata.notes ?? []);
    writeDraft(root, metadata);
  }, "relay:bootstrap");

  const result = validateCollaborativeJourney(doc, {
    validateServerOwnedField: () => "preserve",
  });
  if (!result.ok) {
    doc.destroy();
    throw new CollaborativeJourneyValidationError(result);
  }
  return doc;
}

/** Alias emphasizing the canonical bootstrap/export boundary. */
export const bootstrapJourneyDocument = createCollaborativeJourneyDoc;

export function getCollaborativeJourneyRoot(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap<unknown>(COLLABORATIVE_JOURNEY_ROOT_KEY);
}

export function getCollaborativeJourneyEntityMap(
  doc: Y.Doc,
  key: RootCollectionKey,
): Y.Map<Y.Map<unknown>> {
  const value = getCollaborativeJourneyRoot(doc).get(key);
  if (!(value instanceof Y.Map))
    throw new Error(`Collaborative Journey root ${key} is not a Y.Map`);
  return value as Y.Map<Y.Map<unknown>>;
}

function readRootMap(
  root: Y.Map<unknown>,
  key: string,
  context: MutableContext,
): Y.Map<unknown> | undefined {
  const value = root.get(key);
  if (!(value instanceof Y.Map)) {
    issue(context, "invalid-shape", key, "must be a Y.Map");
    return undefined;
  }
  return value;
}

function readEntityRecords(
  root: Y.Map<unknown>,
  key: RootCollectionKey,
  maximum: number,
  context: MutableContext,
): Array<Record<string, unknown> & { id: string }> {
  const collection = readRootMap(root, key, context);
  if (!collection) return [];
  if (collection.size > maximum) issue(context, "bounds", key, `exceeds ${maximum} entities`);
  const entities: Array<Record<string, unknown> & { id: string; $order?: number }> = [];
  for (const [id, value] of collection.entries()) {
    const path = `${key}.${id || "<missing>"}`;
    if (!id.trim()) {
      issue(context, "missing-id", path, "entity map key must be a non-empty stable ID");
      continue;
    }
    if (id.length > COLLABORATIVE_JOURNEY_LIMITS.idLength) {
      issue(context, "bounds", path, "entity ID exceeds the length bound");
    }
    if (!(value instanceof Y.Map)) {
      issue(context, "invalid-shape", path, "entity must be a Y.Map");
      continue;
    }
    const raw = fromYValue(value);
    if (!isPlainRecord(raw)) {
      issue(context, "invalid-shape", path, "entity must materialize to an object");
      continue;
    }
    entities.push({ ...raw, id });
  }
  return entities
    .sort((left, right) => {
      const leftOrder = typeof left.$order === "number" ? left.$order : Number.MAX_SAFE_INTEGER;
      const rightOrder = typeof right.$order === "number" ? right.$order : Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder || left.id.localeCompare(right.id);
    })
    .map(({ $order: _order, ...entity }) => entity);
}

function checkKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  context: MutableContext,
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key))
      issue(context, "forbidden-field", `${path}.${key}`, "is not collaborative schema");
  }
}

function validString(
  value: unknown,
  path: string,
  context: MutableContext,
  options: { optional?: boolean; maximum?: number } = {},
): value is string | undefined {
  if (value === undefined && options.optional) return true;
  if (typeof value !== "string" || (!options.optional && !value.trim())) {
    issue(context, "invalid-shape", path, "must be a non-empty string");
    return false;
  }
  if (
    typeof value === "string" &&
    value.length > (options.maximum ?? COLLABORATIVE_JOURNEY_LIMITS.stringLength)
  ) {
    issue(context, "bounds", path, "exceeds the string length bound");
    return false;
  }
  return true;
}

function validNumber(value: unknown, path: string, context: MutableContext): value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issue(context, "invalid-shape", path, "must be a finite number");
    return false;
  }
  return true;
}

function validEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  context: MutableContext,
): value is T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    issue(context, "invalid-shape", path, `must be one of ${allowed.join(", ")}`);
    return false;
  }
  return true;
}

function validStringArray(
  value: unknown,
  path: string,
  context: MutableContext,
  maximum: number,
): value is string[] {
  if (!Array.isArray(value)) {
    issue(context, "invalid-shape", path, "must be a Y.Array of strings");
    return false;
  }
  if (value.length > maximum) issue(context, "bounds", path, `exceeds ${maximum} entries`);
  let valid = true;
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    if (!validString(entry, `${path}[${index}]`, context) || typeof entry !== "string")
      valid = false;
    else if (seen.has(entry)) {
      issue(context, "duplicate-id", `${path}[${index}]`, `duplicates ${entry}`);
      valid = false;
    } else seen.add(entry);
  });
  return valid;
}

function serverOwned(
  field: ServerOwnedJourneyField,
  context: MutableContext,
): ServerOwnedFieldDecision {
  const decision = context.validateServerOwnedField?.(Object.freeze({ ...field })) ?? "strip";
  context.serverOwnedFields.push({ ...field, decision });
  if (decision === "reject") {
    issue(context, "server-owned-field", field.path, "must be validated by the server authority");
  }
  return decision;
}

function validateObservation(
  value: unknown,
  path: string,
  context: MutableContext,
): value is Record<string, unknown> {
  if (!isPlainRecord(value)) {
    issue(context, "invalid-shape", path, "must be an object");
    return false;
  }
  checkKeys(
    value,
    [
      "id",
      "fingerprint",
      "capturedAt",
      "source",
      "externalId",
      "sessionId",
      "deviceId",
      "platform",
      "snapshotDigest",
      "representativeStepId",
    ],
    path,
    context,
  );
  let valid = validString(value.id, `${path}.id`, context);
  valid = validString(value.fingerprint, `${path}.fingerprint`, context) && valid;
  valid = validNumber(value.capturedAt, `${path}.capturedAt`, context) && valid;
  valid =
    validEnum(
      value.source,
      ["recording", "discovery", "run", "manual"],
      `${path}.source`,
      context,
    ) && valid;
  for (const key of [
    "externalId",
    "sessionId",
    "deviceId",
    "snapshotDigest",
    "representativeStepId",
  ] as const) {
    valid = validString(value[key], `${path}.${key}`, context, { optional: true }) && valid;
  }
  if (value.platform !== undefined) {
    valid =
      validEnum(value.platform, ["android", "ios", "browser"], `${path}.platform`, context) &&
      valid;
  }
  return valid;
}

function validateScreen(
  screen: Record<string, unknown> & { id: string },
  context: MutableContext,
): JourneyGraphScreen | undefined {
  const path = `screens.${screen.id}`;
  checkKeys(
    screen,
    ["id", "title", "identity", "observations", "representativeStepId", "createdAt", "updatedAt"],
    path,
    context,
  );
  let valid = validString(screen.title, `${path}.title`, context);
  valid = validNumber(screen.createdAt, `${path}.createdAt`, context) && valid;
  valid = validNumber(screen.updatedAt, `${path}.updatedAt`, context) && valid;

  if (screen.identity !== undefined) {
    if (!isPlainRecord(screen.identity)) {
      issue(context, "invalid-shape", `${path}.identity`, "must be an object");
      valid = false;
    } else {
      checkKeys(
        screen.identity,
        ["schemaVersion", "fingerprint", "aliases"],
        `${path}.identity`,
        context,
      );
      if (screen.identity.schemaVersion !== 1) {
        issue(context, "invalid-schema", `${path}.identity.schemaVersion`, "must be 1");
        valid = false;
      }
      valid =
        validString(screen.identity.fingerprint, `${path}.identity.fingerprint`, context) && valid;
      if (screen.identity.aliases !== undefined) {
        valid =
          validStringArray(screen.identity.aliases, `${path}.identity.aliases`, context, 256) &&
          valid;
      }
    }
  }

  if (screen.observations !== undefined) {
    if (!Array.isArray(screen.observations)) {
      issue(context, "invalid-shape", `${path}.observations`, "must be a Y.Array");
      valid = false;
    } else {
      if (screen.observations.length > COLLABORATIVE_JOURNEY_LIMITS.observationsPerScreen) {
        issue(context, "bounds", `${path}.observations`, "exceeds the observation count bound");
      }
      const ids = new Set<string>();
      screen.observations.forEach((observation, index) => {
        const observationPath = `${path}.observations[${index}]`;
        if (!validateObservation(observation, observationPath, context)) valid = false;
        if (isPlainRecord(observation) && typeof observation.id === "string") {
          if (ids.has(observation.id)) {
            issue(context, "duplicate-id", `${observationPath}.id`, `duplicates ${observation.id}`);
            valid = false;
          }
          ids.add(observation.id);
        }
      });
    }
  }

  const result = { ...screen };
  if (screen.representativeStepId !== undefined) {
    valid =
      validString(screen.representativeStepId, `${path}.representativeStepId`, context) && valid;
    if (
      serverOwned(
        {
          path: `${path}.representativeStepId`,
          entity: "screen",
          entityId: screen.id,
          field: "representativeStepId",
          value: screen.representativeStepId,
        },
        context,
      ) !== "preserve"
    ) {
      delete result.representativeStepId;
    }
  }
  return valid ? (result as JourneyGraphScreen) : undefined;
}

function validateVideoClip(value: unknown, path: string, context: MutableContext): boolean {
  if (!isPlainRecord(value)) {
    issue(context, "invalid-shape", path, "must be an object");
    return false;
  }
  checkKeys(value, ["startMs", "endMs"], path, context);
  const start = validNumber(value.startMs, `${path}.startMs`, context);
  const end = validNumber(value.endMs, `${path}.endMs`, context);
  if (start && end && (value.startMs as number) > (value.endMs as number)) {
    issue(context, "invalid-shape", path, "startMs must not exceed endMs");
    return false;
  }
  return start && end;
}

function validateConnection(
  connection: Record<string, unknown> & { id: string },
  context: MutableContext,
): JourneyGraphTransition | undefined {
  const path = `connections.${connection.id}`;
  checkKeys(
    connection,
    [
      "id",
      "fromScreenId",
      "destination",
      "stepIds",
      "evidenceIds",
      "takeId",
      "videoTakeId",
      "videoClip",
      "mode",
      "review",
      "provenance",
      "label",
      "state",
      "kind",
      "createdAt",
      "updatedAt",
    ],
    path,
    context,
  );
  let valid = validString(connection.fromScreenId, `${path}.fromScreenId`, context);
  valid = validNumber(connection.createdAt, `${path}.createdAt`, context) && valid;
  valid = validNumber(connection.updatedAt, `${path}.updatedAt`, context) && valid;
  valid = validEnum(connection.kind, ["forward", "return"], `${path}.kind`, context) && valid;
  valid =
    validEnum(connection.state, ["recorded", "needs-recording"], `${path}.state`, context) && valid;

  if (!isPlainRecord(connection.destination)) {
    issue(context, "invalid-shape", `${path}.destination`, "must be an object");
    valid = false;
  } else if (connection.destination.kind === "screen") {
    checkKeys(connection.destination, ["kind", "screenId"], `${path}.destination`, context);
    valid =
      validString(connection.destination.screenId, `${path}.destination.screenId`, context) &&
      valid;
  } else if (connection.destination.kind === "end") {
    checkKeys(connection.destination, ["kind"], `${path}.destination`, context);
  } else {
    issue(context, "invalid-shape", `${path}.destination.kind`, "must be screen or end");
    valid = false;
  }

  const result = { ...connection };
  if (
    !validStringArray(
      connection.stepIds,
      `${path}.stepIds`,
      context,
      COLLABORATIVE_JOURNEY_LIMITS.referencesPerConnection,
    )
  )
    valid = false;
  if (Array.isArray(connection.stepIds) && connection.stepIds.length > 0) {
    if (
      serverOwned(
        {
          path: `${path}.stepIds`,
          entity: "connection",
          entityId: connection.id,
          field: "stepIds",
          value: connection.stepIds,
        },
        context,
      ) !== "preserve"
    ) {
      result.stepIds = [];
    }
  }
  if (connection.evidenceIds !== undefined) {
    valid =
      validStringArray(
        connection.evidenceIds,
        `${path}.evidenceIds`,
        context,
        COLLABORATIVE_JOURNEY_LIMITS.referencesPerConnection,
      ) && valid;
    if (
      serverOwned(
        {
          path: `${path}.evidenceIds`,
          entity: "connection",
          entityId: connection.id,
          field: "evidenceIds",
          value: connection.evidenceIds,
        },
        context,
      ) !== "preserve"
    ) {
      delete result.evidenceIds;
    }
  }
  for (const key of ["takeId", "videoTakeId"] as const) {
    if (connection[key] === undefined) continue;
    valid = validString(connection[key], `${path}.${key}`, context) && valid;
    if (
      serverOwned(
        {
          path: `${path}.${key}`,
          entity: "connection",
          entityId: connection.id,
          field: key,
          value: connection[key],
        },
        context,
      ) !== "preserve"
    )
      delete result[key];
  }
  if (connection.videoClip !== undefined) {
    valid = validateVideoClip(connection.videoClip, `${path}.videoClip`, context) && valid;
    if (
      serverOwned(
        {
          path: `${path}.videoClip`,
          entity: "connection",
          entityId: connection.id,
          field: "videoClip",
          value: connection.videoClip,
        },
        context,
      ) !== "preserve"
    )
      delete result.videoClip;
  }
  if (connection.review !== undefined) {
    if (!isPlainRecord(connection.review)) {
      issue(context, "invalid-shape", `${path}.review`, "must be an object");
      valid = false;
    } else {
      checkKeys(
        connection.review,
        ["status", "updatedAt", "verifiedAt", "error"],
        `${path}.review`,
        context,
      );
      valid =
        validEnum(
          connection.review.status,
          ["draft", "verified", "failed"],
          `${path}.review.status`,
          context,
        ) && valid;
      valid =
        validNumber(connection.review.updatedAt, `${path}.review.updatedAt`, context) && valid;
      if (connection.review.verifiedAt !== undefined)
        valid =
          validNumber(connection.review.verifiedAt, `${path}.review.verifiedAt`, context) && valid;
      if (connection.review.error !== undefined)
        valid =
          validString(connection.review.error, `${path}.review.error`, context, {
            optional: true,
          }) && valid;
    }
    if (
      serverOwned(
        {
          path: `${path}.review`,
          entity: "connection",
          entityId: connection.id,
          field: "review",
          value: connection.review,
        },
        context,
      ) !== "preserve"
    )
      delete result.review;
  }
  if (connection.state === "recorded") {
    if (
      serverOwned(
        {
          path: `${path}.state`,
          entity: "connection",
          entityId: connection.id,
          field: "recordedState",
          value: connection.state,
        },
        context,
      ) !== "preserve"
    )
      result.state = "needs-recording";
  }
  if (connection.mode !== undefined)
    valid =
      validEnum(
        connection.mode,
        ["interaction", "automatic", "reusable"],
        `${path}.mode`,
        context,
      ) && valid;
  if (connection.label !== undefined)
    valid = validString(connection.label, `${path}.label`, context, { optional: true }) && valid;
  if (connection.provenance !== undefined) {
    if (!isPlainRecord(connection.provenance)) {
      issue(context, "invalid-shape", `${path}.provenance`, "must be an object");
      valid = false;
    } else {
      checkKeys(
        connection.provenance,
        ["source", "externalId", "sessionId"],
        `${path}.provenance`,
        context,
      );
      valid =
        validEnum(
          connection.provenance.source,
          ["recording", "discovery", "manual", "migration"],
          `${path}.provenance.source`,
          context,
        ) && valid;
      for (const key of ["externalId", "sessionId"] as const)
        valid =
          validString(connection.provenance[key], `${path}.provenance.${key}`, context, {
            optional: true,
          }) && valid;
    }
  }
  return valid ? (result as JourneyGraphTransition) : undefined;
}

function validateFlow(
  flow: Record<string, unknown> & { id: string },
  context: MutableContext,
): JourneyGraphFlow | undefined {
  const path = `flows.${flow.id}`;
  checkKeys(flow, ["id", "name", "screenId", "createdAt", "updatedAt"], path, context);
  let valid = validString(flow.name, `${path}.name`, context);
  valid = validString(flow.screenId, `${path}.screenId`, context) && valid;
  valid = validNumber(flow.createdAt, `${path}.createdAt`, context) && valid;
  valid = validNumber(flow.updatedAt, `${path}.updatedAt`, context) && valid;
  return valid ? (flow as JourneyGraphFlow) : undefined;
}

function validateNote(
  note: Record<string, unknown> & { id: string },
  context: MutableContext,
): JourneyCanvasNote | undefined {
  const path = `notes.${note.id}`;
  checkKeys(note, ["id", "text", "x", "y", "createdAt", "updatedAt"], path, context);
  let valid = validString(note.text, `${path}.text`, context, {
    maximum: COLLABORATIVE_JOURNEY_LIMITS.noteLength,
  });
  for (const key of ["x", "y", "createdAt", "updatedAt"] as const)
    valid = validNumber(note[key], `${path}.${key}`, context) && valid;
  return valid ? (note as JourneyCanvasNote) : undefined;
}

function readPositions(
  root: Y.Map<unknown>,
  context: MutableContext,
): Record<string, { x: number; y: number }> {
  const collection = readRootMap(root, COLLABORATIVE_JOURNEY_ROOT_KEYS.positions, context);
  const positions: Record<string, { x: number; y: number }> = {};
  if (!collection) return positions;
  if (collection.size > COLLABORATIVE_JOURNEY_LIMITS.positions)
    issue(context, "bounds", "positions", "exceeds the position count bound");
  for (const [id, value] of [...collection.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const path = `positions.${id || "<missing>"}`;
    if (!id.trim()) {
      issue(context, "missing-id", path, "position map key must be a non-empty stable ID");
      continue;
    }
    if (!(value instanceof Y.Map)) {
      issue(context, "invalid-shape", path, "position must be a Y.Map");
      continue;
    }
    const raw = fromYValue(value);
    if (!isPlainRecord(raw)) continue;
    checkKeys(raw, ["x", "y"], path, context);
    if (validNumber(raw.x, `${path}.x`, context) && validNumber(raw.y, `${path}.y`, context))
      positions[id] = { x: raw.x, y: raw.y };
  }
  return positions;
}

function readDraftMap(
  draft: Y.Map<unknown>,
  key: string,
  maximum: number,
  context: MutableContext,
): Record<string, string> {
  const value = draft.get(key);
  const result: Record<string, string> = {};
  if (!(value instanceof Y.Map)) {
    issue(context, "invalid-shape", `draft.${key}`, "must be a Y.Map");
    return result;
  }
  if (value.size > maximum) {
    issue(context, "bounds", `draft.${key}`, `exceeds ${maximum} entries`);
  }
  for (const [id, entry] of [...value.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (!id.trim())
      issue(context, "missing-id", `draft.${key}.<missing>`, "map key must be a stable ID");
    else if (
      validString(entry, `draft.${key}.${id}`, context, { optional: true }) &&
      typeof entry === "string"
    ) {
      result[id] = entry;
    }
  }
  return result;
}

function validateReferences(metadata: JourneyMetadata, context: MutableContext): void {
  const screens = new Set(metadata.graph?.screens.map((screen) => screen.id) ?? []);
  const connections = new Set(metadata.graph?.transitions.map((connection) => connection.id) ?? []);
  for (const connection of metadata.graph?.transitions ?? []) {
    if (!screens.has(connection.fromScreenId))
      issue(
        context,
        "dangling-reference",
        `connections.${connection.id}.fromScreenId`,
        `does not reference an existing screen: ${connection.fromScreenId}`,
      );
    if (connection.destination.kind === "screen" && !screens.has(connection.destination.screenId))
      issue(
        context,
        "dangling-reference",
        `connections.${connection.id}.destination.screenId`,
        `does not reference an existing screen: ${connection.destination.screenId}`,
      );
  }
  for (const flow of metadata.graph?.flows ?? []) {
    if (!screens.has(flow.screenId))
      issue(
        context,
        "dangling-reference",
        `flows.${flow.id}.screenId`,
        `does not reference an existing screen: ${flow.screenId}`,
      );
  }
  for (const id of Object.keys(metadata.positions)) {
    if (!screens.has(id))
      issue(
        context,
        "dangling-reference",
        `positions.${id}`,
        "does not reference an existing screen",
      );
  }
  for (const id of Object.keys(metadata.screenTitles ?? {})) {
    if (!screens.has(id))
      issue(
        context,
        "dangling-reference",
        `draft.screenTitles.${id}`,
        "does not reference an existing screen",
      );
  }
  for (const id of Object.keys(metadata.edgeLabels)) {
    if (!connections.has(id))
      issue(
        context,
        "dangling-reference",
        `draft.edgeLabels.${id}`,
        "does not reference an existing connection",
      );
  }
  for (const id of Object.keys(metadata.edgeKinds)) {
    if (!connections.has(id))
      issue(
        context,
        "dangling-reference",
        `draft.edgeKinds.${id}`,
        "does not reference an existing connection",
      );
  }
}

/**
 * Validates structure, bounds, references, and the server-authority boundary.
 * The returned metadata is deterministic and safe according to the supplied
 * field validator. It is omitted whenever any structural/rejection issue exists.
 */
export function validateCollaborativeJourney(
  doc: Y.Doc,
  options: CollaborativeJourneyMaterializationOptions = {},
): CollaborativeJourneyValidationResult {
  const context: MutableContext = {
    issues: [],
    serverOwnedFields: [],
    validateServerOwnedField: options.validateServerOwnedField,
  };
  const root = getCollaborativeJourneyRoot(doc);
  const bytes = Y.encodeStateAsUpdate(doc).byteLength;
  if (bytes > COLLABORATIVE_JOURNEY_LIMITS.documentBytes)
    issue(
      context,
      "bounds",
      "$document",
      `exceeds ${COLLABORATIVE_JOURNEY_LIMITS.documentBytes} bytes`,
    );
  for (const key of root.keys()) {
    if (!ROOT_KEY_SET.has(key))
      issue(context, "forbidden-field", key, "is not a collaborative Journey root key");
  }
  if (
    root.get(COLLABORATIVE_JOURNEY_ROOT_KEYS.schemaVersion) !== COLLABORATIVE_JOURNEY_SCHEMA_VERSION
  ) {
    issue(
      context,
      "invalid-schema",
      COLLABORATIVE_JOURNEY_ROOT_KEYS.schemaVersion,
      `must be ${COLLABORATIVE_JOURNEY_SCHEMA_VERSION}`,
    );
  }

  const screens = readEntityRecords(
    root,
    COLLABORATIVE_JOURNEY_ROOT_KEYS.screens,
    COLLABORATIVE_JOURNEY_LIMITS.screens,
    context,
  ).flatMap((screen) => {
    const value = validateScreen(screen, context);
    return value ? [value] : [];
  });
  const connections = readEntityRecords(
    root,
    COLLABORATIVE_JOURNEY_ROOT_KEYS.connections,
    COLLABORATIVE_JOURNEY_LIMITS.connections,
    context,
  ).flatMap((connection) => {
    const value = validateConnection(connection, context);
    return value ? [value] : [];
  });
  const flows = readEntityRecords(
    root,
    COLLABORATIVE_JOURNEY_ROOT_KEYS.flows,
    COLLABORATIVE_JOURNEY_LIMITS.flows,
    context,
  ).flatMap((flow) => {
    const value = validateFlow(flow, context);
    return value ? [value] : [];
  });
  const notes = readEntityRecords(
    root,
    COLLABORATIVE_JOURNEY_ROOT_KEYS.notes,
    COLLABORATIVE_JOURNEY_LIMITS.notes,
    context,
  ).flatMap((note) => {
    const value = validateNote(note, context);
    return value ? [value] : [];
  });
  const positions = readPositions(root, context);
  const draft = readRootMap(root, COLLABORATIVE_JOURNEY_ROOT_KEYS.draft, context);
  const screenTitles = draft
    ? readDraftMap(
        draft,
        COLLABORATIVE_JOURNEY_DRAFT_KEYS.screenTitles,
        COLLABORATIVE_JOURNEY_LIMITS.screens,
        context,
      )
    : {};
  const edgeLabels = draft
    ? readDraftMap(
        draft,
        COLLABORATIVE_JOURNEY_DRAFT_KEYS.edgeLabels,
        COLLABORATIVE_JOURNEY_LIMITS.connections,
        context,
      )
    : {};
  const edgeKinds = draft
    ? readDraftMap(
        draft,
        COLLABORATIVE_JOURNEY_DRAFT_KEYS.edgeKinds,
        COLLABORATIVE_JOURNEY_LIMITS.connections,
        context,
      )
    : {};
  if (draft)
    for (const key of draft.keys())
      if (!DRAFT_KEY_SET.has(key))
        issue(context, "forbidden-field", `draft.${key}`, "is not safe draft canvas metadata");

  const metadata: JourneyMetadata = {
    schemaVersion: 6,
    positions,
    ...(Object.keys(screenTitles).length ? { screenTitles } : {}),
    edgeLabels,
    edgeKinds,
    notes,
    graph: { schemaVersion: 1, screens, transitions: connections, flows },
  };
  validateReferences(metadata, context);
  return {
    ok: context.issues.length === 0,
    ...(context.issues.length === 0 ? { metadata } : {}),
    issues: context.issues,
    serverOwnedFields: context.serverOwnedFields,
  };
}

/** Deterministically exports a validated Y.Doc to canonical JourneyMetadata. */
export function materializeCollaborativeJourney(
  doc: Y.Doc,
  options: CollaborativeJourneyMaterializationOptions = {},
): JourneyMetadata {
  const result = validateCollaborativeJourney(doc, options);
  if (!result.ok || !result.metadata) throw new CollaborativeJourneyValidationError(result);
  return result.metadata;
}

export const materializeJourneyDocument = materializeCollaborativeJourney;

/**
 * Reconciles a canonical snapshot into an existing collaborative document.
 *
 * Existing root, collection, retained entity, and compatible nested Yjs types
 * keep their identities. The snapshot is first validated and projected through
 * the same authority boundary as materialization: server-owned executable,
 * review, and evidence fields are stripped by default. A server may explicitly
 * preserve fields only through `validateServerOwnedField`.
 *
 * Reconciliation is prepared and validated on a staged document before one
 * update is applied to the live document, so rejected or invalid input cannot
 * leave a partial live mutation. `origin` is attached to that live transaction.
 */
export function reconcileCollaborativeJourney(
  doc: Y.Doc,
  metadata: JourneyMetadata,
  options: CollaborativeJourneyReconciliationOptions = {},
): JourneyMetadata {
  const candidate = createCollaborativeJourneyDoc(metadata);
  let projection: JourneyMetadata;
  try {
    projection = materializeCollaborativeJourney(candidate, {
      validateServerOwnedField: options.validateServerOwnedField,
    });
  } finally {
    candidate.destroy();
  }

  const initialStateVector = encodeCollaborativeJourneyStateVector(doc);
  const staged = new Y.Doc({ gc: true });
  try {
    applyCollaborativeJourneyUpdate(
      staged,
      encodeCollaborativeJourneyUpdate(doc),
      "relay:reconcile-stage-bootstrap",
    );
    staged.transact(
      () => reconcileCanonicalProjection(staged, projection),
      "relay:reconcile-stage",
    );

    const stagedResult = validateCollaborativeJourney(staged, {
      // The candidate projection has already passed the caller's authority
      // validator. This second pass checks structure without invoking a
      // potentially stateful authority callback twice.
      validateServerOwnedField: () => "preserve",
    });
    if (!stagedResult.ok || !stagedResult.metadata) {
      throw new CollaborativeJourneyValidationError(stagedResult);
    }
    if (JSON.stringify(stagedResult.metadata) !== JSON.stringify(projection)) {
      throw new Error(
        "Collaborative Journey reconciliation did not match its validated projection",
      );
    }

    const update = encodeCollaborativeJourneyUpdate(staged, initialStateVector);
    applyCollaborativeJourneyUpdate(doc, update, options.origin);
    return projection;
  } finally {
    staged.destroy();
  }
}

export const reconcileJourneyDocument = reconcileCollaborativeJourney;

/** Encode an opaque binary update, optionally relative to a peer state vector. */
export function encodeCollaborativeJourneyUpdate(doc: Y.Doc, stateVector?: Uint8Array): Uint8Array {
  if (stateVector)
    assertOpaqueBytes(stateVector, COLLABORATIVE_JOURNEY_LIMITS.stateVectorBytes, "state vector");
  const update = Y.encodeStateAsUpdate(doc, stateVector ? cloneBytes(stateVector) : undefined);
  assertOpaqueBytes(update, COLLABORATIVE_JOURNEY_LIMITS.updateBytes, "update");
  return cloneBytes(update);
}

/** Encode an opaque binary state vector. */
export function encodeCollaborativeJourneyStateVector(doc: Y.Doc): Uint8Array {
  const vector = Y.encodeStateVector(doc);
  assertOpaqueBytes(vector, COLLABORATIVE_JOURNEY_LIMITS.stateVectorBytes, "state vector");
  return cloneBytes(vector);
}

/** Apply an opaque binary update without interpreting it as JSON or text. */
export function applyCollaborativeJourneyUpdate(
  doc: Y.Doc,
  update: Uint8Array,
  origin?: unknown,
): void {
  assertOpaqueBytes(update, COLLABORATIVE_JOURNEY_LIMITS.updateBytes, "update");
  Y.applyUpdate(doc, cloneBytes(update), origin);
}

/** Creates a local-only UndoManager; updates with any other origin are remote. */
export function createCollaborativeJourneyUndoManager(
  doc: Y.Doc,
  localOrigin: unknown,
  captureTimeout = 500,
): Y.UndoManager {
  return new Y.UndoManager(getCollaborativeJourneyRoot(doc), {
    trackedOrigins: new Set([localOrigin]),
    captureTimeout,
  });
}
