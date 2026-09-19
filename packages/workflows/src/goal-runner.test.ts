import assert from "node:assert/strict";
import test from "node:test";
import type {
  ArtifactRefProjection,
  GoalSessionAction,
  GoalSessionRecord,
  ModelDecisionRecord,
  OperationId,
  OperationInput,
  OperationOutput,
  TargetObservation,
} from "@relay/protocol";
import type { ModelDecisionProvider } from "@relay/core";
import { GOAL_SESSION_SCHEMA_VERSION } from "@relay/protocol";
import type { RelayOperationPort } from "./operation-port.js";
import { createGoalSessionRunner, type GoalSessionStore } from "./goal-runner.js";

const missingArtifact: ArtifactRefProjection = {
  status: "missing",
  source: "external",
  media: { kind: "image", mime: "image/png" },
};

function observation(step: number): TargetObservation {
  return {
    schemaVersion: 1,
    target: { kind: "browser", platform: "browser", targetId: "goal-goal-test" },
    capturedAt: step,
    pixels: { status: "unavailable", message: "test" },
    semantics: {
      status: "current",
      capturedAt: step,
      artifact: missingArtifact,
      source: "pixels-only",
      nodeCount: 1,
      controls: [
        {
          identifier: "next",
          label: "Next",
          role: "button",
          enabled: true,
          rect: { x: 1, y: 2, width: 10, height: 10 },
        },
      ],
    },
    screenCandidate: { fingerprint: `screen-${step}`, confidence: "observed" },
  };
}

function targetDefinition(id = "goal-goal-test") {
  return {
    id,
    name: "Goal test",
    kind: "browser" as const,
    createdAt: 1,
    updatedAt: 1,
    browser: { startUrl: "https://example.test", profileRetention: "ephemeral" as const },
  };
}

function choice(criteria: Record<string, string | null>, selected: string) {
  return {
    type: "choice" as const,
    choice: selected,
    probabilities: Object.fromEntries(
      Object.keys(criteria).map((key) => [key, key === selected ? 1 : 0]),
    ),
    confidence: 1,
  };
}

function providerFor(...decisions: Array<"continue" | "complete">): ModelDecisionProvider {
  let cursor = 0;
  return {
    id: "openrouter",
    async decide(request): Promise<ModelDecisionRecord> {
      const selected = decisions[cursor++] ?? "complete";
      const progress = request.questions.progress;
      const nextAction = request.questions.next_action;
      assert.equal(progress.type, "choice");
      assert.equal(nextAction.type, "choice");
      assert.equal(request.provider, "openrouter");
      const state = request.state as { redacted?: unknown };
      assert.equal(state.redacted, true);
      const stateRecord =
        request.state && typeof request.state === "object" && !Array.isArray(request.state)
          ? request.state
          : {};
      assert.equal("pixels" in stateRecord, false);
      return {
        schemaVersion: 1,
        status: "ok",
        provider: "openrouter",
        model: "~typesafe/jev-latest",
        requestId: `request-${cursor}`,
        observationDigest: request.observationDigest,
        questionDigest: "q",
        answers: {
          progress: choice(progress.criteria, selected),
          next_action: choice(
            nextAction.criteria,
            selected === "continue"
              ? Object.keys(nextAction.criteria).find((key) => key !== "none")!
              : "none",
          ),
        },
        startedAt: 1,
        completedAt: 2,
        durationMs: 1,
        evidenceRefs: request.evidenceRefs ?? [],
      };
    },
  };
}

function unavailableProvider(): ModelDecisionProvider {
  return {
    id: "openrouter",
    async decide(): Promise<ModelDecisionRecord> {
      return {
        schemaVersion: 1,
        status: "unavailable",
        provider: "openrouter",
        model: "~typesafe/jev-latest",
        requestId: "request-unavailable",
        startedAt: 1,
        completedAt: 2,
        durationMs: 1,
        evidenceRefs: [],
        error: { code: "provider-unavailable", message: "OpenRouter is not configured" },
      };
    },
  };
}

function memoryStore(
  initial: GoalSessionRecord[] = [],
): GoalSessionStore & { values: Map<string, GoalSessionRecord> } {
  const values = new Map(initial.map((record) => [record.id, structuredClone(record)]));
  return {
    values,
    async load(id) {
      const record = values.get(id);
      return record ? structuredClone(record) : null;
    },
    async save(record) {
      values.set(record.id, structuredClone(record));
    },
  };
}

