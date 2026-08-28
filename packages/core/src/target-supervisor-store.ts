/** Server-owned durable registry for one TargetSupervisor actor per target. */
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { TargetKind, TargetRuntimeReadiness, TargetSupervisorHealth } from "@relay/protocol";
import { findWorkspaceRoot } from "./workspace-root.js";
import {
  TargetSupervisor,
  type TargetSupervisorCheckpoint,
  type TargetSupervisorClock,
  type TargetSupervisorEvent,
  type TargetSupervisorTransition,
} from "./target-supervisor.js";

const TARGET_SUPERVISOR_DB = "target-supervisors.sqlite";

export type SupervisedTarget = { id: string; kind: TargetKind };

function stateRoot(): string {
  return process.env.RELAY_STATE_DIR?.trim() || join(findWorkspaceRoot(), ".relay");
}

export function targetSupervisorStorePath(root = stateRoot()): string {
  return join(root, TARGET_SUPERVISOR_DB);
}

function targetKey(target: SupervisedTarget): string {
  return `${target.kind}:${target.id}`;
}

function parseCheckpoint(document: string): TargetSupervisorCheckpoint | undefined {
  try {
    return JSON.parse(document) as TargetSupervisorCheckpoint;
  } catch {
    return undefined;
  }
}

export class TargetSupervisorStore {
  readonly #db: DatabaseSync;
  readonly #actors = new Map<string, TargetSupervisor>();
  readonly #clock: TargetSupervisorClock;
  readonly #beforePersistTransition?: (event: TargetSupervisorEvent) => void;
  #closed = false;

