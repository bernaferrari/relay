import assert from "node:assert/strict";
import test from "node:test";
import type { OperationId, OperationInput, OperationOutput } from "@relay/protocol";
import { createProductChangeJourney } from "./change-journey.js";
import type { RelayOperationPort } from "@relay/workflows/operation-port";

const proof = {
  id: "change-1",
  version: 3,
  state: "ready",
  change: { repository: "acme/app", baseSha: "a", headSha: "b" },
  builds: [],
  selection: { affectedJourneys: [], targetCases: [] },
  policy: { id: "policy", version: 1 },
  runIds: ["run-1"],
  evidenceDigests: ["sha256:" + "a".repeat(64)],
  coverageGaps: [],
  residualRisk: [],
  requestedBy: "agent",
  updatedBy: "agent",
  createdAt: 1,
  updatedAt: 2,
} as never;

test("Change journey translates durable change identity and hides plan internals", async () => {
  const calls: Array<{ id: OperationId; input: unknown }> = [];
  const operations: RelayOperationPort = {
    async invoke<Id extends OperationId>(id: Id, input: OperationInput<Id>) {
      calls.push({ id, input });
      if (id === "proof.list") return { proofs: [proof] } as OperationOutput<Id>;
      if (id === "proof.inspect")
        return { proof, publications: [], publicationOutbox: [] } as OperationOutput<Id>;
      return {
        proof,
        execution: {
          id: "execution-1",
          proofId: "change-1",
          status: "completed",
          cursor: 1,
          total: 1,
          runIds: [],
          deadlineAt: 2,
          nextAction: "complete",
        },
      } as OperationOutput<Id>;
    },
  };
  const journey = createProductChangeJourney({ operations });
  const listed = await journey.list();
  assert.equal(listed[0]?.id, "change-1");
  assert.equal("selection" in listed[0]!, false);
  await journey.open("change-1");
  await journey.run({ changeId: "change-1" });
  assert.deepEqual(
    calls.map((call) => call.id),
    ["proof.list", "proof.inspect", "proof.run", "proof.inspect"],
  );
  assert.deepEqual(calls[2]?.input, { proofId: "change-1" });
});

test("Change report is derived from the canonical inspected state", async () => {
  const operations: RelayOperationPort = {
    async invoke<Id extends OperationId>(id: Id) {
      if (id === "proof.inspect")
        return {
          proof: {
            ...(proof as Record<string, unknown>),
            state: "proved",
            decision: "proved",
          } as never,
          publications: [],
          publicationOutbox: [],
        } as OperationOutput<Id>;
      return { proofs: [] } as OperationOutput<Id>;
    },
  };
  const journey = createProductChangeJourney({ operations });
  const report = await journey.report("change-1");
  assert.equal(report?.status, "proved");
  assert.equal(report?.changeId, "change-1");
  assert.equal(report?.evidenceCount, 1);
});

test("Change recovery does not leak transport errors or imply retry", async () => {
  const operations: RelayOperationPort = {
    async invoke() {
      throw new Error("secret socket path");
    },
  };
  const state = await createProductChangeJourney({ operations }).open("change-1");
  assert.equal(state.status, "needs-attention");
  assert.equal(state.recovery?.retryable, false);
  assert.doesNotMatch(state.recovery?.detail ?? "", /secret socket path/);
});

test("Change journey resumes a paused human step with a server-owned attachment", async () => {
  const calls: Array<{ id: OperationId; input: unknown }> = [];
  const execution = {
    id: "execution-1",
    proofId: "change-1",
    status: "paused-human" as const,
    cursor: 0,
    total: 1,
    currentCellId: "cell-1",
    runIds: [],
    deadlineAt: 10,
    nextAction: "human-intervention" as const,
    humanIntervention: {
      cellId: "cell-1",
      stepId: "step-1",
      effects: ["account"],
      reason: "Review the fixture.",
      at: 9,
    },
  };
  const operations: RelayOperationPort = {
    async invoke<Id extends OperationId>(id: Id, input: OperationInput<Id>) {
      calls.push({ id, input });
      if (id === "proof.inspect")
        return {
          proof,
          publications: [],
          publicationOutbox: [],
          execution: resumed ? { ...execution, status: "completed", nextAction: "complete" } : execution,
        } as OperationOutput<Id>;
      return {
        proof,
        execution: { ...execution, status: "queued" },
        evidence: {
          schemaVersion: 1,
          executionId: "execution-1",
          proofId: "change-1",
          cellId: "cell-1",
          stepId: "step-1",
          evidenceDigest: `sha256:${"a".repeat(64)}`,
          recordedBy: "human:reviewer",
          recordedAt: 10,
          requestId: "resume-1",
          source: "server-attachment",
          scopeDigest: `sha256:${"b".repeat(64)}`,
        },
      } as OperationOutput<Id>;
    },
  };
  let resumed = false;
  const journey = createProductChangeJourney({ operations });
  await journey.open("change-1");
  resumed = true;
  await journey.resumeHumanEvidence({
    changeId: "change-1",
    executionId: "execution-1",
    cellId: "cell-1",
    stepId: "step-1",
    attachment: {
      kind: "snapshot",
      encoding: "utf8",
      data: '{"reviewed":true}',
      capturedAt: 10,
    },
    wait: true,
  });
  const resume = calls.find((call) => call.id === "proof.run.human-evidence");
  assert.deepEqual(resume?.input, {
    proofId: "change-1",
    executionId: "execution-1",
    cellId: "cell-1",
    stepId: "step-1",
    attachment: {
      kind: "snapshot",
      encoding: "utf8",
      data: '{"reviewed":true}',
      capturedAt: 10,
    },
    wait: true,
    confirm: true,
  });
  assert.equal("evidenceDigest" in ((resume?.input ?? {}) as object), false);
});

