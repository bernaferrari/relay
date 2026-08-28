import assert from "node:assert/strict";
import test from "node:test";
import { TargetSupervisor, type TargetSupervisorClock } from "./target-supervisor.js";

class FakeClock implements TargetSupervisorClock {
  constructor(private value = 1_000) {}
  now(): number {
    return this.value;
  }
  advance(ms: number): void {
    this.value += ms;
  }
}

function started(options: { quarantineAfterFailures?: number } = {}) {
  const clock = new FakeClock();
  const supervisor = TargetSupervisor.start({ id: "ipad-1", kind: "ios" }, { clock, ...options });
  return { clock, supervisor };
}

function ready(supervisor: TargetSupervisor): void {
  supervisor.transition({ kind: "pixels.captured", durationMs: 8 });
  const traversal = supervisor.transition({ kind: "semantics.traversal-started" });
  supervisor.transition({
    kind: "semantics.traversal-completed",
    token: traversal.traversalToken!,
    usable: true,
    durationMs: 12,
  });
}

function unknownMutation(supervisor: TargetSupervisor, id = "tap-1") {
  supervisor.transition({ kind: "input.intent-persisted", mutationId: id, intent: "Tap Settings" });
  supervisor.transition({ kind: "input.dispatched", mutationId: id });
  return supervisor.transition({
    kind: "input.outcome-unknown",
    mutationId: id,
    reason: "The native acknowledgement was lost.",
  });
}

test("pixels remain independently useful when semantics are unavailable", () => {
  const { supervisor } = started();
  assert.equal(supervisor.health().overall, "starting");

  supervisor.transition({ kind: "pixels.captured", durationMs: 9 });
  const health = supervisor.health();
  assert.equal(health.overall, "pixel-only");
  assert.equal(health.pixels.state, "ready");
  assert.equal(health.semantics.state, "unavailable");
  assert.equal(health.readiness.previewPixels.state, "proven");
  assert.equal(health.readiness.evidenceCapture.mode, "evidence");
  assert.equal(health.readiness.semanticControl.state, "unavailable");
});

test("one semantic traversal token prevents overlap through timeout and wedge", () => {
  const { clock, supervisor } = started();
  supervisor.transition({ kind: "pixels.captured" });
  const begun = supervisor.transition({ kind: "semantics.traversal-started" });
  clock.advance(250);
  supervisor.transition({
    kind: "semantics.traversal-timed-out",
    token: begun.traversalToken!,
  });
  assert.equal(supervisor.health().semantics.state, "refreshing");
  assert.throws(
    () => supervisor.transition({ kind: "semantics.traversal-started" }),
    /one semantic traversal in flight/u,
  );

  supervisor.transition({
    kind: "semantics.traversal-wedged",
    token: begun.traversalToken!,
    reason: "XCTest did not settle.",
  });
  const health = supervisor.health();
  assert.equal(health.semantics.state, "wedged");
  assert.equal(health.overall, "pixel-only");
  assert.equal(health.counters.semanticTimeouts, 1);
  assert.equal(health.counters.semanticWedges, 1);
  assert.equal(health.semantics.traversal?.token, begun.traversalToken);
});

test("a semantic completion begun before confirmed input remains stale", () => {
  const { supervisor } = started();
  ready(supervisor);
  const traversal = supervisor.transition({ kind: "semantics.traversal-started" });
  supervisor.transition({
    kind: "input.intent-persisted",
    mutationId: "tap-2",
    intent: "Tap Data Controls",
  });
  supervisor.transition({ kind: "input.dispatched", mutationId: "tap-2" });
  supervisor.transition({ kind: "input.completed", mutationId: "tap-2" });
  supervisor.transition({
    kind: "semantics.traversal-completed",
    token: traversal.traversalToken!,
    usable: true,
  });

  const health = supervisor.health();
  assert.equal(health.semantics.state, "stale");
  assert.equal(health.readiness.semanticControl.freshness, "stale");
  assert.equal(health.events[0]?.code, "SEMANTIC_TRAVERSAL_STALE");
});

