import assert from "node:assert/strict";
import test from "node:test";
import type {
  AppMap,
  AppMapMutationContext,
  CampaignRepairProposalInput,
  CampaignRepairTarget,
  Screen,
} from "@relay/protocol";
import { campaignRepairProposal } from "./campaign-repair-proposal.js";
import { submitAppMapProposal } from "./app-map/entity-operations.js";
import {
  approveAppMapProposal,
  revertAppMapRepairProposal,
} from "./app-map/proposal-operations.js";
import { compileAppMapTest } from "./map-work.js";

const scope = { organizationId: "org", projectId: "project", appMapId: "map" };

function screen(id: string, fingerprint: string): Screen {
  return {
    ...scope,
    id,
    title: id,
    identity: { schemaVersion: 1, fingerprint },
    variantIds: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function fixture(): AppMap {
  const home = screen("home", "a".repeat(64));
  const settings = screen("settings", "b".repeat(64));
  return {
    schemaVersion: 1,
    id: "map",
    organizationId: "org",
    projectId: "project",
    name: "Map",
    revision: 7,
    notes: {},
    groups: {},
    screens: { home, settings },
    screenVariants: {},
    connections: {
      "open-settings": {
        ...scope,
        id: "open-settings",
        fromScreenId: "home",
        destination: { kind: "screen", screenId: "settings" },
        label: "Settings",
        state: "ready",
        actions: [{ id: "tap-settings", kind: "tap", target: { label: "Settings" } }],
        navigation: {
          targetAlternatives: [{ kind: "accessibility", label: "Settings" }],
          expectedDestination: {
            screenId: "settings",
            identity: structuredClone(settings.identity!),
            evidenceIds: ["settings-tree"],
          },
        },
        createdAt: 1,
        updatedAt: 1,
      },
    },
    caseStacks: {},
    variables: {},
    tests: {
      smoke: {
        ...scope,
        id: "smoke",
        name: "Smoke",
        kind: "scenario",
        intentSchemaVersion: 1,
        steps: [
          {
            id: "visit-settings",
            kind: "instruction",
            intent: "Visit Settings",
            binding: {
              status: "resolved",
              kind: "connections",
              connectionIds: ["open-settings"],
            },
          },
        ],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    combines: {},
    routines: {},
    flows: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: 1,
    updatedAt: 1,
  };
}

function repairTarget(overrides: Partial<CampaignRepairTarget> = {}): CampaignRepairTarget {
  return {
    schemaVersion: 1,
    id: "run:visit-settings",
    status: "pending",
    defaultAction: "continue-and-report",
    source: {
      runId: "run",
      runInputDigest: "digest",
      checkId: "visit-settings",
      checkTitle: "Visit Settings",
      action: "app-map:map:test:smoke",
      capturedAt: 10,
      appMapId: "map",
      appMapRevision: 7,
      testId: "smoke",
    },
    expected: {
      screenId: "settings",
      originScreenId: "home",
      transitionId: "open-settings",
    },
    observed: {
      error: "old selector missed",
      screenIdentity: { fingerprint: "c".repeat(64) },
      navigationRepair: {
        connectionId: "open-settings",
        beforeSelector: { label: "Settings" },
        currentSelector: { identifier: "settings-row" },
        attempts: [],
      },
    },
    evidence: {
      result: {},
      frames: [{ index: 0, path: "runs/run/settings.png", caption: "failed", capturedAt: 10 }],
    },
    lineage: { sourceRunId: "run", priorAttempts: [] },
    actions: [],
    ...overrides,
  };
}

function request(kind: CampaignRepairProposalInput["kind"]): CampaignRepairProposalInput {
  return {
    runId: "run",
    checkId: "visit-settings",
    kind,
    reason: "Reviewed against the preserved failure evidence",
    ...(kind === "retarget" ? { selector: { identifier: "settings-row" } } : {}),
  };
}

function context(revision: number, eventId: string, at: number): AppMapMutationContext {
  return { expectedRevision: revision, eventId, actorId: "human:reviewer", actorKind: "human", at };
}

test("retarget accepts only the exact successful runtime selector", () => {
  const map = fixture();
  const proposal = campaignRepairProposal({
    map,
    targets: [repairTarget()],
    request: request("retarget"),
    proposalId: "repair-proposal",
    actorId: "human:reviewer",
    at: 20,
  });
  assert.deepEqual(proposal.changes[0], {
    kind: "connection.update",
    connectionId: "open-settings",
    patch: {
      navigation: {
        targetAlternatives: [
          { kind: "identifier", identifier: "settings-row" },
          { kind: "accessibility", label: "Settings" },
        ],
        expectedDestination: {
          screenId: "settings",
          identity: { schemaVersion: 1, fingerprint: "b".repeat(64) },
          evidenceIds: ["settings-tree"],
        },
      },
    },
  });
  assert.throws(
    () =>
      campaignRepairProposal({
        map,
        targets: [repairTarget()],
        request: { ...request("retarget"), selector: { label: "Something else" } },
        proposalId: "forged",
        actorId: "human:reviewer",
        at: 20,
      }),
    /exact successful selector/u,
  );
});

test("disable stays reviewable, compiles as an explicit omission, and reverts exactly", () => {
  const original = fixture();
  const proposal = campaignRepairProposal({
    map: original,
    targets: [repairTarget()],
    request: request("disable"),
    proposalId: "disable-proposal",
    actorId: "human:reviewer",
    at: 20,
  });
  const submitted = submitAppMapProposal(original, proposal, context(7, "submit", 20), {
    allowServerRepair: true,
  });
  const approved = approveAppMapProposal(
    submitted,
    "disable-proposal",
    context(8, "approve", 21),
    "Not relevant for this campaign",
  );
  const compiled = compileAppMapTest(approved, approved.tests.smoke!);
  assert.deepEqual(compiled.plan.omittedSteps, [
    {
      stepId: "visit-settings",
      intent: "Visit Settings",
      reason: "Reviewed against the preserved failure evidence",
      repairTargetId: "run:visit-settings",
    },
  ]);
  assert.equal(compiled.root.steps.length, 0);

  const reverted = revertAppMapRepairProposal(
    approved,
    "disable-proposal",
    context(9, "revert", 22),
    "Coverage is relevant again",
  );
  assert.equal(reverted.tests.smoke!.steps[0]!.execution, undefined);
  assert.equal(reverted.proposals["disable-proposal"]!.repair!.reverted!.actorId, "human:reviewer");
  assert.equal(compileAppMapTest(reverted, reverted.tests.smoke!).root.steps.length > 0, true);
});

test("repair proposals fail closed on stale map evidence and mixed equivalent diffs", () => {
  const map = fixture();
  assert.throws(
    () =>
      campaignRepairProposal({
        map: { ...map, revision: 8 },
        targets: [repairTarget()],
        request: request("accept-current"),
        proposalId: "stale",
        actorId: "human:reviewer",
        at: 20,
      }),
    /targets App Map revision 7, current revision is 8/u,
  );
  assert.throws(
    () =>
      campaignRepairProposal({
        map,
        targets: [
          repairTarget(),
          repairTarget({
            id: "run-2:other-check",
            source: { ...repairTarget().source, runId: "run-2", checkId: "other-check" },
          }),
        ],
        request: request("disable"),
        proposalId: "mixed",
        actorId: "human:reviewer",
        at: 20,
      }),
    /Test step other-check does not exist/u,
  );
});
