import { createHash, randomUUID } from "node:crypto";
import { rename, unlink, writeFile } from "node:fs/promises";

/** Serializes only operations that address the same resource. Idle keys are
 * removed immediately, so unrelated resources never share a
 * process-wide write queue. */
export class KeyedSerialQueue {
  readonly #tails = new Map<string, Promise<void>>();

  async run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const turn = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => turn);
    this.#tails.set(key, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    }
  }

  get activeKeys(): number {
    return this.#tails.size;
  }
}

export class IdempotencyConflict extends Error {
  readonly status = 409;

  constructor(message = "Idempotency key was already used with a different payload") {
    super(message);
    this.name = "IdempotencyConflict";
  }
}

type IdempotencyEntry<T> = {
  fingerprint: string;
  value: T;
  expiresAt: number;
};

/** A bounded, expiring replay cache. The caller supplies a fully scoped key;
 * payload fingerprints make accidental key reuse a conflict instead of
 * returning the result of another write. */
export class BoundedIdempotencyStore<T> {
  readonly #entries = new Map<string, IdempotencyEntry<T>>();

  constructor(
    readonly maxEntries = 512,
    readonly ttlMs = 15 * 60_000,
  ) {}

  get(key: string, fingerprint: string, at = Date.now()): T | undefined {
    this.#prune(at);
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    if (entry.fingerprint !== fingerprint) throw new IdempotencyConflict();
    // Refresh insertion order for deterministic least-recently-used eviction.
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return structuredClone(entry.value);
  }

  set(key: string, fingerprint: string, value: T, at = Date.now()): void {
    this.#prune(at);
    const existing = this.#entries.get(key);
    if (existing && existing.fingerprint !== fingerprint) throw new IdempotencyConflict();
    this.#entries.delete(key);
    this.#entries.set(key, {
      fingerprint,
      value: structuredClone(value),
      expiresAt: at + this.ttlMs,
    });
    while (this.#entries.size > this.maxEntries) {
      const oldest = this.#entries.keys().next().value as string | undefined;
      if (!oldest) break;
      this.#entries.delete(oldest);
    }
  }

  get size(): number {
    return this.#entries.size;
  }

  #prune(at: number): void {
    for (const [key, entry] of this.#entries) {
      if (entry.expiresAt <= at) this.#entries.delete(key);
    }
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
}

export function payloadFingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

export function scopedIdempotencyKey(input: {
  organizationId: string;
  projectId: string;
  operationId: string;
  idempotencyKey: string;
  resourceKind: string;
  resourceId: string;
}): string {
  return [
    input.organizationId,
    input.projectId,
    input.operationId,
    input.idempotencyKey,
    input.resourceKind,
    input.resourceId,
  ].join("\u0000");
}

/** Writes next to the destination and always removes its temporary file when
 * rename fails. A successful rename is atomic on the destination filesystem. */
export async function atomicWriteFile(destination: string, contents: string): Promise<void> {
  const temp = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, contents, "utf8");
    await rename(temp, destination);
  } finally {
    await unlink(temp).catch((error: unknown) => {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    });
  }
}