function operations(options: { uncertain?: boolean; openTargetMismatch?: boolean } = {}): {
  port: RelayOperationPort;
  calls: OperationId[];
  openInputs: unknown[];
} {
  let captureCount = 0;
  const calls: OperationId[] = [];
  const openInputs: unknown[] = [];
  const port: RelayOperationPort = {
    async invoke<Id extends OperationId>(
      id: Id,
      _input: OperationInput<Id>,
    ): Promise<OperationOutput<Id>> {
      calls.push(id);
      if (id === "target.create") {
        const targetId = (_input as { id?: string }).id;
        return { target: targetDefinition(targetId) } as OperationOutput<Id>;
      }
      if (id === "target.list") {
        return { targets: [] } as OperationOutput<Id>;
      }
      if (id === "target.open") {
        // Generic `Id` erases the concrete input type; narrow to the registry's
        // validated target.open input instead of fabricating a shape.
        const input = _input as OperationInput<"target.open">;
        openInputs.push(input);
        const targetId = input.targetId;
        return {
          session: {
            targetId: options.openTargetMismatch ? "different-goal-target" : targetId,
            name: "Goal test",
            url: "https://example.test",
            signedOut: true,
            ...(input.authenticationFixtureReference
              ? {
                  sessionId: "runtime-ctx-1",
                  configurationDigest: "config-digest-1",
                  authenticationFixtureId: input.authenticationFixtureReference,
                }
              : {}),
          },
        } as OperationOutput<Id>;
      }
      if (id === "target.devices.list") {
        return {
          devices: [
            {
              id: "managed-browser",
              serial: "managed-browser",
              platform: "browser",
              state: "connected",
            },
          ],
        } as unknown as OperationOutput<Id>;
      }
      if (id === "target.observation.capture") {
        captureCount += 1;
        return observation(captureCount) as OperationOutput<Id>;
      }
      if (id === "target.interact") {
        if (options.uncertain) throw new Error("target interaction outcome-unknown");
        return { ok: true } as OperationOutput<Id>;
      }
      throw new Error(`Unexpected operation ${id}`);
    },
  };
  return { port, calls, openInputs };
}

test("goal runner persists redacted observation and intent before one safe action", async () => {
  const store = memoryStore();
  const runtime = operations();
  const runner = createGoalSessionRunner({
    operations: runtime.port,
    store,
    decisionProvider: providerFor("continue", "complete"),
    id: () => "goal-test",
    now: (() => {
      let value = 1;
      return () => value++;
    })(),
  });

  const result = await runner.start({
    goal: "Reach the next screen",
    startUrl: "https://example.test",
  });
  assert.equal(result.status, "completed");
  assert.equal(result.stopReason?.code, "goal-achieved");
  assert.deepEqual(runtime.calls, [
    "target.create",
    "target.open",
    "target.observation.capture",
    "target.interact",
    "target.observation.capture",
  ]);
  assert.equal(result.actions[0]?.status, "acknowledged");
  assert.deepEqual(result.findings, []);
  assert.equal(store.values.get("goal-test")?.pendingAction, undefined);
  assert.equal(store.values.get("goal-test")?.lastObservation?.redacted, true);
});

test("goal runner reports unavailable OpenRouter without mutating the target", async () => {
  const runtime = operations();
  const result = await createGoalSessionRunner({
    operations: runtime.port,
    store: memoryStore(),
    decisionProvider: unavailableProvider(),
    id: () => "goal-unavailable",
  }).start({ goal: "Do the thing", startUrl: "https://example.test" });
  assert.equal(result.status, "blocked");
  assert.equal(result.stopReason?.code, "provider-unavailable");
  assert.equal(result.findings[0]?.kind, "blocked-exploration");
  assert.equal(runtime.calls.includes("target.interact"), false);
});

test("goal runner fails closed when target.open returns a different target", async () => {
  const runtime = operations({ openTargetMismatch: true });
  await assert.rejects(
    createGoalSessionRunner({
      operations: runtime.port,
      store: memoryStore(),
      decisionProvider: providerFor("complete"),
      id: () => "goal-target-mismatch",
    }).start({ goal: "Do the thing", startUrl: "https://example.test" }),
    /opened target different-goal-target/u,
  );
  assert.deepEqual(runtime.calls, ["target.create", "target.open"]);
});

