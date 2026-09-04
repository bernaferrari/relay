import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ChangeVerification, ExecutionRisk } from "@relay/protocol";
import {
  advanceChangeVerification,
  createChangeVerification,
  readChangeVerification,
} from "./change-verification-store.js";
import {
  ChangeProofConfirmationError,
  changeProofExecutionPreview,
  consumeIssuedChangeProofExecutionConfirmations,
  issueDurableChangeProofExecutionConfirmation,
  validateIssuedChangeProofExecutionConfirmations,
  validateChangeProofExecutionConfirmations,
} from "./change-proof-confirmation.js";
import {
  createChangeProofExecutionCoordinator,
  summarizeChangeProofExecution,
  type ChangeProofExecutionSubmitInput,
} from "./change-proof-execution.js";
import { resetControlDatabaseCache } from "./collaboration-db.js";
import { withControlStore } from "./collaboration-store.js";
import { listChangeProofPublicationOutbox } from "./change-proof-publication-outbox.js";
import { canonicalSha256 } from "./canonical-json.js";
import { normalizeRecord } from "./change-proof-execution-store.js";
import { subscribe } from "./events.js";

const scope = { organizationId: "acme", projectId: "relay" } as const;
const baseSha = "1".repeat(40);
const headSha = "2".repeat(40);
const buildDigest = `sha256:${"a".repeat(64)}` as const;
const requestDigest = `sha256:${"b".repeat(64)}` as const;
const safeExecutionRisk = {
  schemaVersion: 1 as const,
  level: "safe" as const,
  reasons: [],
  externalEffects: [],
  confirmation: "none" as const,
  expectedAppBoundaries: [],
  cleanupRequired: false,
};
const guardedExecutionRisk: ExecutionRisk = {
  ...safeExecutionRisk,
  level: "guarded",
  reasons: [
    {
      stepId: "review-external-app",
      code: "reviewed-external-app",
      explanation: "The reviewed Test communicates with an external app.",
    },
  ],
  externalEffects: ["external-app"],
  confirmation: "once-per-run",
};
const humanOnlyExecutionRisk: ExecutionRisk = {
  ...safeExecutionRisk,
  level: "destructive",
  reasons: [
    {
      stepId: "delete-fixture",
      code: "reviewed-account-mutation",
      explanation: "A person must verify the fixture before deleting it.",
    },
  ],
  externalEffects: ["data-deletion"],
  confirmation: "human-only",
  cleanupRequired: true,
};

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

function selection(
  cellCount = 1,
  executionRisk: ExecutionRisk = safeExecutionRisk,
): ChangeVerification["selection"] {
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
      executionRisk,
      executionRiskDigest: canonicalSha256(executionRisk),
      evidencePolicyDigest: `sha256:${"e".repeat(64)}`,
      cleanupRequired: executionRisk.cleanupRequired,
    },
    {
      id: "language__browser-en",
      journey: { appMapId: "settings", testId: "language", appMapRevision: 4 },
      targetCaseId: "browser-en",
      buildId: "web-build",
      requirement: "required" as const,
      selectionReason: "English is required expansion coverage.",
      dimensions: { locale: "en" },
      executionRisk,
      executionRiskDigest: canonicalSha256(executionRisk),
      evidencePolicyDigest: `sha256:${"e".repeat(64)}`,
      cleanupRequired: executionRisk.cleanupRequired,
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

async function readyProof(
  cellCount = 1,
  executionRisk: ExecutionRisk = safeExecutionRisk,
): Promise<ChangeVerification> {
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
    selection: selection(cellCount, executionRisk),
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
    requestAuthority: {
      subject: "runner:proof-test",
      allowedProjects: [scope.projectId],
      tokenKind: "service",
      localTrusted: false,
      role: "runner",
      actorKind: "agent",
      leaseId: "lease:proof-test",
      leaseOwnerId: "runner:proof-test",
    },
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
    const events: unknown[] = [];
    const unsubscribe = subscribe((event) => {
      if (event.payload.type === "proof.execution.changed") events.push(event.payload);
    });
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
    assert.deepEqual(events, [
      {
        type: "proof.execution.changed",
        at: 300,
        proofId: proof.id,
        executionId: admitted.id,
        cursor: 0,
        status: "queued",
      },
    ]);
    unsubscribe();
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

test("startup recovery autonomously continues a queued Proof from frozen authority", async () => {
  await withStateRoot(async () => {
    const proof = await readyProof();
    const input = submit(proof);
    const beforeRestart = createChangeProofExecutionCoordinator({
      now: () => 300,
      workerId: "worker:before-restart",
    });
    const queued = await beforeRestart.submit(input);
    assert.equal(queued.status, "queued");

    const afterRestart = createChangeProofExecutionCoordinator({
      now: () => 350,
      workerId: "worker:after-restart",
      readRun: async (id) => fakeRun(id),
      projectRun: async ({ run }) => projectedPass((run as { id: string }).id),
    });
    let dispatches = 0;
    const recovered = await afterRestart.recover!(async ({ execution }) => {
      assert.deepEqual(execution.requestAuthority, input.requestAuthority);
      dispatches += 1;
      return { runId: "run-recovered", wait: async () => fakeRun("run-recovered") };
    });
    assert.equal(dispatches, 1);
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0]?.status, "completed");
    assert.equal((await readChangeVerification(scope, proof.id))?.state, "proved");
  });
});

