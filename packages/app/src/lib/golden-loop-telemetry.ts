import {
  GOLDEN_LOOP_MAX_EVENTS,
  GOLDEN_LOOP_RETENTION_MS,
  parseGoldenLoopTelemetryStore,
  projectGoldenLoopTelemetry,
  type GoldenLoopTelemetryEvent,
  type GoldenLoopTelemetryReport,
  type GoldenLoopTelemetryStore,
} from "@relay/protocol";

const STORAGE_KEY = "relay:golden-loop-telemetry:v1";
const SALT_KEY = "relay:golden-loop-telemetry-salt:v1";

type EventInput = GoldenLoopTelemetryEvent extends infer Event
  ? Event extends GoldenLoopTelemetryEvent
    ? Omit<Event, "schemaVersion" | "sequence" | "at" | "projectScopeId" | "journeyId">
    : never
  : never;

export type GoldenLoopLocalEvent = EventInput & {
  projectKey: string;
  journeyKey: string;
};

export type GoldenLoopTelemetryStorage = Pick<Storage, "getItem" | "setItem">;

function hex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function randomSalt(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return hex(bytes);
}

async function pseudonym(salt: string, scope: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${salt}\0${scope}`),
  );
  return `local:${hex(new Uint8Array(digest))}`;
}

/** One local-only sink for the product funnel. Its input accepts raw local
 * identity only long enough to salt+hash it; persisted events cannot represent
 * content, labels, text, selectors, target identifiers, or arbitrary metadata. */
export function createGoldenLoopTelemetrySink(input: {
  storage?: GoldenLoopTelemetryStorage;
  now?: () => number;
}) {
  const now = input.now ?? Date.now;
  let memoryStore: GoldenLoopTelemetryStore | undefined;
  let memorySalt: string | undefined;
  let emissionQueue: Promise<void> = Promise.resolve();

  function storage(): GoldenLoopTelemetryStorage | undefined {
    if (input.storage) return input.storage;
    try {
      return globalThis.localStorage;
    } catch {
      return undefined;
    }
  }

  function salt(): string {
    if (memorySalt) return memorySalt;
    let persisted: string | null | undefined;
    try {
      persisted = storage()?.getItem(SALT_KEY);
    } catch {
      persisted = undefined;
    }
    memorySalt = /^[a-f0-9]{64}$/u.test(persisted ?? "") ? persisted! : randomSalt();
    try {
      storage()?.setItem(SALT_KEY, memorySalt);
    } catch {
      // Ephemeral storage remains privacy-safe and useful for this process.
    }
    return memorySalt;
  }

  function prune(store: GoldenLoopTelemetryStore, at: number): GoldenLoopTelemetryStore {
    const cutoff = at - GOLDEN_LOOP_RETENTION_MS;
    const events = store.events
      .filter((candidate) => candidate.at >= cutoff)
      .slice(-GOLDEN_LOOP_MAX_EVENTS);
    return events.length === store.events.length && events[0] === store.events[0]
      ? store
      : { schemaVersion: 1, createdAt: store.createdAt, events };
  }

  function read(): GoldenLoopTelemetryStore {
    const readAt = now();
    const fallback = memoryStore ?? { schemaVersion: 1 as const, createdAt: readAt, events: [] };
    let parsed = fallback;
    try {
      const raw = storage()?.getItem(STORAGE_KEY);
      if (raw) parsed = parseGoldenLoopTelemetryStore(JSON.parse(raw));
    } catch {
      parsed = fallback;
    }
    const retained = prune(parsed, readAt);
    memoryStore = retained;
    if (retained !== parsed) write(retained);
    return retained;
  }

  function write(store: GoldenLoopTelemetryStore): void {
    memoryStore = store;
    try {
      storage()?.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
      // Measurement never blocks the product workflow.
    }
  }

  async function append(local: GoldenLoopLocalEvent): Promise<GoldenLoopTelemetryEvent> {
    const { projectKey, journeyKey, ...payload } = local;
    if (!projectKey || !journeyKey) throw new Error("golden-loop local identity is required");
    const at = now();
    const current = read();
    const latestSequence = current.events.reduce(
      (highest, event) => Math.max(highest, event.sequence),
      0,
    );
    const [projectScopeId, journeyId] = await Promise.all([
      pseudonym(salt(), `project:${projectKey}`),
      pseudonym(salt(), `project:${projectKey}\0journey:${journeyKey}`),
    ]);
    const event = {
      schemaVersion: 1,
      sequence: latestSequence + 1,
      at,
      projectScopeId,
      journeyId,
      ...payload,
    } as GoldenLoopTelemetryEvent;
    const events = [...current.events, event].slice(-GOLDEN_LOOP_MAX_EVENTS);
    write({ schemaVersion: 1, createdAt: current.createdAt, events });
    return event;
  }

  async function emit(local: GoldenLoopLocalEvent): Promise<GoldenLoopTelemetryEvent | undefined> {
    let result: GoldenLoopTelemetryEvent | undefined;
    const queued = emissionQueue.then(async () => {
      result = await append(local);
    });
    emissionQueue = queued.catch(() => undefined);
    try {
      await queued;
    } catch {
      // Measurement must never affect recording, execution, or review.
      return undefined;
    }
    return result;
  }

  function report(): GoldenLoopTelemetryReport {
    return projectGoldenLoopTelemetry(read().events, now());
  }

  return { emit, read, report };
}

export const goldenLoopTelemetry = createGoldenLoopTelemetrySink({});

export function recordGoldenLoopHelp(projectKey: string): void {
  void goldenLoopTelemetry.emit({
    projectKey,
    journeyKey: projectKey,
    type: "help-opened",
    surface: "in-product-help",
  });
}
