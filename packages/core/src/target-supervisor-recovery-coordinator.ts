import type { TargetSupervisorHealth } from "@relay/protocol";
import type { SupervisedTarget, TargetSupervisorStore } from "./target-supervisor-store.js";
import type { TargetSupervisorEffect } from "./target-supervisor.js";

type AutomaticRecoveryEffect = Extract<TargetSupervisorEffect, { kind: "recover" }>;

export type TargetSupervisorRecoveryReceipt = {
  outcome: "succeeded" | "failed";
  durationMs?: number;
  reason?: string;
};

/** Adapter-owned mechanism; the coordinator remains the sole policy owner. */
export type TargetSupervisorRecoveryAdapter = {
  execute(
    target: SupervisedTarget,
    effect: AutomaticRecoveryEffect,
  ): Promise<TargetSupervisorRecoveryReceipt>;
};

function targetKey(target: SupervisedTarget): string {
  return `${target.kind}:${target.id}`;
}

/**
 * Execute only the bounded pixel/semantic effects returned by TargetSupervisor.
 * Input reconciliation is intentionally absent: an uncertain mutation requires
 * a reviewed fresh observation through target.input.reconcile, never recovery
 * code that might issue another command.
 */
export class TargetSupervisorRecoveryCoordinator {
  readonly #active = new Set<string>();

  constructor(
    readonly store: TargetSupervisorStore,
    readonly adapter: TargetSupervisorRecoveryAdapter,
  ) {}

  async recover(
    target: SupervisedTarget,
    channel: "pixels" | "semantics",
  ): Promise<TargetSupervisorHealth> {
    const key = targetKey(target);
    if (this.#active.has(key)) throw new Error("Target recovery already has an active owner");
    this.#active.add(key);
    try {
      let effects = this.store.transition(target, {
        kind: "recovery.requested",
        channel,
      }).effects;
      while (effects.length > 0) {
        if (effects.length !== 1 || effects[0]?.kind !== "recover") {
          throw new Error("Automatic target recovery produced an unsupported effect");
        }
        const effect = effects[0];
        const startedAt = Date.now();
        let receipt: TargetSupervisorRecoveryReceipt;
        try {
          receipt = await this.adapter.execute(target, effect);
        } catch (error) {
          receipt = {
            outcome: "failed",
            reason: error instanceof Error ? error.message : String(error),
          };
        }
        effects = this.store.transition(target, {
          kind: "recovery.step-completed",
          channel: effect.channel,
          stage: effect.stage,
          outcome: receipt.outcome,
          durationMs: receipt.durationMs ?? Math.max(0, Date.now() - startedAt),
          reason: receipt.reason,
        }).effects;
      }
      return this.store.health(target);
    } finally {
      this.#active.delete(key);
    }
  }
}
