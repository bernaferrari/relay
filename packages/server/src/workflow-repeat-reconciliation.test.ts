import assert from "node:assert/strict";
import test from "node:test";
import type {
  DurableWorkflowRead,
  StoredCombineCampaign,
  TransitionDurableWorkflowInput,
} from "@relay/core";
import type { DurableWorkflowStatus, RepeatSpec, ResolvedRepeatSpec } from "@relay/protocol";
import type { RequestContext } from "./security.js";
import {
  assertRepeatWorkflowAccess,
  reconcileRepeat,
  type RepeatReconciliationRuntime,
  validateLegacyRepeatAdoption,
} from "./workflow-repeat-reconciliation.js";

const scope: RequestContext = {
  subject: "agent:owner",
  organizationId: "local",
  projectId: "default",
  allowedProjects: ["default"],
  tokenKind: "service",
  localTrusted: false,
  role: "runner",
};
const target = { kind: "device", platform: "android", targetId: "pixel-9" } as const;
const frozen = {
  actorId: "agent:owner",
  workflowRequestId: "repeat-request",
  appMapId: "settings",
  requestedAppMapRevision: 7,
  executionAppMapRevision: 8,
  testId: "locale-smoke",
  testPlanDigest: "plan-7",
  rootRecipeId: "repeat-root",
  target,
  repeat: {
    dimensions: [{ id: "language", values: ["en", "it"] }],
    strategy: "zip",
    pilot: { mode: "representative" },
    resume: "untouched",
  },
  resolved: {
    dimensions: [{ id: "language", valueIds: ["en", "it"] }],
    strategy: "zip",
    pilot: { mode: "representative" },
    resume: "untouched",
  },
  evidence: "visual",
} as const;

function workflow(input: {
  version: number;
  transition: string;
  status?: DurableWorkflowStatus;
  resource?: boolean;
}): DurableWorkflowRead {
  return {
    record: {
      schemaVersion: 1,
      workflowId: "repeat-workflow",
      organizationId: "local",
      projectId: "default",
      kind: "repeat-test",
      version: input.version,
      status: input.status ?? "active",
      frozenIdentity: frozen,
      ...(input.resource === false ? {} : { resource: { kind: "campaign", id: "campaign-1" } }),
      createdBy: "agent:owner",
      lastActorId: "agent:owner",
      createdAt: 1,
      updatedAt: input.version,
      expiresAt: 10_000,
      lastTransition: input.transition,
    },
    audit: [],
  };
}

function campaign(
  mutation?: NonNullable<
    NonNullable<StoredCombineCampaign["execution"]>["repeat"]
  >["workflowMutation"],
): StoredCombineCampaign {
  return {
    schemaVersion: 1,
    id: "campaign-1",
    projectId: "default",
    appMapId: "settings",
    combineId: "combine-1",
    sourceRevision: 8,
    latestRevision: 8,
    ownerId: "agent:owner",
    target: { kind: "device", id: "pixel-9", platform: "android" },
    status: "ready-to-resume",
    createdAt: 1,
    updatedAt: 2,
    cases: [],
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
        spec: structuredClone(frozen.repeat) as unknown as RepeatSpec,
        resolved: structuredClone(frozen.resolved) as unknown as ResolvedRepeatSpec,
        evidence: "visual",
        pilotJobId: "pilot-job",
        selectedCaseIds: ["case-en", "case-it"],
        ...(mutation ? { workflowMutation: mutation } : {}),
      },
    },
  };
}

function runtime(initial: DurableWorkflowRead, stored = campaign()) {
  let current = structuredClone(initial);
  const transitions: TransitionDurableWorkflowInput[] = [];
  let targetChecks = 0;
  const value: RepeatReconciliationRuntime = {
    readRepeatCampaign: async () => stored,
    findRepeatCampaignsByWorkflow: async () => [stored],
    projectRepeatCampaign: async (candidate) => candidate,
    assertTargetControl: async () => {
      targetChecks += 1;
    },
    transitionWorkflow: async (input) => {
      transitions.push(input);
      if (input.expectedVersion !== current.record.version) {
        return { status: "stale", current };
      }
      current = {
        record: {
          ...current.record,
          version: current.record.version + 1,
          status: input.status,
          lastTransition: input.transition,
          updatedAt: input.at,
          ...(input.resource ? { resource: input.resource } : {}),
          ...(input.frozenIdentity ? { frozenIdentity: input.frozenIdentity } : {}),
        },
        audit: current.audit,
      };
      return { status: "updated", workflow: current };
    },
  };
  return { value, transitions, targetChecks: () => targetChecks };
}

test("requested and outcome-unknown Repeat mutations reconcile only from their exact receipt", async () => {
  for (const [version, transition] of [
    [4, "repeat-resume-requested"],
    [5, "repeat-resume-outcome-unknown"],
  ] as const) {
    const receiptVersion = transition.endsWith("outcome-unknown") ? version - 1 : version;
    const stored = campaign({
      schemaVersion: 1,
      workflowId: "repeat-workflow",
      transitionVersion: receiptVersion,
      action: "repeat-resume",
      completedAt: 20,
    });
    const initial = workflow({ version, transition });
    const harness = runtime(initial, stored);
    const result = await reconcileRepeat(scope, harness.value, initial, "agent:owner", 50, stored);
    assert.equal(result.workflow.record.lastTransition, "repeat-resume-reconciled");
    assert.equal(harness.transitions.length, 1);
  }
});

test("unrelated campaign state cannot prove a reserved Repeat mutation", async () => {
  const initial = workflow({ version: 4, transition: "repeat-resume-requested" });
  const harness = runtime(initial, campaign());
  const result = await reconcileRepeat(
    scope,
    harness.value,
    initial,
    "agent:owner",
    50,
    campaign(),
  );
  assert.equal(result.workflow.record.status, "needs-attention");
  assert.equal(result.workflow.record.lastTransition, "repeat-resume-outcome-unknown");
});

test("foreign Repeat lookup is denied before target access or workflow mutation", async () => {
  const initial = workflow({ version: 3, transition: "repeat-pilot-reconciled" });
  const harness = runtime(initial);
  await assert.rejects(
    assertRepeatWorkflowAccess(scope, harness.value, initial, "agent:other"),
    /Workflow not found/u,
  );
  assert.equal(harness.targetChecks(), 0);
  assert.equal(harness.transitions.length, 0);
});

test("legacy Repeat adoption requires exact campaign lineage and selection", () => {
  const stored = campaign();
  assert.ok(
    validateLegacyRepeatAdoption({
      projectId: "default",
      actorId: "agent:owner",
      frozenIdentity: frozen,
      campaign: stored,
      pilotJobId: "pilot-job",
      selectedCaseIds: ["case-en", "case-it"],
    }),
  );
  assert.equal(
    validateLegacyRepeatAdoption({
      projectId: "default",
      actorId: "agent:owner",
      frozenIdentity: frozen,
      campaign: stored,
      pilotJobId: "other-job",
      selectedCaseIds: ["case-en", "case-it"],
    }),
    undefined,
  );
});