test("uncertain target interaction is terminal and is never automatically retried", async () => {
  const runtime = operations({ uncertain: true });
  const result = await createGoalSessionRunner({
    operations: runtime.port,
    store: memoryStore(),
    decisionProvider: providerFor("continue"),
    id: () => "goal-uncertain",
  }).start({ goal: "Do the thing", startUrl: "https://example.test" });
  assert.equal(result.status, "uncertain");
  assert.equal(result.stopReason?.code, "action-uncertain");
  assert.equal(runtime.calls.filter((id) => id === "target.interact").length, 1);
  assert.equal(result.actions[0]?.status, "unknown");
  assert.equal(result.findings[0]?.kind, "possible-issue");
});

test("resume fences a persisted in-flight mutation for human review", async () => {
  const record: GoalSessionRecord = {
    schemaVersion: GOAL_SESSION_SCHEMA_VERSION,
    id: "goal-pending",
    goal: "Review the target",
    target: { targetId: "ipad", platform: "ios" },
    budget: { maxSteps: 2, maxDurationMs: 10_000 },
    status: "running",
    step: 0,
    createdAt: 1,
    updatedAt: 1,
    observations: [],
    actions: [],
    pendingAction: {
      actionId: "action-1",
      candidateId: "c1",
      observationDigest: "digest",
      intendedAt: 2,
    },
  };
  const runtime = operations();
  const result = await createGoalSessionRunner({
    operations: runtime.port,
    store: memoryStore([record]),
  }).resume("goal-pending");
  assert.equal(result.status, "uncertain");
  assert.equal(result.resumeRequiresReview, true);
  assert.equal(result.stopReason?.code, "resume-review-required");
  assert.deepEqual(runtime.calls, []);
});

test("goal runner stops at the action budget after observing the result", async () => {
  const runtime = operations();
  const result = await createGoalSessionRunner({
    operations: runtime.port,
    store: memoryStore(),
    decisionProvider: providerFor("continue"),
    id: () => "goal-budget",
  }).start({ goal: "Do one step", startUrl: "https://example.test", maxSteps: 1 });
  assert.equal(result.status, "blocked");
  assert.equal(result.stopReason?.code, "budget-exhausted");
  assert.equal(result.actions.length, 1);
  assert.equal(result.observations.length, 2);
});

test("fresh reproduction replays acknowledged actions on an isolated browser target", async () => {
  const runtime = operations();
  const store = memoryStore();
  const runner = createGoalSessionRunner({
    operations: runtime.port,
    store,
    decisionProvider: providerFor("continue", "complete"),
    id: () => "goal-reproduce",
  });
  const original = await runner.start({
    goal: "Reach the next screen",
    startUrl: "https://example.test",
  });
  const reproduced = await runner.reproduce(original.sessionId);
  assert.equal(reproduced.reproduction?.status, "reproduced");
  assert.equal(reproduced.reproduction?.target.targetId, "goal-repro-goal-reproduce");
  assert.equal(reproduced.reproduction?.actions[0]?.status, "acknowledged");
  assert.equal(reproduced.reproduction?.findings?.[0]?.kind, "reproduction-lead");
  assert.equal(runtime.calls.filter((id) => id === "target.interact").length, 2);
  assert.equal(store.values.get(original.sessionId)?.reproduction?.pendingAction, undefined);
});

test("an existing managed browser target is opened with the requested fixture, not merely listed", async () => {
  const runtime = operations();
  const result = await createGoalSessionRunner({
    operations: runtime.port,
    store: memoryStore(),
    decisionProvider: providerFor("complete"),
    id: () => "goal-fixture",
  }).start({
    goal: "Open settings",
    targetId: "managed-browser",
    authenticationFixtureReference: "authfx:00000000-0000-0000-0000-000000000007:7",
  });
  assert.deepEqual(runtime.calls, [
    "target.devices.list",
    "target.open",
    "target.observation.capture",
  ]);
  assert.deepEqual(runtime.openInputs, [
    {
      targetId: "managed-browser",
      authenticationFixtureReference: "authfx:00000000-0000-0000-0000-000000000007:7",
      presentation: "embedded",
    },
  ]);
  assert.equal(result.target.runtimeSessionId, "runtime-ctx-1");
  assert.equal(result.target.configurationDigest, "config-digest-1");
  assert.equal(
    result.target.appliedAuthenticationFixtureId,
    "authfx:00000000-0000-0000-0000-000000000007:7",
  );
});