test("unknown input emits observation only, blocks another input, and reconciles without retry", () => {
  const { supervisor } = started();
  ready(supervisor);
  const unknown = unknownMutation(supervisor);

  assert.deepEqual(unknown.effects, [
    { kind: "capture-reconcile-observation", mutationId: "tap-1" },
  ]);
  assert.equal(unknown.health.input.state, "uncertain");
  assert.equal(unknown.health.overall, "recovering");
  assert.throws(
    () =>
      supervisor.transition({
        kind: "input.intent-persisted",
        mutationId: "tap-duplicate",
        intent: "Retry tap",
      }),
    /pending or uncertain mutation/u,
  );
  assert.throws(
    () => supervisor.transition({ kind: "input.completed", mutationId: "tap-1" }),
    /only complete through reconciliation/u,
  );

  const recovery = supervisor.transition({ kind: "recovery.requested", channel: "input" });
  assert.deepEqual(recovery.effects, [
    { kind: "capture-reconcile-observation", mutationId: "tap-1" },
  ]);
  const reconciled = supervisor.transition({
    kind: "input.reconciled",
    mutationId: "tap-1",
    observationId: "sha256:observation",
    outcome: "not-applied",
  });
  assert.equal(reconciled.health.input.state, "ready");
  assert.equal(reconciled.health.overall, "ready");
  assert.equal(reconciled.health.counters.uncertainMutations, 1);
  assert.equal(reconciled.health.counters.reconciliations, 1);
  assert.equal(reconciled.effects.length, 0);
});

test("control ownership is projected without hiding pixel observation", () => {
  const { supervisor } = started();
  supervisor.transition({ kind: "pixels.captured" });
  const health = supervisor.transition({
    kind: "control.updated",
    control: { state: "held-by-other", ownerId: "agent:other", expiresAt: 9_000 },
  }).health;
  assert.equal(health.pixels.state, "ready");
  assert.equal(health.overall, "pixel-only");
  assert.equal(health.input.state, "blocked");
  assert.equal(health.control.ownerId, "agent:other");
  assert.throws(
    () =>
      supervisor.transition({
        kind: "input.intent-persisted",
        mutationId: "tap-blocked",
        intent: "Tap",
      }),
    /Another actor/u,
  );
});

test("ambiguous reconciliation requires a person and retains the mutation fence", () => {
  const { supervisor } = started();
  supervisor.transition({ kind: "pixels.captured" });
  unknownMutation(supervisor);
  const result = supervisor.transition({
    kind: "input.reconciled",
    mutationId: "tap-1",
    observationId: "sha256:ambiguous",
    outcome: "ambiguous",
  });
  assert.equal(result.health.input.state, "uncertain");
  assert.equal(result.health.overall, "needs-human");
  assert.equal(result.health.input.pendingMutationId, "tap-1");
});

test("restart rehydrates context and uncertainty but never manufactures liveness", () => {
  const { clock, supervisor } = started();
  ready(supervisor);
  supervisor.transition({
    kind: "context.updated",
    context: {
      foregroundApp: "com.example.app",
      screenFingerprint: "screen-a",
      runCursor: { runId: "run-1", stepId: "step-2", index: 2 },
    },
  });
  unknownMutation(supervisor);
  const before = supervisor.checkpoint();
  clock.advance(1_000);

  const restarted = TargetSupervisor.rehydrate(before, { clock });
  const health = restarted.health();
  assert.equal(health.epochs.target, 2);
  assert.equal(health.pixels.state, "delayed");
  assert.equal(health.semantics.state, "stale");
  assert.equal(health.input.state, "uncertain");
  assert.equal(health.overall, "recovering");
  assert.equal(health.context.runCursor?.stepId, "step-2");
  assert.equal(health.readiness.previewPixels.state, "unproven");
  assert.equal(health.events[0]?.code, "TARGET_SUPERVISOR_REHYDRATED");
});

