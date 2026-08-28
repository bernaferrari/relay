import assert from "node:assert/strict";
import test from "node:test";
import type {
  AuthorTestIntent,
  AuthorTestSnapshot,
  DurableAuthorTestDecision,
  RelayWorkflows,
} from "@relay/workflows";
import {
  canRetireUnprovenRecording,
  createAuthorTestWorkflowCoordinator,
} from "./author-test-workflow-coordinator";

const workflowId = "author-workflow";
const intent: AuthorTestIntent = {
  kind: "author-test",
  actorId: "human:local",
  title: "Settings",
  appMapId: "map",
  target: { kind: "device", platform: "ios", targetId: "ipad" },
  leaseId: "lease",
  revision: { exact: 4 },
};

function snapshot(
  stage: AuthorTestSnapshot["stage"],
  version: number,
  actions: AuthorTestSnapshot["allowedNextActions"],
): AuthorTestSnapshot {
  return {
    schemaVersion: 1,
    kind: "author-test",
    title: "Settings",
    phase: stage === "recording" ? "running" : "paused",
    stage,
    version: `workflow-v${version}`,
    workflow: { workflowId, expectedVersion: version },
    authoring: { sessionId: "session" },
    frozen: {
      title: "Settings",
      actorId: "human:local",
      appMapId: "map",
      appMapRevision: 4,
      target: { kind: "device", platform: "ios", targetId: "ipad" },
      workflowRequestId: "request-1",
    },
    progress: { label: stage },
    allowedNextActions: actions,
    problems: [],
    evidenceRefs: [],
  };
}

test("authoring lifecycle decisions inspect the durable handle and mutate exactly once", async () => {
  const decisions: DurableAuthorTestDecision[] = [];
  const inspected: string[] = [];
  const published: AuthorTestSnapshot[] = [];
  const workflows = {
    start: async () => snapshot("recording", 1, ["inspect", "checkpoint", "stop"]),
    inspectAuthoring: async (candidate: string) => {
      inspected.push(candidate);
      return snapshot("recording", 2, ["inspect", "checkpoint", "stop"]);
    },
    advanceAuthoring: async (decision: DurableAuthorTestDecision) => {
      decisions.push(decision);
      return snapshot("recording", 3, ["inspect", "checkpoint", "stop"]);
    },
  } as unknown as RelayWorkflows;
  const coordinator = createAuthorTestWorkflowCoordinator({
    workflows,
    onSnapshot: (value) => {
      published.push(value);
    },
  });

  await coordinator.start(intent);
  await coordinator.advance("session", { action: "checkpoint", label: "Ready" });

  assert.deepEqual(inspected, [workflowId]);
  assert.equal(decisions.length, 1);
  assert.deepEqual(decisions[0], {
    action: "checkpoint",
    label: "Ready",
    workflowId,
    expectedVersion: 2,
  });
  assert.equal(published.at(-1)?.version, "workflow-v3");
});

test("an unproved inspection never triggers or retries a lifecycle mutation", async () => {
  let advances = 0;
  const unknown: AuthorTestSnapshot = {
    ...snapshot("unknown", 2, ["inspect"]),
    phase: "needs-attention",
    version: "unavailable",
    problems: [
      {
        code: "malformed-response",
        title: "Cannot inspect",
        detail: "Connection was lost",
        recovery: "Inspect again explicitly.",
        retryable: true,
      },
    ],
  };
  const workflows = {
    start: async () => snapshot("recording", 1, ["inspect", "stop"]),
    inspectAuthoring: async () => unknown,
    advanceAuthoring: async () => {
      advances += 1;
      return unknown;
    },
  } as unknown as RelayWorkflows;
  const coordinator = createAuthorTestWorkflowCoordinator({
    workflows,
    onSnapshot: () => undefined,
  });
  await coordinator.start({
    ...intent,
    target: { kind: "device", platform: "android", targetId: "pixel" },
  });

  const result = await coordinator.advance("session", { action: "stop" });
  assert.equal(result, unknown);
  assert.equal(advances, 0);
});

