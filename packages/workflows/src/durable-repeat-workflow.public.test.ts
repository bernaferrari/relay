import assert from "node:assert/strict";
import test from "node:test";
import type {
  CombineCampaign,
  DurableWorkflowRead,
  ExecutionRisk,
  RepeatSpec,
  ResolvedRepeatSpec,
} from "@relay/protocol";
import { createRelayWorkflows, type RepeatTestIntent } from "./index.js";
import { createScriptedRelayClient, type ScriptedRelayStep } from "./testing.js";

const target = { kind: "device", platform: "android", targetId: "pixel-9" } as const;
const repeat: RepeatSpec = {
  dimensions: [{ id: "language", values: ["en", "it"] }],
  strategy: "zip",
  pilot: { mode: "representative" },
  resume: "untouched",
};
const resolved: ResolvedRepeatSpec = {
  dimensions: [{ id: "language", valueIds: ["en", "it"] }],
  strategy: "zip",
  pilot: { mode: "representative" },
  resume: "untouched",
};
const requestedIdentity = {
  actorId: "agent:test",
  workflowRequestId: "repeat-request",
  appMapId: "settings",
  requestedAppMapRevision: 7,
  testId: "locale-smoke",
  testPlanDigest: "plan-7",
  target,
  repeat,
  resolved,
  evidence: "visual",
} as const;
const frozen = {
  ...requestedIdentity,
  executionAppMapRevision: 8,
  rootRecipeId: "repeat-root",
} as const;

function workflow(
  version: number,
  transition: string,
  resource?: { kind: "campaign"; id: string },
): DurableWorkflowRead {
  return {
    record: {
      schemaVersion: 1,
      workflowId: "repeat-workflow",
      organizationId: "local",
      projectId: "default",
      kind: "repeat-test",
      version,
      status: "active",
      frozenIdentity: resource ? frozen : requestedIdentity,
      ...(resource ? { resource } : {}),
      createdBy: "agent:test",
      lastActorId: "agent:test",
      createdAt: 1,
      updatedAt: version,
      expiresAt: 100_000,
      lastTransition: transition,
    },
    audit: [],
  };
}

function campaign(status: "ready-to-resume" | "running" | "cancelled"): CombineCampaign {
  const pilotStatus = status === "cancelled" ? "cancelled" : "passed";
  const remainingStatus =
    status === "running" ? "queued" : status === "cancelled" ? "cancelled" : "pending";
  return {
    schemaVersion: 1,
    id: "campaign-1",
    projectId: "default",
    appMapId: "settings",
    combineId: "combine-1",
    sourceRevision: 8,
    latestRevision: 8,
    target: { kind: "device", id: "pixel-9", platform: "android" },
    ownerId: "agent:test",
    status,
    createdAt: 1,
    updatedAt: 2,
    cases: [
      {
        index: 0,
        cellId: "case-en",
        testId: "locale-smoke",
        world: "language=en",
        values: { language: "en" },
        targetProfileId: "pixel-profile",
        childIntentDigest: "child-en",
        outerIntentDigest: "outer-en",
        wrapperGraphDigest: "wrapper-en",
        staticInputDigest: "input-en",
        phase: "pilot",
        status: pilotStatus,
        jobId: "pilot-job",
        runId: "pilot-run",
      },
      {
        index: 1,
        cellId: "case-it",
        testId: "locale-smoke",
        world: "language=it",
        values: { language: "it" },
        targetProfileId: "pixel-profile",
        childIntentDigest: "child-it",
        outerIntentDigest: "outer-it",
        wrapperGraphDigest: "wrapper-it",
        staticInputDigest: "input-it",
        phase: "coverage",
        status: remainingStatus,
        ...(remainingStatus === "cancelled" ? { runId: "cancelled-run" } : {}),
      },
    ],
    lineage: [{ kind: "created", at: 1, appMapRevision: 8 }],
    execution: {
      selected: { language: ["en", "it"] },
      selectedCellIds: ["case-en", "case-it"],
      strategy: "zip",
      seed: 1,
      repeat: {
        schemaVersion: 1,
        requestedAppMapRevision: 7,
        executionAppMapRevision: 8,
        testId: "locale-smoke",
        testPlanDigest: "plan-7",
        rootRecipeId: "repeat-root",
        target,
        spec: repeat,
        resolved,
        evidence: "visual",
        pilotJobId: "pilot-job",
        selectedCaseIds: ["case-en", "case-it"],
      },
    },
  };
}

const risk: ExecutionRisk = {
  schemaVersion: 1,
  level: "safe",
  reasons: [],
  externalEffects: [],
  confirmation: "none",
  expectedAppBoundaries: [],
  maximumActions: 0,
  maximumDurationMs: 0,
  cleanupRequired: false,
};
function setupSteps(): ScriptedRelayStep[] {
  return [
    {
      id: "app-map.get",
      output: {
        appMap: {
          revision: 7,
          variables: {
            language: {
              id: "language",
              name: "Language",
              kind: "language",
              apply: { kind: "appLocale", app: "com.example.app" },
              options: [{ id: "en" }, { id: "it" }],
            },
          },
        },
      },
    },
    {
      id: "app-map.test.compile",
      output: {
        plan: { rootRecipeId: "base" },
        preflight: {
          schemaVersion: 1,
          mode: "offline-test-preflight",
          appMapId: "settings",
          appMapRevision: 7,
          testId: "locale-smoke",
          planDigest: "plan-7",
          executionRisk: risk,
          summary: {
            recipes: 1,
            checkedSelectors: 0,
            resolvedSelectors: 0,
            unknownCursorTransitions: 0,
            reviewRequiredReturns: 0,
            blockers: 0,
            warnings: 0,
          },
          selectors: [],
          cursorTimeline: [],
          returns: [],
          findings: [],
        },
      },
    },
  ];
}
function intent(): RepeatTestIntent {
  return {
    kind: "repeat-test",
    appMapId: "settings",
    testId: "locale-smoke",
    target,
    revision: { exact: 7 },
    repeat: structuredClone(repeat),
    actorId: "agent:test",
    workflowRequestId: "repeat-request",
    continuation: "durable",
  };
}

