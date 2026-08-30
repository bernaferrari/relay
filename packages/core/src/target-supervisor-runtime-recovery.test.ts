import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import type { TargetRuntimeReadiness } from "@relay/protocol";
import {
  recoverSupervisedTargetRuntime,
  type LocalTargetSupervisorRecoveryMechanisms,
} from "./target-supervisor-runtime-recovery.js";
import { TargetSupervisorStore } from "./target-supervisor-store.js";

const target = { id: "ipad-runtime-recovery", kind: "ios" } as const;

function readiness(input: { pixels?: boolean; semantics?: boolean }): TargetRuntimeReadiness {
  const unavailable = (mode: "pixels" | "accessibility" | "evidence") => ({
    mode,
    state: "unavailable" as const,
    freshness: "unproven" as const,
    reason: "probe-failed" as const,
  });
  return {
    previewPixels: input.pixels
      ? { mode: "pixels", state: "proven", freshness: "current", proof: { at: 10 } }
      : unavailable("pixels"),
    semanticControl: input.semantics
      ? {
          mode: "accessibility",
          state: "proven",
          freshness: "current",
          proof: { at: 11, observedNodeCount: 4 },
        }
      : unavailable("accessibility"),
    evidenceCapture: input.pixels
      ? { mode: "evidence", state: "proven", freshness: "current", proof: { at: 10 } }
      : unavailable("evidence"),
  };
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "relay-runtime-recovery-"));
  const store = new TargetSupervisorStore(join(root, "supervisors.sqlite"));
  t.after(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  return store;
}

test("the supervisor chooses semantic escalation while the adapter only executes stages", async (t) => {
  const store = await fixture(t);
  const calls: string[] = [];
  const mechanisms: LocalTargetSupervisorRecoveryMechanisms = {
    async refreshPixels() {
      throw new Error("pixel recovery was not requested");
    },
    async refreshSemantics() {
      calls.push("refresh-semantics");
      return { readiness: readiness({ pixels: true }), reason: "tree unavailable" };
    },
    async restartSemanticRunner() {
      calls.push("restart-semantic-runner");
      return {
        readiness: readiness({ pixels: true, semantics: true }),
        reason: "runner returned fresh controls",
      };
    },
    async preparePlatformServices() {
      throw new Error("platform preparation must not run after fresh proof");
    },
  };

  const recovery = await recoverSupervisedTargetRuntime({
    store,
    target,
    channel: "semantics",
    mechanisms,
  });

  assert.deepEqual(calls, ["refresh-semantics", "restart-semantic-runner"]);
  assert.equal(recovery.ready, true);
  assert.deepEqual(
    recovery.actions.map((action) => action.detail.split(":", 1)[0]),
    ["refresh-semantics", "restart-semantic-runner"],
  );
  const health = store.health(target);
  assert.equal(health.semantics.state, "current");
  assert.equal(health.overall, "ready");
  assert.equal(health.counters.recoveryAttempts, 2);
  assert.equal(health.counters.recoveryFailures, 1);
});

test("pixel recovery accepts only fresh pixel proof and never invokes semantic mechanisms", async (t) => {
  const store = await fixture(t);
  const calls: string[] = [];
  const forbidden = async () => {
    throw new Error("semantic mechanism must not run for a successful pixel refresh");
  };
  const recovery = await recoverSupervisedTargetRuntime({
    store,
    target,
    channel: "pixels",
    mechanisms: {
      async refreshPixels() {
        calls.push("refresh-pixels");
        return {
          readiness: readiness({ pixels: true }),
          reason: "fresh screenshot captured",
        };
      },
      refreshSemantics: forbidden,
      restartSemanticRunner: forbidden,
      preparePlatformServices: forbidden,
    },
  });

  assert.deepEqual(calls, ["refresh-pixels"]);
  assert.equal(recovery.ready, true);
  assert.equal(store.health(target).pixels.state, "ready");
});