test("restart finalizes an execution whose Run already advanced the Proof before process death", async () => {
  await withStateRoot(async () => {
    const proof = await readyProof();
    const input = submit(proof);
    const beforeRestart = createChangeProofExecutionCoordinator({
      now: () => 300,
      workerId: "worker:before-result-persist",
    });
    const queued = await beforeRestart.submit(input);
    const runningProof = await readChangeVerification(scope, proof.id);
    assert.equal(runningProof?.state, "running-pilot");
    await advanceChangeVerification({
      ...scope,
      proofId: proof.id,
      expectedVersion: runningProof!.version,
      state: "proved",
      actorId: input.actorId,
      requestId: `${queued.id}:record-runs:1`,
      requestDigest,
      action: "record-runs",
      at: 350,
      runIds: ["run-result-persist-crash"],
      evidenceDigests: [requestDigest],
      smallestNextVerification: {
        kind: "none",
        reason: "All required verification passed.",
      },
    });
    await withControlStore((store) => {
      store.updateChangeProofExecution({
        ...queued,
        status: "running",
        lease: {
          workerId: "worker:before-result-persist",
          token: "expired-result-token",
          claimedAt: 300,
          expiresAt: 400,
        },
        cells: [
          {
            ...queued.cells[0]!,
            status: "running",
            runId: "run-result-persist-crash",
            updatedAt: 340,
          },
        ],
        runIds: ["run-result-persist-crash"],
        updatedAt: 340,
      });
    });

    let dispatches = 0;
    const afterRestart = createChangeProofExecutionCoordinator({
      now: () => 500,
      workerId: "worker:after-result-persist",
      readRun: async (id) => fakeRun(id),
      projectRun: async ({ run }) => projectedPass((run as { id: string }).id),
    });
    const recovered = await afterRestart.run(input, async () => {
      dispatches += 1;
      throw new Error("must not redispatch a recovered Run");
    });
    assert.equal(dispatches, 0);
    assert.equal(recovered.status, "completed");
    assert.equal(recovered.cursor, 1);
    assert.equal(recovered.cells[0]?.result?.runId, "run-result-persist-crash");
    assert.equal((await readChangeVerification(scope, proof.id))?.state, "proved");
  });
});