test("completion from a pre-restart traversal is ignored by target epoch", () => {
  const { clock, supervisor } = started();
  supervisor.transition({ kind: "pixels.captured" });
  const begun = supervisor.transition({ kind: "semantics.traversal-started" });
  const restarted = TargetSupervisor.rehydrate(supervisor.checkpoint(), { clock });

  const result = restarted.transition({
    kind: "semantics.traversal-completed",
    token: begun.traversalToken!,
    usable: true,
  });
  assert.equal(result.health.semantics.state, "unavailable");
  assert.equal(result.health.events[0]?.code, "STALE_COMPLETION_IGNORED");
});

test("semantic recovery escalates within budget and runner restart rotates session epoch", () => {
  const { supervisor } = started();
  supervisor.transition({ kind: "pixels.captured" });
  const begun = supervisor.transition({ kind: "semantics.traversal-started" });
  supervisor.transition({
    kind: "semantics.traversal-wedged",
    token: begun.traversalToken!,
    reason: "Runner wedged",
  });
  const requested = supervisor.transition({ kind: "recovery.requested", channel: "semantics" });
  assert.deepEqual(requested.effects, [
    { kind: "recover", channel: "semantics", stage: "refresh-semantics", attempt: 1 },
  ]);
  const escalated = supervisor.transition({
    kind: "recovery.step-completed",
    channel: "semantics",
    stage: "refresh-semantics",
    outcome: "failed",
    reason: "Refresh failed",
  });
  assert.deepEqual(escalated.effects, [
    {
      kind: "recover",
      channel: "semantics",
      stage: "restart-semantic-runner",
      attempt: 1,
    },
  ]);
  const restarted = supervisor.transition({
    kind: "recovery.step-completed",
    channel: "semantics",
    stage: "restart-semantic-runner",
    outcome: "succeeded",
  });
  assert.equal(restarted.health.epochs.semanticSession, 2);
  assert.equal(restarted.health.semantics.state, "refreshing");
  assert.equal(restarted.health.semantics.traversal, undefined);
  assert.equal(restarted.health.overall, "pixel-only");
});

test("recovery budget exhaustion stops for a human or quarantines at policy threshold", () => {
  const { supervisor } = started({ quarantineAfterFailures: 3 });
  supervisor.transition({ kind: "recovery.requested", channel: "semantics" });
  for (const stage of [
    "refresh-semantics",
    "restart-semantic-runner",
    "prepare-platform-services",
  ] as const) {
    supervisor.transition({
      kind: "recovery.step-completed",
      channel: "semantics",
      stage,
      outcome: "failed",
      reason: `${stage} failed`,
    });
  }
  const health = supervisor.health();
  assert.equal(health.overall, "quarantined");
  assert.equal(health.counters.recoveryAttempts, 3);
  assert.equal(health.counters.recoveryFailures, 3);
  assert.equal(health.events[0]?.code, "TARGET_QUARANTINED");
  assert.throws(
    () => supervisor.transition({ kind: "recovery.requested", channel: "semantics" }),
    /Quarantined target/u,
  );
});

test("ordinary recovery exhaustion stops at needs-human before quarantine threshold", () => {
  const { supervisor } = started();
  supervisor.transition({ kind: "recovery.requested", channel: "pixels" });
  supervisor.transition({
    kind: "recovery.step-completed",
    channel: "pixels",
    stage: "refresh-pixels",
    outcome: "failed",
  });
  const exhausted = supervisor.transition({
    kind: "recovery.step-completed",
    channel: "pixels",
    stage: "prepare-platform-services",
    outcome: "failed",
  });
  assert.equal(exhausted.health.overall, "needs-human");
  assert.equal(exhausted.health.events[0]?.code, "TARGET_NEEDS_HUMAN");
});

test("a recovery interrupted by restart stops for an explicit human decision", () => {
  const { clock, supervisor } = started();
  supervisor.transition({ kind: "pixels.unavailable", reason: "Transport stopped" });
  supervisor.transition({ kind: "recovery.requested", channel: "pixels" });
  const restarted = TargetSupervisor.rehydrate(supervisor.checkpoint(), { clock });
  const health = restarted.health();
  assert.equal(health.recovery, undefined);
  assert.equal(health.overall, "needs-human");
  assert.match(health.input.reason ?? "", /Recovery crossed restart/u);
});