test("a decision bound to a different observation digest cannot authorize input", async () => {
  const staleProvider: ModelDecisionProvider = {
    id: "openrouter",
    async decide(request): Promise<ModelDecisionRecord> {
      return {
        schemaVersion: 1,
        status: "ok",
        provider: "openrouter",
        model: "~typesafe/jev-latest",
        requestId: "request-stale",
        observationDigest: "sha256:" + "a".repeat(64),
        questionDigest: "q",
        answers: {
          progress: {
            type: "choice",
            choice: "continue",
            probabilities: { continue: 1 },
            confidence: 1,
          },
          next_action: {
            type: "choice",
            choice: "c1",
            probabilities: { c1: 1 },
            confidence: 1,
          },
        },
        startedAt: 1,
        completedAt: 2,
        durationMs: 1,
        evidenceRefs: request.evidenceRefs ?? [],
      };
    },
  };
  const runtime = operations();
  const result = await createGoalSessionRunner({
    operations: runtime.port,
    store: memoryStore(),
    decisionProvider: staleProvider,
    id: () => "goal-stale",
  }).start({ goal: "Reach the next screen", startUrl: "https://example.test" });
  assert.equal(result.status, "blocked");
  assert.equal(result.stopReason?.code, "action-rejected");
  assert.equal(runtime.calls.includes("target.interact"), false);
});

test("a control with unknown enabled state is never an authorized tap candidate", async () => {
  const runtime = operations();
  const originalObservation = observation(1);
  // Drop the explicit enabled flag: the projection must mark it assumed and
  // the runner must refuse to tap it even when the model selects it.
  const port: RelayOperationPort = {
    async invoke<Id extends OperationId>(
      id: Id,
      _input: OperationInput<Id>,
    ): Promise<OperationOutput<Id>> {
      if (id === "target.observation.capture") {
        const obs = structuredClone(originalObservation);
        const control = obs.semantics.controls[0];
        if (control) delete control.enabled;
        return obs as unknown as OperationOutput<Id>;
      }
      return runtime.port.invoke(id, _input);
    },
  };
  const result = await createGoalSessionRunner({
    operations: port,
    store: memoryStore(),
    decisionProvider: providerFor("continue", "complete"),
    id: () => "goal-assumed",
  }).start({ goal: "Reach the next screen", startUrl: "https://example.test" });
  assert.equal(result.stopReason?.code, "no-action");
  assert.equal(result.lastObservation?.candidates[0]?.enabledAssumed, true);
});

test("a socket failure after submission stays unknown and fenced", async () => {
  const runtime = operations();
  const port: RelayOperationPort = {
    async invoke<Id extends OperationId>(
      id: Id,
      input: OperationInput<Id>,
    ): Promise<OperationOutput<Id>> {
      if (id === "target.interact") {
        throw new Error("Socket closed after request was submitted");
      }
      return runtime.port.invoke(id, input);
    },
  };
  const result = await createGoalSessionRunner({
    operations: port,
    store: memoryStore(),
    decisionProvider: providerFor("continue", "complete"),
    id: () => "goal-socket",
  }).start({ goal: "Reach the next screen", startUrl: "https://example.test" });
  assert.equal(result.status, "uncertain");
  assert.equal(result.stopReason?.code, "action-uncertain");
  assert.equal(result.actions[0]?.status, "unknown");
  assert.equal(result.resumeRequiresReview, true);
});