test("a durable handle survives a renderer reload without persisting recording truth", async () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  let inspections = 0;
  const workflows = {
    start: async () => snapshot("recording", 1, ["inspect", "stop"]),
    inspectAuthoring: async () => {
      inspections += 1;
      return snapshot("recording", 2, ["inspect", "stop"]);
    },
    advanceAuthoring: async () => snapshot("reviewing", 3, ["inspect", "replay"]),
  } as unknown as RelayWorkflows;
  const first = createAuthorTestWorkflowCoordinator({
    workflows,
    storage,
    onSnapshot: () => undefined,
  });
  await first.start(intent);

  const reloaded = createAuthorTestWorkflowCoordinator({
    workflows,
    storage,
    onSnapshot: () => undefined,
  });
  assert.equal((await reloaded.inspect("session"))?.version, "workflow-v2");
  assert.equal(inspections, 1);
  assert.equal(
    [...values.values()].every(
      (value) => value === JSON.stringify({ workflowId, expectedVersion: 2 }),
    ),
    true,
  );
});

test("concurrent decisions serialize against the latest canonical session version", async () => {
  const expectedVersions: number[] = [];
  let version = 1;
  const workflows = {
    start: async () => snapshot("recording", 1, ["inspect", "checkpoint", "stop"]),
    inspectAuthoring: async () => snapshot("recording", version, ["inspect", "checkpoint", "stop"]),
    advanceAuthoring: async (decision: DurableAuthorTestDecision) => {
      expectedVersions.push(decision.expectedVersion);
      version += 1;
      return snapshot("recording", version, ["inspect", "checkpoint", "stop"]);
    },
  } as unknown as RelayWorkflows;
  const coordinator = createAuthorTestWorkflowCoordinator({
    workflows,
    onSnapshot: () => undefined,
  });
  await coordinator.start(intent);

  await Promise.all([
    coordinator.proved("session", { action: "checkpoint", label: "One" }),
    coordinator.proved("session", { action: "checkpoint", label: "Two" }),
  ]);

  assert.deepEqual(expectedVersions, [1, 2]);
});

test("a stale workflow problem is never reported as a proved mutation", async () => {
  const stale: AuthorTestSnapshot = {
    ...snapshot("recording", 2, ["inspect", "checkpoint"]),
    problems: [
      {
        code: "stale-workflow-version",
        title: "Recording changed",
        detail: "Use the latest version",
        recovery: "Inspect again.",
        retryable: true,
      },
    ],
  };
  const workflows = {
    start: async () => snapshot("recording", 1, ["inspect", "checkpoint"]),
    inspectAuthoring: async () => snapshot("recording", 1, ["inspect", "checkpoint"]),
    advanceAuthoring: async () => stale,
  } as unknown as RelayWorkflows;
  const coordinator = createAuthorTestWorkflowCoordinator({
    workflows,
    onSnapshot: () => undefined,
  });
  await coordinator.start(intent);

  await assert.rejects(
    coordinator.proved("session", { action: "checkpoint" }),
    /Use the latest version/,
  );
});

test("a failed replay remains editable and can be replayed again explicitly", async () => {
  const failedReplay: AuthorTestSnapshot = {
    ...snapshot("reviewing", 2, ["inspect", "edit", "replay", "discard"]),
    problems: [
      {
        code: "operation-unavailable",
        title: "Replay did not prove the recording",
        detail: "The destination did not match",
        recovery: "Edit and replay again.",
        retryable: true,
      },
    ],
  };
  let canonical = failedReplay;
  const decisions: DurableAuthorTestDecision[] = [];
  const workflows = {
    start: async () => failedReplay,
    inspectAuthoring: async () => canonical,
    advanceAuthoring: async (decision: DurableAuthorTestDecision) => {
      decisions.push(decision);
      canonical =
        decision.action === "edit"
          ? {
              ...failedReplay,
              version: "workflow-v3",
              workflow: { workflowId, expectedVersion: 3 },
            }
          : snapshot("reviewing", 4, ["inspect", "approve", "replay", "discard"]);
      return canonical;
    },
  } as unknown as RelayWorkflows;
  const coordinator = createAuthorTestWorkflowCoordinator({
    workflows,
    onSnapshot: () => undefined,
  });
  await coordinator.start(intent);

  await coordinator.proved("session", {
    action: "edit",
    edit: { kind: "remove", actionIds: ["noise"] },
  });
  const replayed = await coordinator.advance("session", { action: "replay" });

  assert.equal(replayed?.version, "workflow-v4");
  assert.deepEqual(
    decisions.map((decision) => decision.action),
    ["edit", "replay"],
  );
});

