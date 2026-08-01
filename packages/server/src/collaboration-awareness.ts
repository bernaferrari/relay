import type {
  ActorIdentity,
  CollaborationAwareness,
  CollaborationAwarenessPublishInput,
} from "@relay/protocol";
import type { CollaborativeJourneyScope } from "./collaborative-journey-store.js";

export type CollaborationAwarenessLimits = {
  ttlMs: number;
  throttleMs: number;
  maximumActorsPerJourney: number;
};

export type CollaborationAwarenessServiceOptions = {
  clock?: () => number;
  limits?: Partial<CollaborationAwarenessLimits>;
};

const DEFAULT_LIMITS: CollaborationAwarenessLimits = {
  ttlMs: 15_000,
  throttleMs: 50,
  maximumActorsPerJourney: 200,
};

export class CollaborationAwarenessError extends Error {
  constructor(
    readonly code: "capacity" | "throttled",
    message: string,
  ) {
    super(message);
    this.name = "CollaborationAwarenessError";
  }
}

function scopeKey(scope: CollaborativeJourneyScope): string {
  return `${scope.organizationId}\u0000${scope.projectId}\u0000${scope.journeyId}`;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be positive`);
}

/**
 * Process-local, lossy presence. It intentionally has no persistence provider
 * and no Y.Doc reference, so awareness can never become Journey authority.
 */
export class CollaborationAwarenessService {
  readonly #clock: () => number;
  readonly #limits: CollaborationAwarenessLimits;
  readonly #entries = new Map<string, Map<string, CollaborationAwareness>>();

  constructor(options: CollaborationAwarenessServiceOptions = {}) {
    this.#clock = options.clock ?? Date.now;
    this.#limits = { ...DEFAULT_LIMITS, ...options.limits };
    for (const [name, value] of Object.entries(this.#limits)) assertPositiveInteger(value, name);
  }

  publish(
    scope: CollaborativeJourneyScope,
    actor: ActorIdentity,
    input: CollaborationAwarenessPublishInput,
  ): CollaborationAwareness {
    const now = this.#clock();
    const entries = this.#activeEntries(scope, now);
    const previous = entries.get(actor.actorId);
    if (previous && now - previous.updatedAt < this.#limits.throttleMs) {
      throw new CollaborationAwarenessError(
        "throttled",
        `awareness updates are limited to one every ${this.#limits.throttleMs}ms per actor`,
      );
    }
    if (!previous && entries.size >= this.#limits.maximumActorsPerJourney) {
      throw new CollaborationAwarenessError(
        "capacity",
        "collaboration awareness reached its actor bound",
      );
    }
    const entry: CollaborationAwareness = {
      actorId: actor.actorId,
      actorKind: actor.actorKind,
      activity: input.activity,
      ...(input.displayName ? { displayName: input.displayName } : {}),
      ...(input.avatarToken ? { avatarToken: input.avatarToken } : {}),
      ...(input.cursor ? { cursor: { ...input.cursor } } : {}),
      ...(input.selection ? { selection: { ...input.selection } } : {}),
      ...(input.viewport ? { viewport: { ...input.viewport } } : {}),
      updatedAt: now,
      expiresAt: now + this.#limits.ttlMs,
    };
    entries.set(actor.actorId, entry);
    return structuredClone(entry);
  }

  list(scope: CollaborativeJourneyScope): CollaborationAwareness[] {
    return [...this.#activeEntries(scope, this.#clock()).values()]
      .sort((left, right) => left.actorId.localeCompare(right.actorId))
      .map((entry) => structuredClone(entry));
  }

  remove(scope: CollaborativeJourneyScope, actorId: string): boolean {
    const key = scopeKey(scope);
    const entries = this.#entries.get(key);
    if (!entries) return false;
    const removed = entries.delete(actorId);
    if (entries.size === 0) this.#entries.delete(key);
    return removed;
  }

  /** Explicit transport-disconnect hook; callers provide the trusted actor. */
  disconnect(scope: CollaborativeJourneyScope, actorId: string): boolean {
    return this.remove(scope, actorId);
  }

  #activeEntries(
    scope: CollaborativeJourneyScope,
    now: number,
  ): Map<string, CollaborationAwareness> {
    const key = scopeKey(scope);
    let entries = this.#entries.get(key);
    if (!entries) {
      entries = new Map();
      this.#entries.set(key, entries);
    }
    for (const [actorId, entry] of entries) {
      if (entry.expiresAt <= now) entries.delete(actorId);
    }
    if (entries.size === 0 && this.#entries.get(key) === entries) {
      // Keep the map for a publish caller; list/remove may leave no durable state.
    }
    return entries;
  }
}