test("separate recovery callers still share one durable target owner", async (t) => {
  const store = await fixture(t);
  let release!: () => void;
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const mechanisms: LocalTargetSupervisorRecoveryMechanisms = {
    async refreshPixels() {
      throw new Error("unexpected pixel recovery");
    },
    async refreshSemantics() {
      calls += 1;
      await paused;
      return {
        readiness: readiness({ pixels: true, semantics: true }),
        reason: "fresh controls",
      };
    },
    async restartSemanticRunner() {
      throw new Error("unexpected escalation");
    },
    async preparePlatformServices() {
      throw new Error("unexpected escalation");
    },
  };
  const first = recoverSupervisedTargetRuntime({
    store,
    target,
    channel: "semantics",
    mechanisms,
  });
  await new Promise<void>((resolve) => setImmediate(resolve));

  await assert.rejects(
    recoverSupervisedTargetRuntime({
      store,
      target,
      channel: "semantics",
      mechanisms,
    }),
    /already active/u,
  );
  release();
  assert.equal((await first).ready, true);
  assert.equal(calls, 1);
});

test("exhausted recovery stops after the bounded stage plan and asks for a human", async (t) => {
  const store = await fixture(t);
  const calls: string[] = [];
  const failed = async (stage: string) => {
    calls.push(stage);
    return { readiness: readiness({ pixels: true }), reason: `${stage} failed` };
  };
  const recovery = await recoverSupervisedTargetRuntime({
    store,
    target,
    channel: "semantics",
    mechanisms: {
      async refreshPixels() {
        throw new Error("unexpected pixel recovery");
      },
      refreshSemantics: () => failed("refresh-semantics"),
      restartSemanticRunner: () => failed("restart-semantic-runner"),
      preparePlatformServices: () => failed("prepare-platform-services"),
    },
  });

  assert.deepEqual(calls, [
    "refresh-semantics",
    "restart-semantic-runner",
    "prepare-platform-services",
  ]);
  assert.equal(recovery.ready, false);
  assert.equal(store.health(target).overall, "needs-human");
  assert.equal(store.health(target).counters.recoveryAttempts, 3);
});

test("an explicit forced recovery clears quarantine before collecting fresh proof", async (t) => {
  const store = await fixture(t);
  store.transition(target, {
    kind: "operator.quarantined",
    reason: "An interrupted worker left target state uncertain.",
  });
  const mechanisms: LocalTargetSupervisorRecoveryMechanisms = {
    async refreshPixels() {
      throw new Error("unexpected pixel recovery");
    },
    async refreshSemantics() {
      return {
        readiness: readiness({ pixels: true, semantics: true }),
        reason: "fresh controls",
      };
    },
    async restartSemanticRunner() {
      throw new Error("unexpected escalation");
    },
    async preparePlatformServices() {
      throw new Error("unexpected escalation");
    },
  };

  await assert.rejects(
    recoverSupervisedTargetRuntime({ store, target, channel: "semantics", mechanisms }),
    /Quarantined target/u,
  );
  const recovery = await recoverSupervisedTargetRuntime({
    store,
    target,
    channel: "semantics",
    force: true,
    mechanisms,
  });

  assert.equal(recovery.ready, true);
  assert.notEqual(store.health(target).overall, "quarantined");
  assert.equal(store.health(target).counters.recoveryFailures, 0);
});

test("capability recovery never clears or retries an uncertain input mutation", async (t) => {
  const store = await fixture(t);
  store.transition(target, {
    kind: "input.intent-persisted",
    mutationId: "mutation-uncertain",
    intent: "Tap Save exactly once",
  });
  store.transition(target, { kind: "input.dispatched", mutationId: "mutation-uncertain" });
  store.transition(target, {
    kind: "input.outcome-unknown",
    mutationId: "mutation-uncertain",
    reason: "The transport acknowledgement was lost.",
  });
  let observations = 0;

  const recovery = await recoverSupervisedTargetRuntime({
    store,
    target,
    channel: "semantics",
    mechanisms: {
      async refreshPixels() {
        throw new Error("unexpected pixel recovery");
      },
      async refreshSemantics() {
        observations += 1;
        return {
          readiness: readiness({ pixels: true, semantics: true }),
          reason: "fresh controls",
        };
      },
      async restartSemanticRunner() {
        throw new Error("unexpected escalation");
      },
      async preparePlatformServices() {
        throw new Error("unexpected escalation");
      },
    },
  });

  assert.equal(observations, 1);
  assert.equal(recovery.ready, false);
  assert.equal(store.health(target).input.state, "uncertain");
  assert.equal(store.health(target).input.pendingMutationId, "mutation-uncertain");
  assert.equal(store.health(target).counters.uncertainMutations, 1);
  assert.equal(store.health(target).counters.reconciliations, 0);
});