test("durable Repeat reserves before pilot and emits only workflow identity plus CAS version", async () => {
  const ready = campaign("ready-to-resume");
  const scripted = createScriptedRelayClient([
    ...setupSteps(),
    {
      id: "workflow.create",
      checkInput: (input) =>
        assert.deepEqual(input, {
          workflowId: "repeat-request",
          kind: "repeat-test",
          frozenIdentity: requestedIdentity,
        }),
      output: { disposition: "created", workflow: workflow(1, "created") },
    },
    {
      id: "workflow.transition",
      checkInput: (input) =>
        assert.deepEqual(input, {
          workflowId: "repeat-workflow",
          expectedVersion: 1,
          action: "reserve-repeat-pilot",
        }),
      output: { workflow: workflow(2, "repeat-pilot-requested") },
    },
    {
      id: "app-map.test.run",
      checkInput: (input) => {
        const mutation = (input as { repeatRecovery?: { workflowMutation?: unknown } })
          .repeatRecovery?.workflowMutation as Record<string, unknown>;
        assert.deepEqual(
          { ...mutation, completedAt: 0 },
          {
            schemaVersion: 1,
            workflowId: "repeat-workflow",
            transitionVersion: 2,
            action: "repeat-pilot",
            completedAt: 0,
          },
        );
      },
      output: {
        planIdentity: {
          appMapId: "settings",
          appMapRevision: 8,
          testId: "locale-smoke",
          rootRecipeId: "repeat-root",
        },
        plan: { rootRecipeId: "repeat-root" },
        job: { id: "pilot-job", action: "app-map.test.run", status: "queued", queuedAt: 1 },
        jobs: [{ id: "pilot-job", action: "app-map.test.run", status: "queued", queuedAt: 1 }],
        combine: { id: "combine-1", revision: 8 },
        campaign: { id: "campaign-1", selectedCellIds: ["case-en", "case-it"] },
      },
    },
    {
      id: "workflow.transition",
      checkInput: (input) =>
        assert.deepEqual(input, {
          workflowId: "repeat-workflow",
          expectedVersion: 2,
          action: "attach-repeat",
          campaignId: "campaign-1",
        }),
      output: {
        workflow: workflow(3, "repeat-pilot-reconciled", { kind: "campaign", id: "campaign-1" }),
        campaign: ready,
      },
    },
  ]);

  const snapshot = await createRelayWorkflows(scripted.client).start(intent());

  assert.deepEqual(snapshot.workflow, { workflowId: "repeat-workflow", expectedVersion: 3 });
  assert.equal(snapshot.ref, undefined);
  assert.equal(JSON.stringify(snapshot).includes("relay-workflow.v1."), false);
});

test("lost durable Repeat continuation response inspects once and never redispatches", async () => {
  const active = workflow(3, "repeat-pilot-reconciled", { kind: "campaign", id: "campaign-1" });
  const reconciled = workflow(5, "repeat-resume-reconciled", {
    kind: "campaign",
    id: "campaign-1",
  });
  const running = campaign("running");
  const scripted = createScriptedRelayClient([
    {
      id: "workflow.transition",
      output: {
        workflow: workflow(
          4,
          "repeat-resume-requested",
          active.record.resource as { kind: "campaign"; id: string },
        ),
      },
    },
    {
      id: "job.combine.campaign.resume",
      checkInput: (input) => {
        const mutation = (input as { workflowMutation: Record<string, unknown> }).workflowMutation;
        assert.equal(mutation.workflowId, "repeat-workflow");
        assert.equal(mutation.transitionVersion, 4);
        assert.equal(mutation.action, "repeat-resume");
      },
      error: new Error("response lost after commit"),
    },
    { id: "workflow.get", output: { workflow: reconciled, campaign: running } },
  ]);

  const snapshot = await createRelayWorkflows(scripted.client).advanceRepeat({
    workflowId: "repeat-workflow",
    expectedVersion: 3,
    action: "continue",
  });

  assert.equal(snapshot.stage, "remaining");
  assert.deepEqual(snapshot.workflow, { workflowId: "repeat-workflow", expectedVersion: 5 });
  assert.equal(
    scripted.invocations.filter(({ id }) => id === "job.combine.campaign.resume").length,
    1,
  );
});

test("stale durable Repeat reservation fails closed without campaign mutation", async () => {
  const current = workflow(5, "repeat-resume-reconciled", {
    kind: "campaign",
    id: "campaign-1",
  });
  const scripted = createScriptedRelayClient([
    { id: "workflow.transition", error: new Error("stale workflow version") },
    { id: "workflow.get", output: { workflow: current, campaign: campaign("running") } },
  ]);

  const snapshot = await createRelayWorkflows(scripted.client).advanceRepeat({
    workflowId: "repeat-workflow",
    expectedVersion: 3,
    action: "cancel",
  });

  assert.equal(snapshot.stage, "remaining");
  assert.equal(
    scripted.invocations.some(({ id }) => id === "job.combine.campaign.cancel"),
    false,
  );
});
