import assert from "node:assert/strict";
import test from "node:test";
import { TargetSupervisorStore } from "./target-supervisor-store.js";

const target = { id: "ipad-1", kind: "ios" } as const;

function exhaustRecovery(store: TargetSupervisorStore): void {
  store.transition(target, { kind: "recovery.requested", channel: "semantics" });
  for (const stage of [
    "refresh-semantics",
    "restart-semantic-runner",
    "prepare-platform-services",
  ] as const) {
    store.transition(target, {
      kind: "recovery.step-completed",
      channel: "semantics",
      stage,
      outcome: "failed",
      reason: "The accessibility tree did not return.",
      durationMs: 5,
    });
  }
}

test("fresh pixels clear a stale human hold left by recovery exhaustion", () => {
  const store = new TargetSupervisorStore(":memory:");
  exhaustRecovery(store);
  assert.equal(store.health(target).overall === "needs-human", true);

  store.transition(target, { kind: "pixels.captured", durationMs: 40 });

  const health = store.health(target);
  assert.equal(health.overall === "needs-human", false);
  assert.equal(health.pixels.state, "ready");
  assert.equal(health.input.state, "ready");
  // Input works again: a launch or tap is no longer refused at the door.
  assert.doesNotThrow(() =>
    store.transition(target, {
      kind: "input.intent-persisted",
      mutationId: "ios-input-1",
      intent: "Physical iOS app-open",
    }),
  );
});

test("fresh usable semantics also clear the stale human hold", () => {
  const store = new TargetSupervisorStore(":memory:");
  exhaustRecovery(store);
  const started = store.transition(target, { kind: "semantics.traversal-started" });
  store.transition(target, {
    kind: "semantics.traversal-completed",
    token: started.traversalToken!,
    usable: true,
    freshness: "current",
    durationMs: 20,
  });
  assert.equal(store.health(target).overall === "needs-human", false);
  assert.equal(store.health(target).semantics.state, "current");
});

test("an uncertain in-flight mutation keeps the human hold until it is reconciled", () => {
  const store = new TargetSupervisorStore(":memory:");
  store.transition(target, {
    kind: "input.intent-persisted",
    mutationId: "ios-input-2",
    intent: "Physical iOS press",
  });
  store.transition(target, { kind: "input.dispatched", mutationId: "ios-input-2" });
  store.transition(target, {
    kind: "input.outcome-unknown",
    mutationId: "ios-input-2",
    reason: "The acknowledgement was lost.",
  });
  exhaustRecovery(store);

  store.transition(target, { kind: "pixels.captured", durationMs: 10 });

  assert.equal(store.health(target).overall === "needs-human", true);
  assert.throws(
    () =>
      store.transition(target, {
        kind: "input.intent-persisted",
        mutationId: "ios-input-3",
        intent: "Physical iOS app-open",
      }),
    /pending human review|pending or uncertain/u,
  );
});

test("quarantine is deliberate and survives fresh proof", () => {
  const store = new TargetSupervisorStore(":memory:");
  store.transition(target, {
    kind: "operator.quarantined",
    reason: "Repeated bounded recovery failures quarantined the target.",
  });
  store.transition(target, { kind: "pixels.captured", durationMs: 10 });
  assert.equal(store.health(target).overall, "quarantined");
});
