import {
  COLLABORATIVE_JOURNEY_LIMITS,
  applyCollaborativeJourneyUpdate,
  createCollaborativeJourneyUndoManager,
  encodeCollaborativeJourneyStateVector,
  encodeCollaborativeJourneyUpdate,
  validateCollaborativeJourney,
} from "@relay/collaboration";
import * as Y from "yjs";

export type CollaborationScope = Readonly<{
  projectId: string;
  journeyId: string;
}>;

export type CollaborationUpdate = Readonly<{
  id: string;
  bytes: Uint8Array;
}>;

export type CollaborationHandshakeRequest = Readonly<{
  scope: CollaborationScope;
  stateVector: Uint8Array;
  signal: AbortSignal;
}>;

export type CollaborationHandshakeResponse = Readonly<{
  /** The authoritative peer vector before `updates` are applied locally. */
  stateVector: Uint8Array;
  updates: readonly CollaborationUpdate[];
}>;

export type CollaborationPushRequest = Readonly<{
  scope: CollaborationScope;
  updates: readonly CollaborationUpdate[];
  signal: AbortSignal;
}>;

export type CollaborationPushResponse = Readonly<{
  acknowledgedUpdateIds: readonly string[];
  updates?: readonly CollaborationUpdate[];
}>;

export type CollaborationSubscription = Readonly<{
  close(): void;
}>;

/**
 * Host-neutral seam for a future RelayClient operations adapter. The provider
 * never assumes HTTP, WebSocket, Electron, or Solid primitives.
 *
 * Contract: this channel synchronizes safe Journey draft structure only. Runs,
 * evidence, leases, Authoring Sessions, and executable/review metadata remain
 * server-owned operation state; both this provider and the eventual server
 * adapter must reject attempts to smuggle those fields through Yjs updates.
 */
export interface CollaborationTransport {
  handshake(request: CollaborationHandshakeRequest): Promise<CollaborationHandshakeResponse>;
  push(request: CollaborationPushRequest): Promise<CollaborationPushResponse>;
  subscribe(
    scope: CollaborationScope,
    listener: (update: CollaborationUpdate) => void,
    onDisconnect: (error?: unknown) => void,
  ): CollaborationSubscription;
}

export type CollaborationProviderStatus =
  | "disabled"
  | "idle"
  | "connecting"
  | "online"
  | "offline"
  | "stopped"
  | "destroyed";

export type CollaborationProviderSnapshot = Readonly<{
  status: CollaborationProviderStatus;
  pendingUpdates: number;
  pendingBytes: number;
  reconnectAttempt: number;
  lastError?: Error;
}>;

export type CollaborationProviderLimits = Readonly<{
  maxQueuedUpdates: number;
  maxQueuedBytes: number;
  maxUpdateBytes: number;
  maxStateVectorBytes: number;
  maxDocumentBytes: number;
  maxPushBatch: number;
}>;

export type CollaborationProviderOptions = Readonly<{
  enabled: boolean;
  doc: Y.Doc;
  transport: CollaborationTransport;
  scope: CollaborationScope;
  /** Stable per browser tab/agent process. It is part of retry-safe update IDs. */
  clientId: string;
  limits?: Partial<CollaborationProviderLimits>;
  retryBaseMs?: number;
  retryMaximumMs?: number;
}>;

export const DEFAULT_COLLABORATION_PROVIDER_LIMITS: CollaborationProviderLimits = Object.freeze({
  maxQueuedUpdates: 256,
  maxQueuedBytes: COLLABORATIVE_JOURNEY_LIMITS.documentBytes,
  maxUpdateBytes: COLLABORATIVE_JOURNEY_LIMITS.updateBytes,
  maxStateVectorBytes: COLLABORATIVE_JOURNEY_LIMITS.stateVectorBytes,
  maxDocumentBytes: COLLABORATIVE_JOURNEY_LIMITS.documentBytes,
  maxPushBatch: 32,
});

const EMPTY_UPDATE_MAXIMUM_BYTES = 2;

function cloneBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

function boundedPositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be positive`);
  return value;
}

function assertIdentifier(value: string, name: string): void {
  if (!value.trim()) throw new TypeError(`${name} is required`);
  if (value.length > COLLABORATIVE_JOURNEY_LIMITS.idLength) {
    throw new RangeError(`${name} exceeds ${COLLABORATIVE_JOURNEY_LIMITS.idLength} characters`);
  }
}

function toError(error: unknown, fallback: string): Error {
  if (error instanceof Error) return error;
  return new Error(typeof error === "string" && error ? error : fallback);
}

/** Stable, dependency-free hash used only for idempotency keys, not security. */
function updateFingerprint(bytes: Uint8Array): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `${bytes.byteLength.toString(36)}-${hash.toString(36)}`;
}

function assertBytes(bytes: Uint8Array, maximum: number, name: string): void {
  if (!(bytes instanceof Uint8Array)) throw new TypeError(`${name} must be a Uint8Array`);
  if (bytes.byteLength > maximum) throw new RangeError(`${name} exceeds ${maximum} bytes`);
}

function mergeLimits(
  limits: Partial<CollaborationProviderLimits> | undefined,
): CollaborationProviderLimits {
  const merged = { ...DEFAULT_COLLABORATION_PROVIDER_LIMITS, ...limits };
  for (const [name, value] of Object.entries(merged)) boundedPositiveInteger(value, name);
  if (merged.maxUpdateBytes > COLLABORATIVE_JOURNEY_LIMITS.updateBytes) {
    throw new RangeError("maxUpdateBytes cannot exceed the collaboration update bound");
  }
  if (merged.maxStateVectorBytes > COLLABORATIVE_JOURNEY_LIMITS.stateVectorBytes) {
    throw new RangeError("maxStateVectorBytes cannot exceed the collaboration state-vector bound");
  }
  if (merged.maxDocumentBytes > COLLABORATIVE_JOURNEY_LIMITS.documentBytes) {
    throw new RangeError("maxDocumentBytes cannot exceed the collaborative document bound");
  }
  return Object.freeze(merged);
}

export class CollaborationProvider {
  readonly localOrigin = Object.freeze({ type: "relay-collaboration-local" });
  readonly remoteOrigin = Object.freeze({ type: "relay-collaboration-remote" });

  readonly #enabled: boolean;
  readonly #doc: Y.Doc;
  readonly #transport: CollaborationTransport;
  readonly #scope: CollaborationScope;
  readonly #clientId: string;
  readonly #limits: CollaborationProviderLimits;
  readonly #retryBaseMs: number;
  readonly #retryMaximumMs: number;
  readonly #listeners = new Set<(snapshot: CollaborationProviderSnapshot) => void>();
  readonly #queue = new Map<string, CollaborationUpdate>();

  #status: CollaborationProviderStatus;
  #lastError: Error | undefined;
  #reconnectAttempt = 0;
  #pendingBytes = 0;
  #sequence = 0;
  #generation = 0;
  #started = false;
  #destroyed = false;
  #flushing = false;
  #abortController: AbortController | undefined;
  #subscription: CollaborationSubscription | undefined;
  #retryTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: CollaborationProviderOptions) {
    assertIdentifier(options.scope.projectId, "projectId");
    assertIdentifier(options.scope.journeyId, "journeyId");
    assertIdentifier(options.clientId, "clientId");
    if (options.clientId.length > 128) throw new RangeError("clientId exceeds 128 characters");
    this.#enabled = options.enabled;
    this.#doc = options.doc;
    this.#transport = options.transport;
    this.#scope = Object.freeze({ ...options.scope });
    this.#clientId = options.clientId;
    this.#limits = mergeLimits(options.limits);
    this.#retryBaseMs = boundedPositiveInteger(options.retryBaseMs ?? 250, "retryBaseMs");
    this.#retryMaximumMs = boundedPositiveInteger(
      options.retryMaximumMs ?? 8_000,
      "retryMaximumMs",
    );
    if (this.#retryBaseMs > this.#retryMaximumMs) {
      throw new RangeError("retryBaseMs cannot exceed retryMaximumMs");
    }
    this.#status = options.enabled ? "idle" : "disabled";
  }

  get snapshot(): CollaborationProviderSnapshot {
    return Object.freeze({
      status: this.#status,
      pendingUpdates: this.#queue.size,
      pendingBytes: this.#pendingBytes,
      reconnectAttempt: this.#reconnectAttempt,
      ...(this.#lastError ? { lastError: this.#lastError } : {}),
    });
  }

  subscribe(listener: (snapshot: CollaborationProviderSnapshot) => void): () => void {
    if (this.#destroyed) throw new Error("CollaborationProvider is destroyed");
    this.#listeners.add(listener);
    listener(this.snapshot);
    return () => this.#listeners.delete(listener);
  }

  createUndoManager(captureTimeout = 500): Y.UndoManager {
    return createCollaborativeJourneyUndoManager(this.#doc, this.localOrigin, captureTimeout);
  }

  async start(): Promise<void> {
    if (this.#destroyed) throw new Error("CollaborationProvider is destroyed");
    if (!this.#enabled || this.#started) return;
    this.#started = true;
    this.#generation += 1;
    this.#doc.on("update", this.#onDocumentUpdate);
    await this.#join(this.#generation);
  }

  stop(): void {
    if (this.#destroyed || !this.#started) return;
    this.#started = false;
    this.#generation += 1;
    this.#doc.off("update", this.#onDocumentUpdate);
    this.#clearConnection();
    this.#setState("stopped");
  }

  destroy(): void {
    if (this.#destroyed) return;
    if (this.#started) this.stop();
    this.#destroyed = true;
    this.#queue.clear();
    this.#pendingBytes = 0;
    this.#listeners.clear();
    this.#status = "destroyed";
  }

  readonly #onDocumentUpdate = (update: Uint8Array, origin: unknown): void => {
    if (!this.#started || origin === this.remoteOrigin) return;
    try {
      this.#assertDocumentBound();
      this.#enqueue({
        id: `${this.#clientId}:${(this.#sequence += 1).toString(36)}`,
        bytes: update,
      });
      if (this.#status === "online") void this.#flush(this.#generation);
    } catch (error) {
      this.#fail(toError(error, "Local collaboration update was rejected"), false);
    }
  };

  async #join(generation: number): Promise<void> {
    if (!this.#active(generation)) return;
    this.#clearConnection();
    this.#setState("connecting");
    const controller = new AbortController();
    this.#abortController = controller;
    try {
      this.#subscription = this.#transport.subscribe(
        this.#scope,
        (update) => this.#receive(update, generation),
        (error) => {
          if (!this.#active(generation)) return;
          this.#fail(toError(error, "Collaboration connection closed"), true);
        },
      );
      const localVector = encodeCollaborativeJourneyStateVector(this.#doc);
      assertBytes(localVector, this.#limits.maxStateVectorBytes, "local state vector");
      const response = await this.#transport.handshake({
        scope: this.#scope,
        stateVector: cloneBytes(localVector),
        signal: controller.signal,
      });
      if (!this.#active(generation)) return;
      assertBytes(response.stateVector, this.#limits.maxStateVectorBytes, "remote state vector");
      for (const update of response.updates) this.#applyRemote(update);
      this.#assertDocumentBound();

      const localDelta = encodeCollaborativeJourneyUpdate(this.#doc, response.stateVector);
      if (localDelta.byteLength > EMPTY_UPDATE_MAXIMUM_BYTES) {
        this.#enqueue({
          id: `${this.#clientId}:rejoin:${updateFingerprint(localDelta)}`,
          bytes: localDelta,
        });
      }
      this.#reconnectAttempt = 0;
      this.#lastError = undefined;
      this.#setState("online");
      await this.#flush(generation);
    } catch (error) {
      if (controller.signal.aborted || !this.#active(generation)) return;
      this.#fail(toError(error, "Collaboration handshake failed"), true);
    }
  }

  async #flush(generation: number): Promise<void> {
    if (this.#flushing || this.#status !== "online" || !this.#active(generation)) return;
    this.#flushing = true;
    try {
      while (this.#queue.size > 0 && this.#status === "online" && this.#active(generation)) {
        const batch = [...this.#queue.values()].slice(0, this.#limits.maxPushBatch);
        const response = await this.#transport.push({
          scope: this.#scope,
          updates: batch.map((update) => ({ id: update.id, bytes: cloneBytes(update.bytes) })),
          signal: this.#abortController?.signal ?? new AbortController().signal,
        });
        if (!this.#active(generation)) return;
        for (const update of response.updates ?? []) this.#applyRemote(update);
        const acknowledged = new Set(response.acknowledgedUpdateIds);
        if (!batch.some((update) => acknowledged.has(update.id))) {
          throw new Error("Collaboration peer did not acknowledge any queued update");
        }
        for (const update of batch) {
          if (!acknowledged.has(update.id)) continue;
          const queued = this.#queue.get(update.id);
          if (!queued) continue;
          this.#queue.delete(update.id);
          this.#pendingBytes -= queued.bytes.byteLength;
        }
        this.#emit();
      }
    } catch (error) {
      if (this.#active(generation)) {
        this.#fail(toError(error, "Collaboration push failed"), true);
      }
    } finally {
      this.#flushing = false;
    }
  }

  #receive(update: CollaborationUpdate, generation: number): void {
    if (!this.#active(generation)) return;
    try {
      this.#applyRemote(update);
      this.#assertDocumentBound();
    } catch (error) {
      this.#fail(toError(error, "Remote collaboration update was rejected"), true);
    }
  }

  #applyRemote(update: CollaborationUpdate): void {
    assertIdentifier(update.id, "update id");
    assertBytes(update.bytes, this.#limits.maxUpdateBytes, "remote update");
    applyCollaborativeJourneyUpdate(this.#doc, update.bytes, this.remoteOrigin);
  }

  #enqueue(update: CollaborationUpdate): void {
    assertIdentifier(update.id, "update id");
    assertBytes(update.bytes, this.#limits.maxUpdateBytes, "local update");
    if (this.#queue.has(update.id)) return;
    if (
      this.#queue.size >= this.#limits.maxQueuedUpdates ||
      this.#pendingBytes + update.bytes.byteLength > this.#limits.maxQueuedBytes
    ) {
      const compacted = encodeCollaborativeJourneyUpdate(this.#doc);
      assertBytes(compacted, this.#limits.maxUpdateBytes, "compacted local update");
      if (compacted.byteLength > this.#limits.maxQueuedBytes) {
        throw new RangeError("Collaboration update queue byte bound exceeded");
      }
      this.#queue.clear();
      this.#pendingBytes = 0;
      update = {
        id: `${this.#clientId}:compact:${updateFingerprint(compacted)}`,
        bytes: compacted,
      };
    }
    const stored = { id: update.id, bytes: cloneBytes(update.bytes) };
    this.#queue.set(stored.id, stored);
    this.#pendingBytes += stored.bytes.byteLength;
    this.#emit();
  }

  #assertDocumentBound(): void {
    const update = encodeCollaborativeJourneyUpdate(this.#doc);
    if (update.byteLength > this.#limits.maxDocumentBytes) {
      throw new RangeError("Collaborative document byte bound exceeded");
    }
    const validation = validateCollaborativeJourney(this.#doc, {
      validateServerOwnedField: () => "reject",
    });
    if (!validation.ok) {
      const detail = validation.issues[0]?.message ?? "contains unsafe collaborative data";
      throw new Error(`Collaborative document rejected: ${detail}`);
    }
  }

  #fail(error: Error, reconnect: boolean): void {
    this.#lastError = error;
    this.#clearConnection();
    this.#setState("offline");
    if (reconnect) this.#scheduleReconnect();
  }

  #scheduleReconnect(): void {
    if (!this.#started || this.#retryTimer) return;
    this.#reconnectAttempt += 1;
    const delay = Math.min(
      this.#retryMaximumMs,
      this.#retryBaseMs * 2 ** Math.min(this.#reconnectAttempt - 1, 20),
    );
    const generation = this.#generation;
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = undefined;
      void this.#join(generation);
    }, delay);
    this.#emit();
  }

  #clearConnection(): void {
    this.#abortController?.abort();
    this.#abortController = undefined;
    this.#subscription?.close();
    this.#subscription = undefined;
    if (this.#retryTimer) clearTimeout(this.#retryTimer);
    this.#retryTimer = undefined;
  }

  #active(generation: number): boolean {
    return this.#started && !this.#destroyed && this.#generation === generation;
  }

  #setState(status: CollaborationProviderStatus): void {
    this.#status = status;
    this.#emit();
  }

  #emit(): void {
    const snapshot = this.snapshot;
    for (const listener of this.#listeners) listener(snapshot);
  }
}