test("an uncertain begin remains blocked after remount until explicit inspection", async () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  const uncertain: AuthorTestSnapshot = {
    ...snapshot("unknown", 1, ["inspect"]),
    phase: "needs-attention",
    authoring: undefined,
    version: "unavailable",
    problems: [
      {
        code: "mutation-outcome-unknown",
        title: "Begin outcome is unknown",
        detail: "The response was lost",
        recovery: "Inspect canonical state.",
        retryable: false,
      },
    ],
  };
  const workflows = {
    start: async () => uncertain,
    recover: async () => snapshot("recording", 2, ["inspect", "checkpoint", "stop"]),
    inspectAuthoring: async () => snapshot("recording", 2, ["inspect", "checkpoint", "stop"]),
  } as unknown as RelayWorkflows;
  const first = createAuthorTestWorkflowCoordinator({
    workflows,
    storage,
    onSnapshot: () => undefined,
  });
  await first.start(intent);

  const reloaded = createAuthorTestWorkflowCoordinator({
    workflows,
    storage,
    onSnapshot: () => undefined,
  });
  const hydrated = await reloaded.hydrate("session");
  assert.equal(hydrated?.phase, "needs-attention");
  assert.equal(hydrated?.allowedNextActions.at(-1), "inspect");

  const inspected = await reloaded.inspect("session");
  assert.equal(inspected?.phase, "running");
  assert.equal(
    [...values.values()].every(
      (value) => value === JSON.stringify({ workflowId, expectedVersion: 2 }),
    ),
    true,
  );
});

test("only a no-session durable snapshot that explicitly allows abandon can be retired", async () => {
  const unproven: AuthorTestSnapshot = {
    ...snapshot("unknown", 2, ["inspect", "abandon"]),
    phase: "needs-attention",
    authoring: undefined,
    problems: [
      {
        code: "mutation-outcome-unknown",
        title: "Recording start is unproven",
        detail: "Relay could not prove that recording began",
        recovery: "Retire this attempt before starting another.",
        retryable: false,
      },
    ],
  };
  const retired: AuthorTestSnapshot = {
    ...unproven,
    phase: "cancelled",
    stage: "cancelled",
    version: "workflow-v3",
    workflow: { workflowId, expectedVersion: 3 },
    allowedNextActions: ["inspect"],
    problems: [],
  };
  const decisions: DurableAuthorTestDecision[] = [];
  const workflows = {
    inspectAuthoring: async () => unproven,
    advanceAuthoring: async (decision: DurableAuthorTestDecision) => {
      decisions.push(decision);
      return retired;
    },
  } as unknown as RelayWorkflows;
  const coordinator = createAuthorTestWorkflowCoordinator({
    workflows,
    onSnapshot: () => undefined,
  });

  assert.equal((await coordinator.inspectDurable(unproven)).version, "workflow-v2");
  assert.equal(canRetireUnprovenRecording(unproven), true);
  assert.equal(
    canRetireUnprovenRecording({ ...unproven, authoring: { sessionId: "healthy" } }),
    false,
  );
  assert.equal(canRetireUnprovenRecording({ ...unproven, allowedNextActions: ["inspect"] }), false);

  const result = await coordinator.retireUnprovenRecording(unproven, {
    action: "abandon",
    reason: "Owner retired an unproven start",
  });

  assert.equal(result.stage, "cancelled");
  assert.deepEqual(decisions, [
    {
      action: "abandon",
      reason: "Owner retired an unproven start",
      workflowId,
      expectedVersion: 2,
    },
  ]);
});

test("retirement fails closed when inspection finds a canonical recording session", async () => {
  const unproven: AuthorTestSnapshot = {
    ...snapshot("unknown", 2, ["inspect", "abandon"]),
    phase: "needs-attention",
    authoring: undefined,
  };
  let advances = 0;
  const workflows = {
    inspectAuthoring: async () => snapshot("recording", 3, ["inspect", "checkpoint", "stop"]),
    advanceAuthoring: async () => {
      advances += 1;
      return snapshot("recording", 4, ["inspect", "checkpoint", "stop"]);
    },
  } as unknown as RelayWorkflows;
  const coordinator = createAuthorTestWorkflowCoordinator({
    workflows,
    onSnapshot: () => undefined,
  });

  await assert.rejects(
    coordinator.retireUnprovenRecording(unproven, {
      action: "abandon",
      reason: "Stale client request",
    }),
    /can still be inspected or continued safely/,
  );
  assert.equal(advances, 0);
});
