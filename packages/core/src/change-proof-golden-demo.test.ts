import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  providerCheckForStoredChangeProof,
  recordChangeVerificationDecision,
} from "./change-proof-decision.js";
import {
  CHANGE_PROOF_GOLDEN_DEMO,
  goldenDemoReadyProof,
  goldenDemoVerificationPlan,
  runChangeProofGoldenDemo,
} from "./change-proof-golden-demo.js";
import {
  advanceChangeVerification,
  createChangeVerification,
  readChangeVerificationHistory,
  supersedeChangeVerification,
} from "./change-verification-store.js";
import { resetControlDatabaseCache } from "./collaboration-db.js";
import { analyzeTracePack } from "./trace-pack.js";

const scope = {
  organizationId: CHANGE_PROOF_GOLDEN_DEMO.organizationId,
  projectId: CHANGE_PROOF_GOLDEN_DEMO.projectId,
} as const;

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;

async function withStateRoot(operation: () => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "relay-change-proof-golden-demo-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  try {
    await operation();
  } finally {
    resetControlDatabaseCache();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
}

test("golden Proof fixture detects RTL regression and only expands after a passing pilot", async () => {
  const plan = goldenDemoVerificationPlan(CHANGE_PROOF_GOLDEN_DEMO.failedHeadSha);
  assert.equal(plan.status, "ready-for-approval");
  assert.deepEqual(
    plan.impact.journeys.map(({ appMapId, testId, classification }) => ({
      appMapId,
      testId,
      classification,
    })),
    [
      {
        appMapId: CHANGE_PROOF_GOLDEN_DEMO.appMapId,
        testId: CHANGE_PROOF_GOLDEN_DEMO.testId,
        classification: "definitely-affected",
      },
    ],
  );
  assert.deepEqual(
    plan.selection.targetCases.map(({ id }) => id),
    ["android-pixel-9-ar", "web-chromium-compact-ar", "web-chromium-desktop-ar"],
  );

  const demo = await runChangeProofGoldenDemo();
  assert.equal(demo.oldDecision.decision, "rejected");
  assert.equal(demo.oldDecision.firstCausalFailure?.targetCaseId, "web-chromium-compact-ar");
  assert.deepEqual(demo.initialExecutedCaseIds, ["android-pixel-9-ar", "web-chromium-compact-ar"]);
  assert.deepEqual(demo.repairPacket, {
    schemaVersion: 1,
    proofId: "proof-settings-failed",
    headSha: CHANGE_PROOF_GOLDEN_DEMO.failedHeadSha,
    runId: "proof-settings-failed:web-chromium-compact-ar",
    appMapId: CHANGE_PROOF_GOLDEN_DEMO.appMapId,
    testId: CHANGE_PROOF_GOLDEN_DEMO.testId,
    targetCaseId: "web-chromium-compact-ar",
    firstCausalFailure: "Primary action overlaps the Arabic description by 22 px.",
    evidenceRefs: demo.oldCaseResults[1]!.evidenceDigests,
    relevantLogs: ["visual-check: rtl-overlap=22px"],
    suggestedScope: [
      CHANGE_PROOF_GOLDEN_DEMO.appMapId,
      CHANGE_PROOF_GOLDEN_DEMO.testId,
      "web-chromium-compact-ar",
    ],
    rerun: { operationId: "proof.rerun-affected", proofId: "proof-settings-failed" },
  });
  assert.equal(demo.oldTracePacks.length, 2, "the causal failure stops old-head expansion");
  assert.ok(demo.oldTracePacks.every((pack) => pack.completeness.status === "complete"));
  assert.equal(demo.repairedDecision.decision, "proved");
  assert.deepEqual(demo.repairedExecutedCaseIds, [
    "android-pixel-9-ar",
    "web-chromium-compact-ar",
    "web-chromium-desktop-ar",
  ]);
  assert.deepEqual(demo.reusedCaseIds, [], "cross-head evidence is never reused");
  assert.equal(demo.repairedCaseResults.length, 3);
  assert.ok(
    demo.repairedCaseResults.every(
      ({ sourceSha }) => sourceSha === CHANGE_PROOF_GOLDEN_DEMO.repairedHeadSha,
    ),
  );
  assert.ok(demo.repairedTracePacks.every((pack) => pack.completeness.status === "complete"));
  assert.ok(
    demo.repairedTracePacks.every((pack) => analyzeTracePack(pack).historicalVerdict === "proved"),
  );
  assert.equal(
    providerCheckForStoredChangeProof({
      proof: {
        ...demo.repairedProof,
        state: "proved",
        decision: "proved",
        runIds: demo.repairedCaseResults.map(({ runId }) => runId),
        evidenceDigests: demo.repairedCaseResults.flatMap(({ evidenceDigests }) => evidenceDigests),
        smallestNextVerification: {
          kind: "none",
          reason: "Every policy-required case has complete proof.",
        },
      },
    }).conclusion,
    "success",
  );
});

