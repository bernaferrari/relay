import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, truncate, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  COLLABORATIVE_JOURNEY_LIMITS,
  CollaborativeJourneyValidationError,
  materializeCollaborativeJourney,
} from "@relay/collaboration";
import * as Y from "yjs";

const LOG_MAGIC = Buffer.from("RYU1");
const LOG_HEADER_BYTES = LOG_MAGIC.byteLength + 4 + 32;
const SNAPSHOT_FORMAT_VERSION = 1 as const;
const SAFE_SCOPE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SAFE_ACTOR_ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/;

export type CollaborativeJourneyScope = {
  organizationId: string;
  projectId: string;
  journeyId: string;
};

export type StoredCollaborativeJourneySnapshot = {
  formatVersion: typeof SNAPSHOT_FORMAT_VERSION;
  documentUpdate: Uint8Array;
  stateVector: Uint8Array;
  seenUpdateDigests: string[];
  createdAt: number;
};

export type StoredCollaborativeJourneyDocument = {
  snapshot?: StoredCollaborativeJourneySnapshot;
  updates: Uint8Array[];
  repairedTailBytes: number;
};

/**
 * Host-owned persistence seam. Implementations store opaque Yjs updates and do
 * not interpret Journey metadata, actors, awareness, execution, or evidence.
 */
export interface CollaborativeJourneyStorageProvider {
  load(
    scope: CollaborativeJourneyScope,
    maximumUpdateBytes: number,
  ): Promise<StoredCollaborativeJourneyDocument>;
  initialize(
    scope: CollaborativeJourneyScope,
    snapshot: StoredCollaborativeJourneySnapshot,
  ): Promise<void>;
  append(scope: CollaborativeJourneyScope, update: Uint8Array): Promise<void>;
  compact(
    scope: CollaborativeJourneyScope,
    snapshot: StoredCollaborativeJourneySnapshot,
  ): Promise<void>;
}

export type LocalCollaborativeJourneyStorageFault =
  | "before-snapshot-rename"
  | "after-snapshot-rename"
  | "before-log-rename";

export type LocalCollaborativeJourneyStorageOptions = {
  rootDirectory: string;
  fault?: (point: LocalCollaborativeJourneyStorageFault) => void;
};

type SnapshotFile = {
  formatVersion: number;
  documentUpdate: string;
  documentDigest: string;
  stateVector: string;
  stateVectorDigest: string;
  seenUpdateDigests: string[];
  createdAt: number;
};

function cloneBytes(value: Uint8Array): Uint8Array {
  return new Uint8Array(value);
}

