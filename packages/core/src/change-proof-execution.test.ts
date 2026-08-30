import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ChangeVerification } from "@relay/protocol";
import {
  advanceChangeVerification,
  createChangeVerification,
  readChangeVerification,
} from "./change-verification-store.js";
import {
  createChangeProofExecutionCoordinator,
  summarizeChangeProofExecution,
  type ChangeProofExecutionSubmitInput,
} from "./change-proof-execution.js";
import { resetControlDatabaseCache } from "./collaboration-db.js";
import { withControlStore } from "./collaboration-store.js";
import { listChangeProofPublicationOutbox } from "./change-proof-publication-outbox.js";

const scope = { organizationId: "acme", projectId: "relay" } as const;
const baseSha = "1".repeat(40);
const headSha = "2".repeat(40);
const buildDigest = `sha256:${"a".repeat(64)}` as const;
const requestDigest = `sha256:${"b".repeat(64)}` as const;

async function withStateRoot(operation: () => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "relay-proof-execution-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  resetControlDatabaseCache();
  try {
    await operation();
  } finally {
    resetControlDatabaseCache();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
}

function selection(cellCount = 1): ChangeVerification["selection"] {
  const browserAr: ChangeVerification["selection"]["targetCases"][number] = {
    id: "browser-ar",
    executionTarget: {
      schemaVersion: 1,
      kind: "local-browser",
      provider: { key: "relay.local.browser", scope: "local" },
      targetId: "web",
      platform: "browser",
      identity: { kind: "browser-target", value: "web" },
    },
    targetProfile: {
      id: "web:ar",
      targetId: "web",
      source: "browser",
      platform: "browser",
      name: "Arabic browser",
      viewport: { width: 390, height: 844 },
      browserCaseProfile: {
        schemaVersion: 1,
        engine: "chromium",
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        mobile: true,
        touch: true,
        locale: "ar",
        timezoneId: "UTC",
        colorScheme: "dark",
        reducedMotion: "no-preference",
        permissions: [],
        offline: false,
        environmentRevision: "fixture-v1",
      },
      capabilities: ["snapshot", "screenshot", "tap"],
      observedAt: 10,
    },
    dimensions: { locale: "ar" },
    required: true,
  };
  const browserEn = {
    ...browserAr,
    id: "browser-en",
    targetProfile: {
      ...browserAr.targetProfile,
      id: "web:en",
      name: "English browser",
      browserCaseProfile: {
        ...browserAr.targetProfile.browserCaseProfile,
        schemaVersion: 1 as const,
        locale: "en-US",
      },
    },
    dimensions: { locale: "en" },
  } as ChangeVerification["selection"]["targetCases"][number];
  const cells = [
    {
      id: "language__browser-ar",
      journey: { appMapId: "settings", testId: "language", appMapRevision: 4 },
      targetCaseId: "browser-ar",
      buildId: "web-build",
      requirement: "required" as const,
      selectionReason: "Arabic is the reviewed pilot coverage.",
      dimensions: { locale: "ar" },
      cleanupRequired: false,
    },
    {
      id: "language__browser-en",
      journey: { appMapId: "settings", testId: "language", appMapRevision: 4 },
      targetCaseId: "browser-en",
      buildId: "web-build",
      requirement: "required" as const,
      selectionReason: "English is required expansion coverage.",
      dimensions: { locale: "en" },
      cleanupRequired: false,
    },
  ];
  return {
    affectedJourneys: [
      {
        appMapId: "settings",
        testId: "language",
        appMapRevision: 4,
        reason: "The changed screen is covered by the saved Test.",
        confidence: "definite",
      },
    ],
    targetCases: [browserAr, browserEn].slice(0, cellCount),
    cells: cells.slice(0, cellCount),
    pilotCellId: "language__browser-ar",
  };
}

async function readyProof(): Promise<ChangeVerification> {
  const created = await createChangeVerification({
    ...scope,
    id: "proof-execution-test",
    change: { repository: "acme/settings", baseSha, headSha },
    builds: [
      {
        id: "web-build",
        platform: "web",
        artifactDigest: buildDigest,
        sourceSha: headSha,
        configuration: "production",
        environmentRevision: "fixture-v1",
      },
    ],
    selection: selection(),
    policy: { id: "relay.default", version: 3 },
    requestedBy: "agent:proof-test",
    actorId: "agent:proof-test",
    requestId: "proof-start",
    requestDigest,
    at: 100,
  });
  return advanceChangeVerification({
    ...scope,
    proofId: created.id,
    expectedVersion: created.version,
    state: "ready",
    actorId: "human:reviewer",
    requestId: "proof-approve",
    requestDigest,
    action: "approve-plan",
    at: 200,
    planApproval: {
      decisionId: "decision-1",
      approvedBy: "human:reviewer",
      approvedAt: 200,
      reason: "The exact Test, build, and target are approved.",
    },
    smallestNextVerification: { kind: "run-pilot", reason: "Run the pilot." },
  });
}

function submit(proof: ChangeVerification): ChangeProofExecutionSubmitInput {
  return {
    ...scope,
    proof,
    requestId: "proof-run-request",
    requestDigest,
    actorId: "runner:proof-test",
    authority: "confirmed",
  };
}

function projectedPass(runId: string) {
  return {
    appMapId: "settings",
    testId: "language",
    targetCaseId: "browser-ar",
    runId,
    sourceSha: headSha,
    buildId: "web-build",
    artifactDigest: buildDigest,
    outcome: "passed" as const,
    evidenceDigests: [requestDigest],
    evidenceComplete: true,
    selectorResolution: "deterministic" as const,
    inputOutcome: "reconciled" as const,
    cleanup: "not-required" as const,
  };
}

function fakeRun(id: string) {
  return { id } as never;
}

test("proof execution admission freezes the plan and exposes only a bounded summary", async () => {
  await withStateRoot(async () => {
    const proof = await readyProof();
    const coordinator = createChangeProofExecutionCoordinator({
      now: () => 300,
      maxDurationMs: 1_000,
      workerId: "worker:test",
    });
    const admitted = await coordinator.submit(submit(proof));
    assert.equal(admitted.status, "queued");
    assert.equal(admitted.cursor, 0);
    assert.equal(admitted.deadlineAt, 1_300);
    assert.deepEqual(
      admitted.cells.map(({ cell }) => cell.cellId),
      ["language__browser-ar"],
    );
    assert.equal(admitted.frozenProof.selection.cells?.[0]?.id, "language__browser-ar");
    assert.deepEqual(summarizeChangeProofExecution(admitted), {
      id: admitted.id,
      proofId: proof.id,
      status: "queued",
      cursor: 0,
      total: 1,
      currentCellId: "language__browser-ar",
      runIds: [],
      deadlineAt: 1_300,
      nextAction: "run-pilot",
    });
    const persisted = await coordinator.read(scope, proof.id);
    assert.deepEqual(persisted, admitted);
    assert.equal((await readChangeVerification(scope, proof.id))?.state, "running-pilot");
  });
});

test("a dispatch outcome that crosses the target seam without a Run becomes terminally uncertain", async () => {
  await withStateRoot(async () => {
    const proof = await readyProof();
    const input = submit(proof);
    const coordinator = createChangeProofExecutionCoordinator({
      now: () => 300,
      workerId: "worker:test",
    });
    let dispatches = 0;
    const result = await coordinator.run(input, async () => {
      dispatches += 1;
      throw new Error("target controller stopped before returning a Run id");
    });
    assert.equal(result.status, "uncertain");
    assert.equal(result.terminalUncertainty?.cellId, "language__browser-ar");
    assert.equal(dispatches, 1);
    assert.equal((await readChangeVerification(scope, proof.id))?.state, "needs-review");

    const repeated = await coordinator.run(input, async () => {
      dispatches += 1;
      throw new Error("must not dispatch an uncertain cell twice");
    });
    assert.equal(repeated.status, "uncertain");
    assert.equal(dispatches, 1);
  });
});

test("restart reconciliation fences a claimed cell with no durable Run manifest", async () => {
  await withStateRoot(async () => {
    const proof = await readyProof();
    const input = submit(proof);
    const coordinator = createChangeProofExecutionCoordinator({
      now: () => 300,
      workerId: "worker:test",
    });
    const admitted = await coordinator.submit(input);
    await withControlStore((store) => {
      store.updateChangeProofExecution({
        ...admitted,
        status: "running",
        lease: {
          workerId: "dead-worker",
          token: "dead-token",
          claimedAt: 300,
          expiresAt: 400,
        },
        cells: [{ ...admitted.cells[0]!, status: "running", runId: "run-never-committed" }],
        runIds: ["run-never-committed"],
        updatedAt: 350,
      });
    });
    const reconciled = await coordinator.reconcile(scope, 500);
    assert.equal(reconciled.length, 1);
    assert.equal(reconciled[0]?.status, "uncertain");
    assert.equal(reconciled[0]?.terminalUncertainty?.runId, "run-never-committed");
    assert.equal((await readChangeVerification(scope, proof.id))?.state, "needs-review");
  });
});

test("the first reattached run reconciles an expired dispatch fence before target control", async () => {
  await withStateRoot(async () => {
    const proof = await readyProof();
    const input = submit(proof);
    const coordinator = createChangeProofExecutionCoordinator({
      now: () => 500,
      workerId: "replacement-worker",
    });
    const admitted = await coordinator.submit(input);
    await withControlStore((store) => {
      store.updateChangeProofExecution({
        ...admitted,
        status: "running",
        lease: {
          workerId: "stopped-worker",
          token: "stopped-token",
          claimedAt: 300,
          expiresAt: 400,
        },
        cells: [{ ...admitted.cells[0]!, status: "dispatching", updatedAt: 350 }],
        updatedAt: 350,
      });
    });
    let dispatches = 0;
    const result = await coordinator.run(input, async () => {
      dispatches += 1;
      throw new Error("must not dispatch after an expired target fence");
    });
    assert.equal(result.status, "uncertain");
    assert.equal(dispatches, 0);
    assert.equal((await readChangeVerification(scope, proof.id))?.state, "needs-review");
  });
});

test("a canonical passing Run completes the Proof and duplicate requests cannot change its intent", async () => {
  await withStateRoot(async () => {
    const proof = await readyProof();
    const input = submit(proof);
    const coordinator = createChangeProofExecutionCoordinator({
      now: () => 300,
      workerId: "worker:test",
      readRun: async (id) => fakeRun(id),
      projectRun: async ({ run }) => projectedPass((run as { id: string }).id),
      publication: { provider: "github", detailsUrl: "https://relay.example/proofs/test" },
    });
    const admitted = await coordinator.submit(input);
    const repeated = await coordinator.submit(input);
    assert.deepEqual(repeated, admitted);
    await assert.rejects(
      coordinator.submit({
        ...input,
        requestDigest: `sha256:${"c".repeat(64)}`,
      }),
      (error) =>
        error instanceof Error && "code" in error && error.code === "PROOF_EXECUTION_CONFLICT",
    );

    const executed: string[] = [];
    const completed = await coordinator.run(input, async ({ cell }) => {
      executed.push(cell.cellId);
      return {
        runId: "run-pass",
        wait: async () => fakeRun("run-pass"),
      };
    });
    assert.equal(completed.status, "completed");
    assert.equal(completed.cursor, 1);
    assert.deepEqual(completed.runIds, ["run-pass"]);
    assert.deepEqual(executed, ["language__browser-ar"]);
    const storedProof = await readChangeVerification(scope, proof.id);
    assert.equal(storedProof?.state, "proved");
    assert.equal(storedProof?.decision, "proved");
    assert.deepEqual(storedProof?.smallestNextVerification, {
      kind: "none",
      reason: "Every policy-required case has complete proof.",
    });
    const publications = await listChangeProofPublicationOutbox(scope);
    assert.equal(publications.length, 1);
    assert.equal(publications[0]?.proofVersion, storedProof?.version);
    assert.equal(publications[0]?.provider, "github");
    assert.equal(publications[0]?.check.detailsUrl, "https://relay.example/proofs/test");
  });
});

test("the execution deadline fences a hanging canonical Run and invokes cancellation", async () => {
  await withStateRoot(async () => {
    const proof = await readyProof();
    const input = submit(proof);
    const coordinator = createChangeProofExecutionCoordinator({
      now: () => 300,
      maxDurationMs: 10,
      workerId: "worker:test",
    });
    let cancelled = 0;
    const result = await coordinator.run(input, async () => ({
      runId: "run-hanging",
      wait: () => new Promise<never>(() => undefined),
      cancel: () => {
        cancelled += 1;
      },
    }));
    assert.equal(result.status, "uncertain");
    assert.equal(cancelled, 1);
    assert.equal((await readChangeVerification(scope, proof.id))?.state, "needs-review");
  });
});

test("cancellation is a durable fence before the coordinator dispatches the next cell", async () => {
  await withStateRoot(async () => {
    // Reuse the same creation path with a second frozen cell for this
    // lifecycle test; changing the fixture after admission would defeat the
    // coordinator's frozen-plan guarantee.
    const created = await createChangeVerification({
      ...scope,
      id: "proof-execution-cancel-test",
      change: { repository: "acme/settings", baseSha, headSha },
      builds: [
        {
          id: "web-build",
          platform: "web",
          artifactDigest: buildDigest,
          sourceSha: headSha,
          configuration: "production",
          environmentRevision: "fixture-v1",
        },
      ],
      selection: selection(2),
      policy: { id: "relay.default", version: 3 },
      requestedBy: "agent:proof-test",
      actorId: "agent:proof-test",
      requestId: "proof-start-cancel",
      requestDigest,
      at: 100,
    });
    const approved = await advanceChangeVerification({
      ...scope,
      proofId: created.id,
      expectedVersion: created.version,
      state: "ready",
      actorId: "human:reviewer",
      requestId: "proof-approve-cancel",
      requestDigest,
      action: "approve-plan",
      at: 200,
      planApproval: {
        decisionId: "decision-cancel",
        approvedBy: "human:reviewer",
        approvedAt: 200,
        reason: "The exact two-cell matrix is approved.",
      },
      smallestNextVerification: { kind: "run-pilot", reason: "Run the pilot." },
    });
    const input = submit(approved);
    const coordinator = createChangeProofExecutionCoordinator({
      now: () => 300,
      workerId: "worker:test",
      readRun: async (id) => fakeRun(id),
      projectRun: async ({ run }) => projectedPass((run as { id: string }).id),
    });
    let dispatches = 0;
    const result = await coordinator.run(input, async () => {
      dispatches += 1;
      return {
        runId: "run-before-cancel",
        wait: async () => {
          await coordinator.cancel({
            ...scope,
            proofId: approved.id,
            actorId: "runner:proof-test",
            reason: "Stop before required expansion.",
            at: 301,
          });
          return fakeRun("run-before-cancel");
        },
      };
    });
    assert.equal(result.status, "cancelled");
    assert.equal(result.cursor, 0);
    assert.equal(dispatches, 1);
    assert.equal((await readChangeVerification(scope, approved.id))?.state, "cancelled");
  });
});

test("cancellation racing the dispatch fence wins before target control", async () => {
  await withStateRoot(async () => {
    const approved = await readyProof();
    const input = submit(approved);
    let coordinator!: ReturnType<typeof createChangeProofExecutionCoordinator>;
    coordinator = createChangeProofExecutionCoordinator({
      now: () => 300,
      workerId: "worker:dispatch-race",
      readRun: async (id) => fakeRun(id),
      projectRun: async ({ run }) => projectedPass((run as { id: string }).id),
      onDispatchFencePersisted: async () => {
        await coordinator.cancel({
          ...scope,
          proofId: approved.id,
          actorId: "runner:proof-test",
          reason: "Cancel at the final pre-dispatch fence.",
          at: 303,
        });
      },
    });
    let dispatches = 0;
    const result = await coordinator.run(input, async () => {
      dispatches += 1;
      return { runId: "must-not-dispatch", wait: async () => fakeRun("must-not-dispatch") };
    });
    assert.equal(result.status, "cancelled");
    assert.equal(dispatches, 0);
    assert.equal((await readChangeVerification(scope, approved.id))?.state, "cancelled");
  });
});