test("golden Proof lifecycle keeps the failed head immutable and proves only the repaired head", async () => {
  await withStateRoot(async () => {
    const oldReady = goldenDemoReadyProof(
      CHANGE_PROOF_GOLDEN_DEMO.failedHeadSha,
      "proof-settings-failed",
      200,
    );
    const created = await createChangeVerification({
      ...scope,
      id: oldReady.id,
      change: oldReady.change,
      builds: oldReady.builds,
      selection: oldReady.selection,
      policy: oldReady.policy,
      requestedBy: oldReady.requestedBy,
      actorId: "agent:coder",
      requestId: "golden-start",
      requestDigest: digest("1"),
      at: 100,
    });
    const ready = await advanceChangeVerification({
      ...scope,
      proofId: created.id,
      expectedVersion: created.version,
      state: "ready",
      actorId: "human:reviewer",
      requestId: "golden-approve",
      requestDigest: digest("2"),
      action: "approve-plan",
      at: 200,
      builds: oldReady.builds,
      selection: oldReady.selection,
      planApproval: oldReady.planApproval,
    });
    const running = await advanceChangeVerification({
      ...scope,
      proofId: ready.id,
      expectedVersion: ready.version,
      state: "running-pilot",
      actorId: "system:relay",
      requestId: "golden-pilot",
      requestDigest: digest("7"),
      action: "start-pilot",
      at: 300,
    });
    const demoRun = await runChangeProofGoldenDemo();
    const rejected = await recordChangeVerificationDecision({
      ...scope,
      proofId: running.id,
      expectedVersion: running.version,
      caseResults: demoRun.oldCaseResults,
      actorId: "system:relay",
      requestId: "golden-reject",
      requestDigest: digest("3"),
      at: 400,
    });
    assert.equal(rejected.state, "rejected");
    const rejectedSnapshot = structuredClone(rejected);

    const superseded = await supersedeChangeVerification({
      ...scope,
      proofId: rejected.id,
      expectedVersion: rejected.version,
      actorId: "agent:coder",
      requestId: "golden-rerun",
      requestDigest: digest("4"),
      at: 500,
      replacement: {
        id: "proof-settings-repaired",
        change: goldenDemoReadyProof(
          CHANGE_PROOF_GOLDEN_DEMO.repairedHeadSha,
          "proof-settings-repaired",
          600,
          CHANGE_PROOF_GOLDEN_DEMO.failedHeadSha,
        ).change,
        builds: goldenDemoReadyProof(
          CHANGE_PROOF_GOLDEN_DEMO.repairedHeadSha,
          "proof-settings-repaired",
          600,
          CHANGE_PROOF_GOLDEN_DEMO.failedHeadSha,
        ).builds,
        selection: oldReady.selection,
        policy: oldReady.policy,
        requestedBy: "agent:coder",
        actorId: "agent:coder",
        requestId: "golden-rerun",
        requestDigest: digest("4"),
        at: 500,
      },
    });
    assert.equal(superseded.previous.state, "superseded");
    assert.equal(superseded.replacement.change.baseSha, CHANGE_PROOF_GOLDEN_DEMO.failedHeadSha);
    assert.equal(superseded.replacement.change.headSha, CHANGE_PROOF_GOLDEN_DEMO.repairedHeadSha);

    const repairedReady = await advanceChangeVerification({
      ...scope,
      proofId: superseded.replacement.id,
      expectedVersion: superseded.replacement.version,
      state: "ready",
      actorId: "human:reviewer",
      requestId: "golden-approve-repair",
      requestDigest: digest("5"),
      action: "approve-plan",
      at: 700,
      builds: superseded.replacement.builds,
      selection: goldenDemoReadyProof(
        CHANGE_PROOF_GOLDEN_DEMO.repairedHeadSha,
        "proof-settings-repaired",
        600,
        CHANGE_PROOF_GOLDEN_DEMO.failedHeadSha,
      ).selection,
      planApproval: goldenDemoReadyProof(
        CHANGE_PROOF_GOLDEN_DEMO.repairedHeadSha,
        "proof-settings-repaired",
        600,
        CHANGE_PROOF_GOLDEN_DEMO.failedHeadSha,
      ).planApproval,
    });
    const demoProof = await runChangeProofGoldenDemo();
    const repairedRunning = await advanceChangeVerification({
      ...scope,
      proofId: repairedReady.id,
      expectedVersion: repairedReady.version,
      state: "running-pilot",
      actorId: "system:relay",
      requestId: "golden-repair-pilot",
      requestDigest: digest("8"),
      action: "start-pilot",
      at: 750,
    });
    const proved = await recordChangeVerificationDecision({
      ...scope,
      proofId: repairedRunning.id,
      expectedVersion: repairedRunning.version,
      caseResults: demoProof.repairedCaseResults,
      actorId: "system:relay",
      requestId: "golden-prove",
      requestDigest: digest("6"),
      at: 800,
    });
    assert.equal(proved.state, "proved");
    assert.equal(proved.change.headSha, CHANGE_PROOF_GOLDEN_DEMO.repairedHeadSha);

    const oldHistory = await readChangeVerificationHistory(scope, oldReady.id);
    assert.deepEqual(
      oldHistory.map(({ state }) => state),
      ["planning", "ready", "running-pilot", "rejected", "superseded"],
    );
    assert.deepEqual(
      JSON.parse(JSON.stringify(oldHistory[3])),
      JSON.parse(JSON.stringify(rejectedSnapshot)),
    );
    assert.equal(
      providerCheckForStoredChangeProof({ proof: oldHistory.at(-1)! }).classification,
      "superseded",
    );
    assert.equal(providerCheckForStoredChangeProof({ proof: proved }).conclusion, "success");
  });
});