test("restart resumes required coverage when the pilot transition was already applied", async () => {
  await withStateRoot(async () => {
    const proof = await readyProof(2);
    const input = submit(proof);
    const beforeRestart = createChangeProofExecutionCoordinator({
      now: () => 300,
      workerId: "worker:before-pilot-result-persist",
    });
    const queued = await beforeRestart.submit(input);
    const runningProof = await readChangeVerification(scope, proof.id);
    await advanceChangeVerification({
      ...scope,
      proofId: proof.id,
      expectedVersion: runningProof!.version,
      state: "awaiting-expansion",
      actorId: input.actorId,
      requestId: `${queued.id}:await-expansion:1`,
      requestDigest,
      action: "await-expansion",
      at: 350,
      runIds: ["run-pilot-result-persist-crash"],
      evidenceDigests: [requestDigest],
      smallestNextVerification: {
        kind: "expand",
        reason: "The pilot passed; continue required coverage.",
      },
    });
    await withControlStore((store) => {
      store.updateChangeProofExecution({
        ...queued,
        status: "running",
        lease: {
          workerId: "worker:before-pilot-result-persist",
          token: "expired-pilot-token",
          claimedAt: 300,
          expiresAt: 400,
        },
        cells: [
          {
            ...queued.cells[0]!,
            status: "running",
            runId: "run-pilot-result-persist-crash",
            updatedAt: 340,
          },
          queued.cells[1]!,
        ],
        runIds: ["run-pilot-result-persist-crash"],
        updatedAt: 340,
      });
    });

    let dispatches = 0;
    const afterRestart = createChangeProofExecutionCoordinator({
      now: () => 500,
      workerId: "worker:after-pilot-result-persist",
      readRun: async (id) => fakeRun(id),
      projectRun: async ({ run }) => {
        const runId = (run as { id: string }).id;
        return runId === "run-required"
          ? { ...projectedPass(runId), targetCaseId: "browser-en" }
          : projectedPass(runId);
      },
    });
    const recovered = await afterRestart.run(input, async ({ cell }) => {
      dispatches += 1;
      assert.equal(cell.cellId, "language__browser-en");
      return { runId: "run-required", wait: async () => fakeRun("run-required") };
    });
    assert.equal(dispatches, 1);
    assert.equal(recovered.status, "completed");
    assert.equal(recovered.cursor, 2);
    assert.equal((await readChangeVerification(scope, proof.id))?.state, "proved");
  });
});

test("persisted Proof authority rejects remote-to-local trust escalation", async () => {
  await withStateRoot(async () => {
    const proof = await readyProof();
    const coordinator = createChangeProofExecutionCoordinator({ now: () => 300 });
    const queued = await coordinator.submit(submit(proof));
    assert.throws(
      () =>
        normalizeRecord({
          ...queued,
          requestAuthority: {
            ...queued.requestAuthority,
            tokenKind: "service",
            localTrusted: true,
          },
        }),
      /trust mode disagrees with its token kind/u,
    );
  });
});

test("startup recovery retries after another worker's unexpired lease instead of abandoning the Proof", async () => {
  await withStateRoot(async () => {
    const proof = await readyProof();
    const input = submit(proof);
    const beforeRestart = createChangeProofExecutionCoordinator({
      now: () => 300,
      workerId: "worker:before-restart",
    });
    const queued = await beforeRestart.submit(input);
    await withControlStore((store) => {
      store.updateChangeProofExecution({
        ...queued,
        status: "running",
        lease: {
          workerId: "worker:other",
          token: "other-token",
          claimedAt: 300,
          expiresAt: 400,
        },
        updatedAt: 350,
      });
    });

    let now = 350;
    let retry: (() => void) | undefined;
    let retryDelay = -1;
    let dispatches = 0;
    const afterRestart = createChangeProofExecutionCoordinator({
      now: () => now,
      workerId: "worker:after-restart",
      readRun: async (id) => fakeRun(id),
      projectRun: async ({ run }) => projectedPass((run as { id: string }).id),
      recoveryRetryMs: 20,
      scheduleRecoveryRetry: (callback, delayMs) => {
        retry = callback;
        retryDelay = delayMs;
      },
    });
    const first = await afterRestart.recover!(async () => {
      dispatches += 1;
      return { runId: "run-recovered", wait: async () => fakeRun("run-recovered") };
    });
    assert.equal(first[0]?.lease?.workerId, "worker:other");
    assert.equal(dispatches, 0);
    assert.equal(retryDelay, 50);
    assert.ok(retry);

    now = 500;
    retry!();
    // The scheduled callback starts recovery asynchronously. Yield once for
    // its durable reconciliation and execution to complete.
    await new Promise<void>((resolve) => setImmediate(resolve));
    const recovered = await afterRestart.read(scope, proof.id);
    assert.equal(dispatches, 1);
    assert.equal(recovered?.status, "completed");
    assert.equal((await readChangeVerification(scope, proof.id))?.state, "proved");
  });
});