test("Change publications use the server-owned outbox identity", async () => {
  const operations: RelayOperationPort = {
    async invoke<Id extends OperationId>(id: Id) {
      if (id === "proof.inspect")
        return {
          proof,
          publications: [
            {
              sequence: 7,
              externalId: "change-1",
              headSha: "b",
              provider: "github",
            },
          ],
          publicationOutbox: [
            {
              id: "change-proof-publication:canonical",
              externalId: "change-1",
              headSha: "b",
              proofId: "change-1",
              proofVersion: 3,
              status: "published",
              provider: "github",
            },
          ],
        } as never;
      return { proofs: [] } as OperationOutput<Id>;
    },
  };
  const state = await createProductChangeJourney({ operations }).open("change-1");
  assert.equal(state.details?.publications[0]?.id, "change-proof-publication:canonical");
});

test("Change details project the reviewed plan, claim, failure, and audit boundary", async () => {
  const richProof = {
    ...(proof as Record<string, unknown>),
    change: {
      repository: "acme/settings",
      baseSha: "a",
      headSha: "b",
      pullRequest: 184,
      targetBranch: "main",
      agentClaim: {
        summary: "Keep Arabic settings readable",
        acceptanceCriteria: ["The compact layout does not overlap"],
      },
    },
    builds: [
      {
        id: "build-private-id",
        platform: "android",
        configuration: "proof release",
      },
    ],
    selection: {
      affectedJourneys: [
        {
          appMapId: "settings",
          testId: "arabic-layout",
          appMapRevision: 4,
          reason: "The changed layout is checked here.",
          confidence: "definite",
        },
      ],
      targetCases: [
        {
          id: "target-case-private-id",
          targetProfile: { name: "Pixel 9", platform: "android" },
        },
      ],
      pilotCellId: "cell-private-id",
      cells: [
        {
          id: "cell-private-id",
          journey: { appMapId: "settings", testId: "arabic-layout" },
          targetCaseId: "target-case-private-id",
          buildId: "build-private-id",
          requirement: "required",
          selectionReason: "This is the smallest representative device.",
          dimensions: { locale: "ar" },
          estimatedDurationMs: 1_500,
          cleanupRequired: false,
        },
      ],
    },
    policy: { id: "relay.verify-change", version: 2 },
    policyDigest: `sha256:${"c".repeat(64)}`,
    planDigest: `sha256:${"d".repeat(64)}`,
    planApproval: {
      decisionId: "review-1",
      approvedBy: "human:reviewer",
      approvedAt: 1,
      reason: "Reviewed.",
    },
    firstCausalFailure: {
      runId: "run-failed",
      testId: "arabic-layout",
      summary: "The Arabic heading overlapped the action.",
      evidenceRefs: [],
    },
    smallestNextVerification: { kind: "review", reason: "Review the failed screenshot." },
    requestedBy: "agent:builder",
    updatedBy: "human:reviewer",
  } as never;
  const operations: RelayOperationPort = {
    async invoke<Id extends OperationId>(id: Id) {
      if (id === "proof.inspect") {
        return {
          proof: richProof,
          publications: [],
          publicationOutbox: [],
          execution: {
            id: "execution-private-id",
            proofId: "change-1",
            status: "paused-human",
            cursor: 1,
            total: 2,
            currentCellId: "cell-private-id",
            runIds: ["run-failed"],
            deadlineAt: 10,
            nextAction: "human-intervention",
            humanIntervention: {
              cellId: "cell-private-id",
              stepId: "step-private-id",
              effects: ["account"],
              reason: "Confirm the account remains usable.",
              at: 9,
            },
          },
        } as OperationOutput<Id>;
      }
      return { proofs: [] } as OperationOutput<Id>;
    },
  };

  const state = await createProductChangeJourney({ operations }).open("change-1");
  assert.equal(state.change?.title, "Keep Arabic settings readable");
  assert.equal(state.change?.requiredVerificationCount, 1);
  assert.equal(state.details?.affectedTests[0]?.reason, "The changed layout is checked here.");
  assert.equal(state.details?.verificationPlan[0]?.targetName, "Pixel 9");
  assert.equal(state.details?.verificationPlan[0]?.pilot, true);
  assert.equal(state.details?.firstFailure?.summary, "The Arabic heading overlapped the action.");
  assert.equal(state.details?.execution?.attention?.kind, "human-evidence");
  assert.equal(state.status, "needs-attention");
  assert.equal(state.details?.audit.policyId, "relay.verify-change");
  assert.equal(state.details?.audit.policyVersion, 2);
  assert.equal(state.details?.audit.planDigest, `sha256:${"d".repeat(64)}`);
});