function digest(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function scopeKey(scope: CollaborativeJourneyScope): string {
  return `${scope.organizationId}\u0000${scope.projectId}\u0000${scope.journeyId}`;
}

export function assertCollaborativeJourneyScope(scope: CollaborativeJourneyScope): void {
  for (const [name, value] of Object.entries(scope)) {
    if (!SAFE_SCOPE_ID.test(value)) {
      throw new CollaborativeJourneyStoreError(
        "invalid-scope",
        `${name} must be a bounded opaque identifier`,
      );
    }
  }
}

function assertActorId(actorId: string): void {
  if (!SAFE_ACTOR_ID.test(actorId)) {
    throw new CollaborativeJourneyStoreError(
      "invalid-actor",
      "actorId must be a bounded canonical actor identifier",
    );
  }
}

function scopeDirectory(rootDirectory: string, scope: CollaborativeJourneyScope): string {
  assertCollaborativeJourneyScope(scope);
  return join(
    rootDirectory,
    "organizations",
    scope.organizationId,
    "projects",
    scope.projectId,
    "journeys",
    scope.journeyId,
    "collaboration",
  );
}

function snapshotPath(rootDirectory: string, scope: CollaborativeJourneyScope): string {
  return join(scopeDirectory(rootDirectory, scope), "snapshot.json");
}

function logPath(rootDirectory: string, scope: CollaborativeJourneyScope): string {
  return join(scopeDirectory(rootDirectory, scope), "updates.log");
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

async function readOptional(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

async function atomicWrite(
  destination: string,
  contents: Uint8Array,
  beforeRename?: () => void,
): Promise<void> {
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const staged = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(staged, "wx", 0o600);
    await handle.writeFile(contents);
    await handle.sync();
    await handle.close();
    handle = undefined;
    beforeRename?.();
    await rename(staged, destination);
  } finally {
    await handle?.close().catch(() => undefined);
    await unlink(staged).catch((error: unknown) => {
      if (!isNotFound(error)) throw error;
    });
  }
}

function serializeSnapshot(snapshot: StoredCollaborativeJourneySnapshot): Uint8Array {
  const value: SnapshotFile = {
    formatVersion: snapshot.formatVersion,
    documentUpdate: Buffer.from(snapshot.documentUpdate).toString("base64"),
    documentDigest: digest(snapshot.documentUpdate),
    stateVector: Buffer.from(snapshot.stateVector).toString("base64"),
    stateVectorDigest: digest(snapshot.stateVector),
    seenUpdateDigests: [...snapshot.seenUpdateDigests],
    createdAt: snapshot.createdAt,
  };
  return Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
}

function parseSnapshot(contents: Buffer): StoredCollaborativeJourneySnapshot {
  let value: SnapshotFile;
  try {
    value = JSON.parse(contents.toString("utf8")) as SnapshotFile;
  } catch {
    throw new CollaborativeJourneyStoreError("corrupt-snapshot", "snapshot is not valid JSON");
  }
  if (
    value.formatVersion !== SNAPSHOT_FORMAT_VERSION ||
    typeof value.documentUpdate !== "string" ||
    typeof value.documentDigest !== "string" ||
    typeof value.stateVector !== "string" ||
    typeof value.stateVectorDigest !== "string" ||
    !Array.isArray(value.seenUpdateDigests) ||
    !value.seenUpdateDigests.every((entry) => /^[a-f0-9]{64}$/.test(entry)) ||
    typeof value.createdAt !== "number" ||
    !Number.isFinite(value.createdAt)
  ) {
    throw new CollaborativeJourneyStoreError("corrupt-snapshot", "snapshot shape is invalid");
  }
  const documentUpdate = Buffer.from(value.documentUpdate, "base64");
  const stateVector = Buffer.from(value.stateVector, "base64");
  if (
    digest(documentUpdate) !== value.documentDigest ||
    digest(stateVector) !== value.stateVectorDigest
  ) {
    throw new CollaborativeJourneyStoreError("corrupt-snapshot", "snapshot checksum failed");
  }
  return {
    formatVersion: SNAPSHOT_FORMAT_VERSION,
    documentUpdate: cloneBytes(documentUpdate),
    stateVector: cloneBytes(stateVector),
    seenUpdateDigests: [...value.seenUpdateDigests],
    createdAt: value.createdAt,
  };
}

function frameUpdate(update: Uint8Array): Uint8Array {
  const header = Buffer.alloc(LOG_HEADER_BYTES);
  LOG_MAGIC.copy(header, 0);
  header.writeUInt32BE(update.byteLength, LOG_MAGIC.byteLength);
  Buffer.from(digest(update), "hex").copy(header, LOG_MAGIC.byteLength + 4);
  return Buffer.concat([header, Buffer.from(update)]);
}

function parseUpdateLog(
  contents: Buffer,
  maximumUpdateBytes: number,
): { updates: Uint8Array[]; validBytes: number } {
  const updates: Uint8Array[] = [];
  let offset = 0;
  while (offset < contents.byteLength) {
    if (contents.byteLength - offset < LOG_HEADER_BYTES) break;
    if (!contents.subarray(offset, offset + LOG_MAGIC.byteLength).equals(LOG_MAGIC)) break;
    const length = contents.readUInt32BE(offset + LOG_MAGIC.byteLength);
    if (length === 0 || length > maximumUpdateBytes) break;
    const end = offset + LOG_HEADER_BYTES + length;
    if (end > contents.byteLength) break;
    const expected = contents.subarray(
      offset + LOG_MAGIC.byteLength + 4,
      offset + LOG_HEADER_BYTES,
    );
    const update = contents.subarray(offset + LOG_HEADER_BYTES, end);
    const actual = Buffer.from(digest(update), "hex");
    if (!actual.equals(expected)) break;
    updates.push(cloneBytes(update));
    offset = end;
  }
  return { updates, validBytes: offset };
}

export class LocalCollaborativeJourneyStorageProvider implements CollaborativeJourneyStorageProvider {
  readonly #rootDirectory: string;
  readonly #fault?: (point: LocalCollaborativeJourneyStorageFault) => void;

  constructor(options: LocalCollaborativeJourneyStorageOptions) {
    if (!options.rootDirectory) throw new TypeError("rootDirectory is required");
    this.#rootDirectory = options.rootDirectory;
    this.#fault = options.fault;
  }

  async load(
    scope: CollaborativeJourneyScope,
    maximumUpdateBytes: number,
  ): Promise<StoredCollaborativeJourneyDocument> {
    const snapshotContents = await readOptional(snapshotPath(this.#rootDirectory, scope));
    const log = await readOptional(logPath(this.#rootDirectory, scope));
    const parsed = parseUpdateLog(log ?? Buffer.alloc(0), maximumUpdateBytes);
    const repairedTailBytes = (log?.byteLength ?? 0) - parsed.validBytes;
    if (repairedTailBytes > 0) {
      await truncate(logPath(this.#rootDirectory, scope), parsed.validBytes);
    }
    return {
      snapshot: snapshotContents ? parseSnapshot(snapshotContents) : undefined,
      updates: parsed.updates,
      repairedTailBytes,
    };
  }

  async initialize(
    scope: CollaborativeJourneyScope,
    snapshot: StoredCollaborativeJourneySnapshot,
  ): Promise<void> {
    await atomicWrite(snapshotPath(this.#rootDirectory, scope), serializeSnapshot(snapshot), () =>
      this.#fault?.("before-snapshot-rename"),
    );
    await atomicWrite(logPath(this.#rootDirectory, scope), new Uint8Array());
  }

  async append(scope: CollaborativeJourneyScope, update: Uint8Array): Promise<void> {
    const destination = logPath(this.#rootDirectory, scope);
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    const handle = await open(destination, "a", 0o600);
    try {
      await handle.writeFile(frameUpdate(update));
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async compact(
    scope: CollaborativeJourneyScope,
    snapshot: StoredCollaborativeJourneySnapshot,
  ): Promise<void> {
    await atomicWrite(snapshotPath(this.#rootDirectory, scope), serializeSnapshot(snapshot), () =>
      this.#fault?.("before-snapshot-rename"),
    );
    this.#fault?.("after-snapshot-rename");
    await atomicWrite(logPath(this.#rootDirectory, scope), new Uint8Array(), () =>
      this.#fault?.("before-log-rename"),
    );
  }
}

export type CollaborativeJourneyStoreLimits = {
  maximumUpdateBytes: number;
  maximumDocumentBytes: number;
  maximumUncompactedBytes: number;
  compactAfterUpdates: number;
  maximumRememberedUpdates: number;
  maximumUpdatesPerActor: number;
  rateWindowMs: number;
};

const DEFAULT_LIMITS: CollaborativeJourneyStoreLimits = {
  maximumUpdateBytes: COLLABORATIVE_JOURNEY_LIMITS.updateBytes,
  maximumDocumentBytes: COLLABORATIVE_JOURNEY_LIMITS.documentBytes,
  maximumUncompactedBytes: COLLABORATIVE_JOURNEY_LIMITS.documentBytes * 2,
  compactAfterUpdates: 128,
  maximumRememberedUpdates: 4_096,
  maximumUpdatesPerActor: 120,
  rateWindowMs: 60_000,
};

export type DurableCollaborativeJourneyStoreOptions = {
  storage: CollaborativeJourneyStorageProvider;
  limits?: Partial<CollaborativeJourneyStoreLimits>;
  clock?: () => number;
};

export type CollaborativeJourneyDocumentState = {
  documentUpdate: Uint8Array;
  stateVector: Uint8Array;
  uncompactedUpdates: number;
  repairedTailBytes: number;
};

export type ApplyCollaborativeJourneyUpdateResult = CollaborativeJourneyDocumentState & {
  applied: boolean;
  duplicate: boolean;
};

type LoadedJourney = {
  baseline: Uint8Array;
  updates: Uint8Array[];
  seenUpdateDigests: string[];
  seenUpdateDigestSet: Set<string>;
  repairedTailBytes: number;
};

export type CollaborativeJourneyStoreErrorCode =
  | "corrupt-document"
  | "corrupt-snapshot"
  | "document-too-large"
  | "forged-authority"
  | "invalid-actor"
  | "invalid-scope"
  | "missing-document"
  | "rate-limited"
  | "update-too-large";

export class CollaborativeJourneyStoreError extends Error {
  readonly code: CollaborativeJourneyStoreErrorCode;

  constructor(code: CollaborativeJourneyStoreErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CollaborativeJourneyStoreError";
    this.code = code;
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
}

function mergedUpdate(loaded: LoadedJourney, additional?: Uint8Array): Uint8Array {
  const values = additional
    ? [loaded.baseline, ...loaded.updates, additional]
    : [loaded.baseline, ...loaded.updates];
  try {
    return Y.mergeUpdates(values);
  } catch (error) {
    throw new CollaborativeJourneyStoreError("corrupt-document", "Yjs update merge failed", {
      cause: error,
    });
  }
}

type InternalYDoc = Y.Doc & {
  store: {
    pendingStructs?: unknown;
    pendingDs?: unknown;
  };
};

function hasCausallyPendingData(doc: Y.Doc): boolean {
  const store = (doc as InternalYDoc).store;
  return Boolean(store.pendingStructs || store.pendingDs);
}

function materializeUpdate(
  update: Uint8Array,
  maximumDocumentBytes: number,
  allowCausallyPending = false,
): Y.Doc {
  if (update.byteLength > maximumDocumentBytes) {
    throw new CollaborativeJourneyStoreError(
      "document-too-large",
      `collaborative document exceeds ${maximumDocumentBytes} bytes`,
    );
  }
  const doc = new Y.Doc({ gc: true });
  try {
    Y.applyUpdate(doc, update, "relay:server-validation");
    materializeCollaborativeJourney(doc, {
      validateServerOwnedField: () => "reject",
    });
    return doc;
  } catch (error) {
    if (error instanceof CollaborativeJourneyValidationError) {
      const forged = error.result.issues.some((issue) => issue.code === "server-owned-field");
      if (!forged && allowCausallyPending && hasCausallyPendingData(doc)) return doc;
      doc.destroy();
      throw new CollaborativeJourneyStoreError(
        forged ? "forged-authority" : "corrupt-document",
        forged
          ? "collaborative update attempted to set server-owned Journey fields"
          : "collaborative Journey failed schema validation",
        { cause: error },
      );
    }
    doc.destroy();
    throw new CollaborativeJourneyStoreError("corrupt-document", "Yjs update is invalid", {
      cause: error,
    });
  }
}

function rememberDigest(loaded: LoadedJourney, value: string, maximum: number): void {
  if (loaded.seenUpdateDigestSet.has(value)) return;
  loaded.seenUpdateDigests.push(value);
  loaded.seenUpdateDigestSet.add(value);
  while (loaded.seenUpdateDigests.length > maximum) {
    const removed = loaded.seenUpdateDigests.shift();
    if (removed) loaded.seenUpdateDigestSet.delete(removed);
  }
}

export class DurableCollaborativeJourneyStore {
  readonly #storage: CollaborativeJourneyStorageProvider;
  readonly #limits: CollaborativeJourneyStoreLimits;
  readonly #clock: () => number;
  readonly #documents = new Map<string, LoadedJourney>();
  readonly #locks = new Map<string, Promise<void>>();
  readonly #actorUpdates = new Map<string, number[]>();

  constructor(options: DurableCollaborativeJourneyStoreOptions) {
    this.#storage = options.storage;
    this.#limits = { ...DEFAULT_LIMITS, ...options.limits };
    this.#clock = options.clock ?? Date.now;
    for (const [name, value] of Object.entries(this.#limits)) assertPositiveInteger(value, name);
  }

  async open(
    scope: CollaborativeJourneyScope,
    bootstrapDocumentUpdate?: Uint8Array,
  ): Promise<CollaborativeJourneyDocumentState> {
    return this.#withScopeLock(scope, async () => {
      const loaded = await this.#load(scope, bootstrapDocumentUpdate);
      return this.#state(loaded);
    });
  }

  async applyUpdate(input: {
    scope: CollaborativeJourneyScope;
    actorId: string;
    update: Uint8Array;
  }): Promise<ApplyCollaborativeJourneyUpdateResult> {
    return this.#withScopeLock(input.scope, async () => {
      assertActorId(input.actorId);
      if (!(input.update instanceof Uint8Array) || input.update.byteLength === 0) {
        throw new CollaborativeJourneyStoreError(
          "corrupt-document",
          "update must contain Yjs bytes",
        );
      }
      if (input.update.byteLength > this.#limits.maximumUpdateBytes) {
        throw new CollaborativeJourneyStoreError(
          "update-too-large",
          `update exceeds ${this.#limits.maximumUpdateBytes} bytes`,
        );
      }
      const loaded = await this.#load(input.scope);
      const updateDigest = digest(input.update);
      if (loaded.seenUpdateDigestSet.has(updateDigest)) {
        return { ...(await this.#state(loaded)), applied: false, duplicate: true };
      }
      this.#consumeRate(input.scope, input.actorId);
      const uncompactedBytes =
        loaded.updates.reduce((total, update) => total + update.byteLength, 0) +
        input.update.byteLength;
      if (uncompactedBytes > this.#limits.maximumUncompactedBytes) {
        throw new CollaborativeJourneyStoreError(
          "document-too-large",
          "uncompacted collaborative update log exceeds its byte bound",
        );
      }
      const candidateUpdate = mergedUpdate(loaded, input.update);
      const candidate = materializeUpdate(candidateUpdate, this.#limits.maximumDocumentBytes, true);
      const causallyPending = hasCausallyPendingData(candidate);
      candidate.destroy();

      await this.#storage.append(input.scope, input.update);
      loaded.updates.push(cloneBytes(input.update));
      rememberDigest(loaded, updateDigest, this.#limits.maximumRememberedUpdates);

      if (loaded.updates.length >= this.#limits.compactAfterUpdates && !causallyPending) {
        await this.#compact(input.scope, loaded);
      }
      return { ...(await this.#state(loaded)), applied: true, duplicate: false };
    });
  }

  async compact(scope: CollaborativeJourneyScope): Promise<CollaborativeJourneyDocumentState> {
    return this.#withScopeLock(scope, async () => {
      const loaded = await this.#load(scope);
      await this.#compact(scope, loaded);
      return this.#state(loaded);
    });
  }

  async #load(
    scope: CollaborativeJourneyScope,
    bootstrapDocumentUpdate?: Uint8Array,
  ): Promise<LoadedJourney> {
    assertCollaborativeJourneyScope(scope);
    const key = scopeKey(scope);
    const cached = this.#documents.get(key);
    if (cached) return cached;

    const stored = await this.#storage.load(scope, this.#limits.maximumUpdateBytes);
    if (!stored.snapshot) {
      if (!bootstrapDocumentUpdate) {
        throw new CollaborativeJourneyStoreError(
          "missing-document",
          "collaborative Journey has not been initialized",
        );
      }
      if (
        bootstrapDocumentUpdate.byteLength === 0 ||
        bootstrapDocumentUpdate.byteLength > this.#limits.maximumDocumentBytes
      ) {
        throw new CollaborativeJourneyStoreError(
          "document-too-large",
          "bootstrap collaborative document exceeds its byte bound",
        );
      }
      const bootstrap = cloneBytes(bootstrapDocumentUpdate);
      const doc = materializeUpdate(bootstrap, this.#limits.maximumDocumentBytes);
      const snapshot = this.#snapshot(bootstrap, doc, []);
      doc.destroy();
      await this.#storage.initialize(scope, snapshot);
      const initialized: LoadedJourney = {
        baseline: bootstrap,
        updates: [],
        seenUpdateDigests: [],
        seenUpdateDigestSet: new Set(),
        repairedTailBytes: stored.repairedTailBytes,
      };
      this.#documents.set(key, initialized);
      return initialized;
    }

    if (stored.snapshot.documentUpdate.byteLength > this.#limits.maximumDocumentBytes) {
      throw new CollaborativeJourneyStoreError(
        "document-too-large",
        "stored collaborative snapshot exceeds its byte bound",
      );
    }
    const loaded: LoadedJourney = {
      baseline: cloneBytes(stored.snapshot.documentUpdate),
      updates: stored.updates.map(cloneBytes),
      seenUpdateDigests: stored.snapshot.seenUpdateDigests.slice(
        -this.#limits.maximumRememberedUpdates,
      ),
      seenUpdateDigestSet: new Set(),
      repairedTailBytes: stored.repairedTailBytes,
    };
    for (const entry of loaded.seenUpdateDigests) loaded.seenUpdateDigestSet.add(entry);
    for (const update of loaded.updates) {
      rememberDigest(loaded, digest(update), this.#limits.maximumRememberedUpdates);
    }
    const restored = mergedUpdate(loaded);
    const doc = materializeUpdate(restored, this.#limits.maximumDocumentBytes, true);
    const actualStateVector = Y.encodeStateVector(doc);
    if (!Buffer.from(actualStateVector).equals(Buffer.from(stored.snapshot.stateVector))) {
      // A non-empty log legitimately advances beyond the snapshot vector. An
      // empty log must match exactly or the snapshot envelope is inconsistent.
      if (loaded.updates.length === 0 && !hasCausallyPendingData(doc)) {
        doc.destroy();
        throw new CollaborativeJourneyStoreError(
          "corrupt-snapshot",
          "snapshot state vector does not match its document",
        );
      }
    }
    doc.destroy();
    this.#documents.set(key, loaded);
    return loaded;
  }

  async #compact(scope: CollaborativeJourneyScope, loaded: LoadedJourney): Promise<void> {
    if (loaded.updates.length === 0) return;
    const update = mergedUpdate(loaded);
    const doc = materializeUpdate(update, this.#limits.maximumDocumentBytes);
    const snapshot = this.#snapshot(update, doc, loaded.seenUpdateDigests);
    doc.destroy();
    await this.#storage.compact(scope, snapshot);
    loaded.baseline = update;
    loaded.updates = [];
    loaded.repairedTailBytes = 0;
  }

  #snapshot(
    update: Uint8Array,
    doc: Y.Doc,
    seenUpdateDigests: string[],
  ): StoredCollaborativeJourneySnapshot {
    const stateVector = Y.encodeStateVector(doc);
    if (stateVector.byteLength > COLLABORATIVE_JOURNEY_LIMITS.stateVectorBytes) {
      throw new CollaborativeJourneyStoreError(
        "document-too-large",
        "collaborative state vector exceeds its byte bound",
      );
    }
    return {
      formatVersion: SNAPSHOT_FORMAT_VERSION,
      documentUpdate: cloneBytes(update),
      stateVector: cloneBytes(stateVector),
      seenUpdateDigests: seenUpdateDigests.slice(-this.#limits.maximumRememberedUpdates),
      createdAt: this.#clock(),
    };
  }

  async #state(loaded: LoadedJourney): Promise<CollaborativeJourneyDocumentState> {
    const update = mergedUpdate(loaded);
    const doc = materializeUpdate(update, this.#limits.maximumDocumentBytes, true);
    const stateVector = Y.encodeStateVector(doc);
    doc.destroy();
    return {
      documentUpdate: update,
      stateVector,
      uncompactedUpdates: loaded.updates.length,
      repairedTailBytes: loaded.repairedTailBytes,
    };
  }

  #consumeRate(scope: CollaborativeJourneyScope, actorId: string): void {
    const now = this.#clock();
    const key = `${scopeKey(scope)}\u0000${actorId}`;
    const cutoff = now - this.#limits.rateWindowMs;
    const retained = (this.#actorUpdates.get(key) ?? []).filter((entry) => entry > cutoff);
    if (retained.length >= this.#limits.maximumUpdatesPerActor) {
      this.#actorUpdates.set(key, retained);
      throw new CollaborativeJourneyStoreError(
        "rate-limited",
        "actor exceeded the collaborative update rate",
      );
    }
    retained.push(now);
    this.#actorUpdates.set(key, retained);
  }

  async #withScopeLock<T>(scope: CollaborativeJourneyScope, run: () => Promise<T>): Promise<T> {
    assertCollaborativeJourneyScope(scope);
    const key = scopeKey(scope);
    const previous = this.#locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    this.#locks.set(key, queued);
    await previous;
    try {
      return await run();
    } finally {
      release();
      if (this.#locks.get(key) === queued) this.#locks.delete(key);
    }
  }
}
