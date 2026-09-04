import assert from "node:assert/strict";
import test from "node:test";
import type { DiscoverySession } from "@relay/protocol";
import type {
  AuthorTestSnapshot,
  FailureInspection,
  RecordTestOutcomeIntent,
  RelayInvokeClient,
  RunTestSnapshot,
} from "@relay/workflows";
import {
  createAgentDebugProductService,
  planAgentDebug,
  type AgentDebugDiscoverySummary,
} from "./agent-debug.js";

const recordIntent = {
  kind: "record-test",
  title: "Checkout",
  appMapId: "map-1",
  targetId: "device-1",
  confirmControl: true,
} as const;

const discoveryInput = {
  id: "discovery-1",
  name: "Checkout discovery",
  targetId: "device-1",
  appMapId: "map-1",
  scope: { maxScreens: 20, maxTransitions: 40, maxDurationMs: 30_000 },
} as const;

test("Agent Debug plans only supported operations and explicit human gates", () => {
  const plan = planAgentDebug({
    actorId: "agent:test",
    record: recordIntent,
    discovery: {
      create: discoveryInput,
      start: { sessionId: "discovery-1", strategy: "surface", maxDepth: 2 },
    },
    run: { kind: "run-test", testId: "test-1", appMapId: "map-1", targetId: "device-1" },
    failure: { kind: "inspect-failure", runId: "run-1" },
    repair: {
      kind: "propose-repair",
      runId: "run-1",
      checkId: "check-1",
      proposal: "accept-current",
      reason: "Reviewed selector drift",
    },
  });

  assert.deepEqual(
    plan.steps.map((step) => step.kind),
    [
      "record",
      "create-discovery",
      "start-discovery",
      "review-test",
      "run",
      "inspect-failure",
      "propose-repair",
    ],
  );
  assert.equal(plan.steps[0]?.supported, true);
  assert.equal(plan.steps[3]?.supported, false);
  assert.equal(plan.steps[6]?.kind, "propose-repair");
  assert.equal(plan.steps[6]?.kind === "propose-repair" && plan.steps[6].requiresHumanReview, true);
  assert.equal(plan.attribution.actorId, "agent:test");
  assert.equal(plan.gaps.length, 4);
});

test("Agent Debug fails closed without explicit control consent", () => {
  assert.throws(
    () =>
      planAgentDebug({
        actorId: "agent:test",
        record: {
          ...recordIntent,
          confirmControl: undefined,
        } as unknown as RecordTestOutcomeIntent,
      }),
    /confirmControl:true/,
  );
  assert.throws(
    () =>
      planAgentDebug({
        actorId: "agent:test",
        record: recordIntent,
        discovery: {
          create: {
            ...discoveryInput,
            scope: { maxScreens: 0, maxTransitions: 1, maxDurationMs: 1 },
          },
        },
      }),
    /maxScreens/,
  );
});

function discoverySession(): DiscoverySession {
  return {
    id: "discovery-1",
    name: "Checkout discovery",
    targetId: "device-1",
    scope: { maxScreens: 20, maxTransitions: 40, maxDurationMs: 30_000 },
    status: "complete",
    createdAt: 1,
    updatedAt: 2,
    screens: [],
    transitions: [],
    explore: {
      strategy: "surface",
      maxDepth: 2,
      stopReason: { code: "complete", message: "done", at: 2 },
      startedAt: 1,
      updatedAt: 2,
    },
  };
}

test("Agent Debug service delegates discovery and outcome stages", async () => {
  const calls: string[] = [];
  const session = discoverySession();
  const client: RelayInvokeClient = {
    async invoke(id) {
      calls.push(id);
      if (id === "discovery.coverage") {
        return {
          coverage: {
            mapName: "Checkout",
            generatedAt: 2,
            sessionIds: ["discovery-1"],
            profiles: [],
            unprofiledSessionIds: ["discovery-1"],
            screens: [],
            transitions: [],
          },
        };
      }
      return { session };
    },
  };
  const record = { kind: "author-test", phase: "queued" } as unknown as AuthorTestSnapshot;
  const run = { kind: "run-test", phase: "queued" } as unknown as RunTestSnapshot;
  const failure = {
    runId: "run-1",
    run: {},
    evidence: {},
    repairProposals: [],
  } as unknown as FailureInspection;
  const service = createAgentDebugProductService(client, {
    actorId: "agent:test",
    jobs: {
      record: async () => record,
      run: async () => run,
      inspectFailure: async () => failure,
      proposeRepair: async () => ({
        proposalId: "proposal-1",
        repairTargetId: "target-1",
        runId: "run-1",
        checkId: "check-1",
        proposal: "disable",
        reviewRequired: true,
      }),
      verifyChange: async () => ({}) as never,
      exportEvidence: async () => ({}) as never,
      debugBug: async () => ({}) as never,
    },
  });

  const projected = await service.createDiscovery(discoveryInput);
  assert.deepEqual(projected, {
    id: "discovery-1",
    name: "Checkout discovery",
    targetId: "device-1",
    status: "complete",
    createdAt: 1,
    updatedAt: 2,
    scope: { maxScreens: 20, maxTransitions: 40, maxDurationMs: 30_000 },
    screenCount: 0,
    transitionCount: 0,
    exploration: { strategy: "surface", maxDepth: 2, status: "complete", problemCount: 0 },
  } satisfies AgentDebugDiscoverySummary);
  await service.startDiscovery({ sessionId: "discovery-1" });
  const coverage = await service.getCoverage("discovery-1");
  await service.record(recordIntent);
  await service.run({
    kind: "run-test",
    testId: "test-1",
    appMapId: "map-1",
    targetId: "device-1",
  });
  await service.inspectFailure({ kind: "inspect-failure", runId: "run-1" });
  assert.deepEqual(calls, ["discovery.create", "discovery.start", "discovery.coverage"]);
  assert.equal(coverage.screenCount, 0);
  assert.equal(record.kind, "author-test");
  assert.equal(run.kind, "run-test");
  assert.equal(failure.runId, "run-1");
});