  constructor(
    readonly path = targetSupervisorStorePath(),
    options: {
      clock?: TargetSupervisorClock;
      /** Deterministic persistence fault injection for exact-once tests. */
      beforePersistTransition?: (event: TargetSupervisorEvent) => void;
    } = {},
  ) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.#db = new DatabaseSync(path, { timeout: 5_000 });
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS target_supervisors (
        target_key TEXT PRIMARY KEY,
        target_kind TEXT NOT NULL,
        target_id TEXT NOT NULL,
        document TEXT NOT NULL
      );
    `);
    this.#clock = options.clock ?? { now: () => Date.now() };
    this.#beforePersistTransition = options.beforePersistTransition;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#actors.clear();
    this.#db.close();
  }

  health(target: SupervisedTarget, readiness?: TargetRuntimeReadiness): TargetSupervisorHealth {
    const actor = this.#actor(target);
    if (readiness) this.#ingestReadiness(actor, readiness);
    this.#persist(actor);
    return actor.health();
  }

  transition(target: SupervisedTarget, event: TargetSupervisorEvent): TargetSupervisorTransition {
    const key = targetKey(target);
    const actor = this.#actor(target);
    const result = actor.transition(event);
    try {
      this.#beforePersistTransition?.(event);
      this.#persist(actor);
      return result;
    } catch (error) {
      // The actor mutates before SQLite writes. Never leave an uncommitted
      // transition cached: the next read must rehydrate the durable checkpoint.
      this.#actors.delete(key);
      throw error;
    }
  }

  recordPixelCapture(
    target: SupervisedTarget,
    input: { durationMs?: number; fingerprint?: string },
  ): TargetSupervisorHealth {
    const actor = this.#actor(target);
    actor.transition({ kind: "pixels.captured", durationMs: input.durationMs });
    if (input.fingerprint) {
      const current = actor.health().context;
      actor.transition({
        kind: "context.updated",
        context: { ...current, screenFingerprint: input.fingerprint },
      });
    }
    this.#persist(actor);
    return actor.health();
  }

  recordSemanticReceipt(
    target: SupervisedTarget,
    input: {
      state: "current" | "stale" | "unavailable" | "in-flight" | "wedged";
      durationMs?: number;
      reason?: string;
      foregroundApp?: string;
    },
  ): TargetSupervisorHealth {
    const actor = this.#actor(target);
    let token = actor.health().semantics.traversal?.token;
    if (!token) {
      token = actor.transition({ kind: "semantics.traversal-started" }).traversalToken!;
    }
    if (input.state === "in-flight") {
      actor.transition({
        kind: "semantics.traversal-timed-out",
        token,
        durationMs: input.durationMs,
      });
    } else if (input.state === "wedged") {
      actor.transition({
        kind: "semantics.traversal-wedged",
        token,
        reason: input.reason ?? "The semantic traversal is wedged.",
      });
    } else {
      actor.transition({
        kind: "semantics.traversal-completed",
        token,
        usable: input.state === "current" || input.state === "stale",
        ...(input.state === "stale" ? { freshness: "stale" as const } : {}),
        durationMs: input.durationMs,
        reason: input.reason,
      });
    }
    if (input.foregroundApp) {
      actor.transition({
        kind: "context.updated",
        context: { ...actor.health().context, foregroundApp: input.foregroundApp },
      });
    }
    this.#persist(actor);
    return actor.health();
  }

  invalidateSemantics(target: SupervisedTarget, reason: string): void {
    const actor = this.#actor(target);
    actor.transition({ kind: "semantics.invalidated", reason });
    this.#persist(actor);
  }

  recordRecoveryReceipt(
    target: SupervisedTarget,
    input: {
      channel: "pixels" | "semantics";
      outcome: "succeeded" | "failed";
      reason: string;
      readiness?: TargetRuntimeReadiness;
    },
  ): TargetSupervisorHealth {
    const actor = this.#actor(target);
    actor.transition({
      kind: "recovery.receipt",
      channel: input.channel,
      outcome: input.outcome,
      reason: input.reason,
    });
    if (input.readiness) this.#ingestReadiness(actor, input.readiness);
    this.#persist(actor);
    return actor.health();
  }

  checkpoint(target: SupervisedTarget): TargetSupervisorCheckpoint {
    return this.#actor(target).checkpoint();
  }

  #actor(target: SupervisedTarget): TargetSupervisor {
    if (this.#closed) throw new Error("TargetSupervisor store is closed");
    const key = targetKey(target);
    const cached = this.#actors.get(key);
    if (cached) return cached;
    const row = this.#db
      .prepare("SELECT document FROM target_supervisors WHERE target_key = ?")
      .get(key) as { document?: unknown } | undefined;
    const checkpoint =
      typeof row?.document === "string" ? parseCheckpoint(row.document) : undefined;
    let actor: TargetSupervisor;
    try {
      actor = checkpoint
        ? TargetSupervisor.rehydrate(checkpoint, { clock: this.#clock })
        : TargetSupervisor.start(target, { clock: this.#clock });
    } catch {
      actor = TargetSupervisor.start(target, { clock: this.#clock });
    }
    this.#actors.set(key, actor);
    this.#persist(actor);
    return actor;
  }

  #persist(actor: TargetSupervisor): void {
    const checkpoint = actor.checkpoint();
    this.#db
      .prepare(
        `INSERT INTO target_supervisors(target_key, target_kind, target_id, document)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(target_key) DO UPDATE SET
           target_kind = excluded.target_kind,
           target_id = excluded.target_id,
           document = excluded.document`,
      )
      .run(
        targetKey(checkpoint.target),
        checkpoint.target.kind,
        checkpoint.target.id,
        JSON.stringify(checkpoint),
      );
  }

  #ingestReadiness(actor: TargetSupervisor, readiness: TargetRuntimeReadiness): void {
    const health = actor.health();
    const pixel = readiness.previewPixels;
    if (
      pixel.state === "proven" &&
      pixel.freshness === "current" &&
      (health.pixels.state !== "ready" || pixel.proof?.at !== health.pixels.lastCapturedAt)
    ) {
      actor.transition({ kind: "pixels.captured", durationMs: pixel.proof?.durationMs });
    } else if (pixel.state === "unavailable" && health.pixels.state !== "unavailable") {
      actor.transition({
        kind: "pixels.unavailable",
        reason: pixel.lastError?.message ?? pixel.reason ?? "Pixel capture is unavailable.",
      });
    }
    const semantic = readiness.semanticControl;
    // A fresh server process has not disproved the last durable semantic proof.
    // Preserve the rehydrated stale state until an adapter provides an actual
    // receipt; otherwise a read-only health request would manufacture failure.
    if (semantic.state === "unproven") return;
    const desired =
      semantic.state === "proven"
        ? semantic.freshness === "stale"
          ? "stale"
          : "current"
        : semantic.reason === "probe-in-flight"
          ? "in-flight"
          : "unavailable";
    const current = actor.health().semantics;
    if (desired === "in-flight" && (current.state === "refreshing" || current.state === "wedged")) {
      return;
    }
    if (
      desired === current.state &&
      (semantic.proof?.at === undefined || semantic.proof.at === current.lastCapturedAt)
    ) {
      return;
    }
    this.recordSemanticReceipt(actor.health().target, {
      state: desired,
      durationMs: semantic.proof?.durationMs ?? semantic.lastError?.durationMs,
      reason: semantic.lastError?.message ?? semantic.reason,
    });
  }
}

const registryContext = new AsyncLocalStorage<TargetSupervisorStore>();

export function currentTargetSupervisorStore(): TargetSupervisorStore | undefined {
  return registryContext.getStore();
}

export function runWithTargetSupervisorStore<T>(
  store: TargetSupervisorStore,
  operation: () => T,
): T {
  return registryContext.run(store, operation);
}