test("a provable pre-dispatch admission refusal is a rejection, not uncertainty", async () => {
  const runtime = operations();
  const refused = new Error("admission refused") as Error & { status: number };
  refused.status = 403;
  const port: RelayOperationPort = {
    async invoke<Id extends OperationId>(
      id: Id,
      input: OperationInput<Id>,
    ): Promise<OperationOutput<Id>> {
      if (id === "target.interact") throw refused;
      return runtime.port.invoke(id, input);
    },
  };
  const result = await createGoalSessionRunner({
    operations: port,
    store: memoryStore(),
    decisionProvider: providerFor("continue", "complete"),
    id: () => "goal-refused",
  }).start({ goal: "Reach the next screen", startUrl: "https://example.test" });
  assert.equal(result.status, "blocked");
  assert.equal(result.stopReason?.code, "action-rejected");
  assert.equal(result.actions[0]?.status, "rejected");
  assert.equal(result.resumeRequiresReview, undefined);
});

test("cancellation stops the session before dispatching the selected control", async () => {
  const controller = new AbortController();
  const runtime = operations();
  const port: RelayOperationPort = {
    async invoke<Id extends OperationId>(
      id: Id,
      input: OperationInput<Id>,
    ): Promise<OperationOutput<Id>> {
      if (id === "target.interact") {
        controller.abort();
      }
      return runtime.port.invoke(id, input);
    },
  };
  const result = await createGoalSessionRunner({
    operations: port,
    store: memoryStore(),
    decisionProvider: providerFor("continue", "complete"),
    signal: controller.signal,
    id: () => "goal-cancel",
  }).start({ goal: "Reach the next screen", startUrl: "https://example.test" });
  assert.equal(result.status, "cancelled");
  assert.equal(result.stopReason?.code, "cancelled");
  assert.equal(runtime.calls.includes("target.interact"), true);
  // The one dispatched interaction completed and was acknowledged; nothing
  // further runs after the cancel signal.
  assert.equal(result.actions.filter((action) => action.status === "acknowledged").length, 1);
});

test("a long inference cannot overshoot the budget into a late mutation", async () => {
  const runtime = operations();
  let time = 1;
  const steppingNow = () => {
    time += 400_000;
    return time;
  };
  const result = await createGoalSessionRunner({
    operations: runtime.port,
    store: memoryStore(),
    decisionProvider: providerFor("continue", "complete"),
    now: steppingNow,
    id: () => "goal-late",
  }).start({
    goal: "Reach the next screen",
    startUrl: "https://example.test",
    maxDurationMs: 900_000,
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.stopReason?.code, "budget-exhausted");
  assert.equal(runtime.calls.includes("target.interact"), false);
});

test("a restarted reproduction with an unresolved mutation fences instead of skipping it", async () => {
  const runtime = operations();
  const acknowledgedAction: GoalSessionAction = {
    id: "action-1",
    step: 1,
    candidateId: "c1",
    label: "Next",
    interaction: { kind: "identifier", target: { identifier: "next" } },
    status: "acknowledged",
    observationDigestBefore: "sha256:" + "1".repeat(64),
    evidenceRefs: [],
    at: 1,
  };
  const seeded: GoalSessionRecord = {
    schemaVersion: GOAL_SESSION_SCHEMA_VERSION,
    id: "goal-repro-fence",
    goal: "Reach the next screen",
    target: {
      targetId: "goal-goal-repro-fence",
      platform: "browser",
      startUrl: "https://example.test",
    },
    budget: { maxSteps: 10, maxDurationMs: 900_000 },
    status: "completed",
    step: 1,
    createdAt: 1,
    updatedAt: 2,
    observations: [],
    actions: [acknowledgedAction],
    findings: [],
    reproduction: {
      id: "repro-goal-repro-fence",
      sourceSessionId: "goal-repro-fence",
      target: {
        targetId: "goal-repro-goal-repro-fence",
        platform: "browser",
        startUrl: "https://example.test",
      },
      status: "running",
      startedAt: 3,
      updatedAt: 4,
      actions: [{ ...acknowledgedAction, id: "repro-action-1", status: "intended" }],
      observations: [],
      pendingAction: {
        actionId: "repro-action-1",
        candidateId: "c1",
        observationDigest: "sha256:" + "2".repeat(64),
        intendedAt: 5,
      },
    },
  };
  const result = await createGoalSessionRunner({
    operations: runtime.port,
    store: memoryStore([seeded]),
    id: () => "goal-repro-fence",
  }).reproduce("goal-repro-fence");
  assert.equal(result.reproduction?.status, "uncertain");
  assert.equal(result.reproduction?.pendingAction?.actionId, "repro-action-1");
  assert.equal(runtime.calls.includes("target.interact"), false);
});
