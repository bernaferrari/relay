import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  TargetSupervisorRecoveryCoordinator,
  type TargetSupervisorRecoveryAdapter,
} from "./target-supervisor-recovery-coordinator.js";
import { TargetSupervisorStore } from "./target-supervisor-store.js";

const target = { id: "ipad-recovery-owner", kind: "ios" } as const;

test("one coordinator owns bounded recovery escalation and persists every receipt", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "relay-supervisor-recovery-"));
  const store = new TargetSupervisorStore(join(root, "supervisors.sqlite"));
  t.after(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  const stages: string[] = [];
  const adapter: TargetSupervisorRecoveryAdapter = {
    async execute(_target, effect) {
      stages.push(effect.stage);
      return effect.stage === "refresh-semantics"
        ? { outcome: "failed", durationMs: 4, reason: "tree stayed wedged" }
        : { outcome: "succeeded", durationMs: 7 };
    },
  };
  const coordinator = new TargetSupervisorRecoveryCoordinator(store, adapter);
  const health = await coordinator.recover(target, "semantics");

  assert.deepEqual(stages, ["refresh-semantics", "restart-semantic-runner"]);
  assert.equal(health.recovery, undefined);
  assert.equal(health.semantics.state, "refreshing");
  assert.equal(health.epochs.semanticSession, 2);
  assert.equal(health.counters.recoveryAttempts, 2);
  assert.equal(health.counters.recoveryFailures, 1);
  assert.deepEqual(
    health.events.filter((event) => event.code.startsWith("RECOVERY_")).map((event) => event.code),
    ["RECOVERY_COMPLETED", "RECOVERY_ESCALATED", "RECOVERY_STARTED"],
  );
});

test("a target has one recovery owner and adapter failures stay inside the bounded policy", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "relay-supervisor-recovery-owner-"));
  const store = new TargetSupervisorStore(join(root, "supervisors.sqlite"));
  t.after(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  let release!: () => void;
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const coordinator = new TargetSupervisorRecoveryCoordinator(store, {
    async execute() {
      calls += 1;
      if (calls === 1) await paused;
      throw new Error("adapter unavailable");
    },
  });
  const first = coordinator.recover(target, "pixels");
  await new Promise<void>((resolve) => setImmediate(resolve));
  await assert.rejects(coordinator.recover(target, "pixels"), /active owner/u);
  release();
  const health = await first;

  assert.equal(calls, 2);
  assert.equal(health.overall, "needs-human");
  assert.equal(health.counters.recoveryFailures, 2);
  assert.equal(health.recovery, undefined);
});