test("execution admission ignores unrelated historical Runs when choosing the next frozen cell", async () => {
  await withStateRoot(async () => {
    const proof = await readyProof();
    const running = await advanceChangeVerification({
      ...scope,
      proofId: proof.id,
      expectedVersion: proof.version,
      state: "running-pilot",
      actorId: "runner:proof-test",
      requestId: "record-unrelated",
      requestDigest,
      action: "record-runs",
      at: 300,
      runIds: ["manual-unrelated-run"],
      smallestNextVerification: { kind: "run-pilot", reason: "Run the pilot." },
    });
    const coordinator = createChangeProofExecutionCoordinator({
      now: () => 400,
      readRun: async () => null,
      projectRun: async ({ run }) => projectedPass((run as { id: string }).id),
    });
    const admitted = await coordinator.submit(submit(running));
    assert.equal(admitted.cursor, 0);
    assert.equal(admitted.cells[0]?.status, "pending");
    assert.deepEqual(admitted.runIds, ["manual-unrelated-run"]);
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

test("confirmation issuance survives a ControlStore restart and rejects forged or replayed receipts", async () => {
  await withStateRoot(async () => {
    const proof = await readyProof(1, guardedExecutionRisk);
    const preview = changeProofExecutionPreview(proof);
    const receipt = await issueDurableChangeProofExecutionConfirmation({
      proof,
      cellId: "language__browser-ar",
      actorId: "human:reviewer",
      actorKind: "human",
      now: 300,
    });
    assert.equal(receipt.previewDigest, preview.previewDigest);
    assert.deepEqual(
      validateChangeProofExecutionConfirmations({
        proof,
        receipts: [receipt],
        actorId: "human:reviewer",
        now: 300,
      }),
      [receipt],
    );

    // Reopening the database is the same durability boundary used by server
    // restart recovery. Issuance provenance must not live only in process
    // memory.
    resetControlDatabaseCache();
    await validateIssuedChangeProofExecutionConfirmations([receipt]);

    const forged = {
      ...receipt,
      previewDigest: `sha256:${"f".repeat(64)}` as `sha256:${string}`,
    };
    await assert.rejects(
      validateIssuedChangeProofExecutionConfirmations([forged]),
      (error) =>
        error instanceof ChangeProofConfirmationError &&
        error.code === "PROOF_CONFIRMATION_INVALID",
    );

    const shortLived = await issueDurableChangeProofExecutionConfirmation({
      proof,
      cellId: "language__browser-ar",
      actorId: "human:reviewer",
      actorKind: "human",
      now: 500,
      ttlMs: 1,
    });
    const renewed = await issueDurableChangeProofExecutionConfirmation({
      proof,
      cellId: "language__browser-ar",
      actorId: "human:reviewer",
      actorKind: "human",
      now: 502,
    });
    assert.notEqual(renewed.receiptId, shortLived.receiptId);
    await validateIssuedChangeProofExecutionConfirmations([renewed]);

    const humanInput = {
      ...submit(proof),
      actorId: "human:reviewer",
      requestAuthority: {
        ...submit(proof).requestAuthority!,
        subject: "human:reviewer",
        actorKind: "human" as const,
      },
      confirmationReceipts: [receipt],
    };
    const coordinator = createChangeProofExecutionCoordinator({
      now: () => 300,
      workerId: "worker:confirmation-restart",
    });
    const admitted = await coordinator.submit(humanInput);
    assert.equal(admitted.confirmationReceipts?.[0]?.receiptId, receipt.receiptId);
    await withControlStore((store) => {
      const stored = store.changeProofConfirmation(receipt.receiptId);
      assert.equal(stored?.consumedAt, 300);
      assert.throws(
        () => consumeIssuedChangeProofExecutionConfirmations(store, [receipt], 301),
        (error) =>
          error instanceof ChangeProofConfirmationError &&
          error.code === "PROOF_CONFIRMATION_REPLAYED",
      );
    });
  });
});

test("human-only execution pauses at an exact step and resumes only through recorded evidence", async () => {
  await withStateRoot(async () => {
    const proof = await readyProof(1, humanOnlyExecutionRisk);
    const input = submit(proof);
    let dispatches = 0;
    const coordinator = createChangeProofExecutionCoordinator({
      now: () => 300,
      workerId: "worker:human-boundary",
      projectRun: async ({ run }) => ({
        ...projectedPass((run as { id: string }).id),
        cleanup: "restored" as const,
      }),
    });
    const paused = await coordinator.run(input, async () => {
      dispatches += 1;
      return { runId: "must-not-run", wait: async () => fakeRun("must-not-run") };
    });
    assert.equal(paused.status, "paused-human");
    assert.deepEqual(paused.humanIntervention, {
      cellId: "language__browser-ar",
      stepId: "delete-fixture",
      effects: ["data-deletion"],
      reason: "A person must verify the fixture before deleting it.",
      at: 300,
    });
    assert.equal(dispatches, 0);

    const evidenceInput = {
      ...scope,
      proofId: proof.id,
      executionId: paused.id,
      cellId: "language__browser-ar",
      stepId: "delete-fixture",
      evidenceDigest: `sha256:${"e".repeat(64)}` as `sha256:${string}`,
      actorId: "human:reviewer",
      requestId: "human-evidence-1",
      at: 400,
    };
    await assert.rejects(
      coordinator.recordHumanInterventionEvidence({
        ...evidenceInput,
        stepId: "different-step",
      }),
      (error) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "PROOF_EXECUTION_HUMAN_INTERVENTION",
    );
    const queued = await coordinator.recordHumanInterventionEvidence(evidenceInput);
    assert.equal(queued.status, "queued");
    assert.equal(queued.humanIntervention, undefined);
    assert.deepEqual(queued.humanInterventionEvidence?.[0], {
      schemaVersion: 1,
      executionId: paused.id,
      proofId: proof.id,
      cellId: "language__browser-ar",
      stepId: "delete-fixture",
      evidenceDigest: `sha256:${"e".repeat(64)}`,
      recordedBy: "human:reviewer",
      recordedAt: 400,
      requestId: "human-evidence-1",
    });
    assert.throws(
      () =>
        normalizeRecord({
          ...queued,
          humanInterventionEvidence: [
            { ...queued.humanInterventionEvidence![0]!, executionId: "other-execution" },
          ],
        }),
      /human intervention evidence .* invalid/iu,
    );
    await assert.rejects(
      coordinator.recordHumanInterventionEvidence(evidenceInput),
      (error) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "PROOF_EXECUTION_HUMAN_INTERVENTION",
    );

    // This executor represents a host that explicitly implements exact
    // checkpoint resume. The default App Map/Test adapter is tested
    // separately and remains fail-closed for this cell.
    const completed = await coordinator.run(input, async ({ cell }) => {
      dispatches += 1;
      assert.equal(cell.cellId, "language__browser-ar");
      return { runId: "human-resumed-run", wait: async () => fakeRun("human-resumed-run") };
    });
    assert.equal(completed.status, "completed");
    assert.equal(dispatches, 1);
    assert.deepEqual(
      completed.humanInterventionEvidence?.map((item) => item.stepId),
      ["delete-fixture"],
    );
  });
});
