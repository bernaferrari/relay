import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ApiError, RelayClient } from "@relay/client";
import {
  advanceChangeVerification,
  claimChangeProofPublicationOutbox,
  canonicalSha256,
  compileVerificationPlan,
  createChangeProofExecutionCoordinator,
  markChangeProofPublicationRetry,
  recordChangeProofPublication,
  resetControlDatabaseCache,
} from "@relay/core";
import {
  verificationPlanSchema,
  type ChangeProofCaseResult,
  type ChangeVerification,
  type OperationInput,
} from "@relay/protocol";
import type { PersistedRun } from "@relay/core";
import { startServer } from "./index.js";

const organizationId = "acme";
const projectId = "relay";
const baseSha = "1".repeat(40);
const headSha = "2".repeat(40);
const repairedHeadSha = "3".repeat(40);
const digest = `sha256:${"a".repeat(64)}`;
const safeExecutionRisk = {
  schemaVersion: 1 as const,
  level: "safe" as const,
  reasons: [],
  externalEffects: [],
  confirmation: "none" as const,
  expectedAppBoundaries: [],
  cleanupRequired: false,
};
const guardedExecutionRisk = {
  ...safeExecutionRisk,
  level: "guarded" as const,
  reasons: [
    {
      stepId: "review-external-app",
      code: "reviewed-external-app",
      explanation: "The reviewed Test communicates with an external app.",
    },
  ],
  externalEffects: ["external-app" as const],
  confirmation: "once-per-run" as const,
};
const humanOnlyExecutionRisk = {
  ...safeExecutionRisk,
  level: "destructive" as const,
  reasons: [
    {
      stepId: "delete-fixture",
      code: "reviewed-account-mutation",
      explanation: "A person must verify the fixture before deleting it.",
    },
  ],
  externalEffects: ["data-deletion" as const],
  confirmation: "human-only" as const,
  cleanupRequired: true,
};

function client(
  port: number,
  project = projectId,
  actor: "agent" | "human" = "agent",
): RelayClient {
  return new RelayClient({
    url: `http://127.0.0.1:${port}`,
    auth: { type: "none" },
    organizationId,
    projectId: project,
    actorId: actor === "human" ? "human:reviewer" : "agent:coder",
    actorKind: actor,
  });
}

function selection(): ChangeVerification["selection"] {
  return {
    affectedJourneys: [
      {
        appMapId: "settings",
        testId: "settings-language",
        appMapRevision: 7,
        reason: "The changed localization resource is bound to this Test.",
        confidence: "definite",
      },
    ],
    targetCases: [
      {
        id: "chromium-compact-ar",
        executionTarget: {
          schemaVersion: 1,
          kind: "local-browser",
          provider: { key: "relay.local.browser", scope: "local" },
          targetId: "web",
          platform: "browser",
          identity: { kind: "browser-target", value: "web" },
        },
        targetProfile: {
          id: "web:compact:ar",
          targetId: "web",
          source: "browser",
          platform: "browser",
          name: "Compact Chromium Arabic",
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
          capabilities: ["snapshot", "screenshot", "tap", "type"],
          observedAt: 100,
        },
        dimensions: { locale: "ar", viewport: "compact" },
        required: true,
      },
    ],
    cells: [
      {
        id: "cell-settings-chromium",
        journey: { appMapId: "settings", testId: "settings-language", appMapRevision: 7 },
        targetCaseId: "chromium-compact-ar",
        buildId: "web",
        requirement: "required",
        selectionReason: "Compact Arabic web is required coverage.",
        dimensions: { locale: "ar", viewport: "compact" },
        executionRisk: safeExecutionRisk,
        executionRiskDigest: canonicalSha256(safeExecutionRisk),
        evidencePolicyDigest: `sha256:${"e".repeat(64)}`,
        cleanupRequired: false,
      },
    ],
    pilotCellId: "cell-settings-chromium",
  };
}

function startInput(): OperationInput<"proof.start"> {
  return {
    change: {
      repository: "acme/settings",
      baseSha,
      headSha,
      pullRequest: 184,
      agentClaim: {
        summary: "Implemented Arabic settings",
        acceptanceCriteria: ["Settings render in Arabic without RTL overlap"],
      },
    },
    builds: [
      {
        id: "web",
        platform: "web",
        artifactDigest: digest,
        sourceSha: headSha,
        configuration: "production",
        environmentRevision: "fixture-v1",
      },
    ],
    selection: selection(),
    policy: { id: "relay.default", version: 3 },
  };
}

function startInputWithRisk(
  executionRisk: typeof guardedExecutionRisk | typeof humanOnlyExecutionRisk,
): OperationInput<"proof.start"> {
  const input = startInput();
  const selection = input.selection!;
  return {
    ...input,
    selection: {
      ...selection,
      cells: selection.cells?.map((cell) => ({
        ...cell,
        executionRisk,
        executionRiskDigest: canonicalSha256(executionRisk),
        cleanupRequired: executionRisk.cleanupRequired,
      })),
    },
  };
}

function preparedPlan() {
  const start = startInput();
  const plan = compileVerificationPlan({
    change: start.change,
    changed: {
      files: ["src/settings/language.ts"],
      symbols: [],
      routes: [],
      resources: [],
      localizationKeys: [],
      apiContracts: [],
    },
    associations: [
      {
        id: "settings-language-source",
        appMapId: "settings",
        testId: "settings-language",
        signals: {
          files: ["src/settings"],
          symbols: [],
          routes: [],
          resources: [],
          localizationKeys: [],
          apiContracts: [],
        },
        confidence: "definite",
        reason: "Settings source is reviewed coverage for this journey.",
        review: {
          status: "reviewed",
          revision: 1,
          reviewedBy: "human:reviewer",
          reviewedAt: 1,
        },
      },
    ],
    builds: start.builds ?? [],
    targetCases: start.selection?.targetCases ?? [],
    cells: start.selection?.cells ?? [],
    pilotCellId: start.selection?.pilotCellId,
    policy: start.policy,
  });
  return verificationPlanSchema.parse({
    ...plan,
    selection: {
      ...plan.selection,
      affectedJourneys: plan.selection.affectedJourneys.map((journey) => ({
        ...journey,
        appMapRevision: 7,
      })),
    },
  });
}

test("proof.prepare derives one active Proof identity independent of caller request ids", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-proof-prepare-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  resetControlDatabaseCache();
  const plan = preparedPlan();
  let prepares = 0;
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    proofRouteRuntime: {
      prepare: async ({ request }) => {
        prepares += 1;
        assert.deepEqual(request, { baseRef: "origin/main" });
        return { plan, blockers: [] };
      },
    },
  });
  const relay = client(server.port);
  try {
    const first = await relay.invoke(
      "proof.prepare",
      { baseRef: "origin/main" },
      { requestId: "prepare-first" },
    );
    assert.equal(first.disposition, "created");
    assert.equal(first.nextAction.kind, "approve-plan");
    assert.deepEqual(first.blockers, []);
    assert.deepEqual(first.plan, plan);

    const second = await relay.invoke(
      "proof.prepare",
      { baseRef: "origin/main" },
      { requestId: "prepare-second" },
    );
    assert.equal(second.disposition, "existing");
    assert.equal(second.proof.id, first.proof.id);
    assert.equal(prepares, 2);

    await assert.rejects(
      relay.invoke("proof.prepare", { baseRef: "origin/main", headSha } as never, {
        requestId: "forged",
      }),
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes("Unrecognized key") &&
        error.message.includes("headSha"),
    );
  } finally {
    await server.close();
    resetControlDatabaseCache();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("Proof routes share one scoped, idempotent, versioned lifecycle", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-proof-routes-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  resetControlDatabaseCache();
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  const relay = client(server.port);
  const reviewer = client(server.port, projectId, "human");
  try {
    const created = await relay.invoke("proof.start", startInput(), { requestId: "proof-request" });
    assert.equal(created.disposition, "created");
    assert.equal(created.proof.state, "planning");
    assert.equal(created.receipt.action, "start");

    const repeated = await relay.invoke("proof.start", startInput(), {
      requestId: "proof-request",
    });
    assert.equal(repeated.disposition, "existing");
    assert.deepEqual(repeated.proof, created.proof);

    const listed = await relay.invoke("proof.list", {});
    assert.deepEqual(
      listed.proofs.map(({ id }) => id),
      [created.proof.id],
    );
    const inspected = await relay.invoke("proof.inspect", {
      proofId: created.proof.id,
      includeHistory: true,
    });
    assert.equal(inspected.proof.version, 1);
    assert.equal(inspected.history?.length, 1);
    assert.deepEqual(inspected.publications, []);
    assert.equal((await client(server.port, "other").invoke("proof.list", {})).proofs.length, 0);

    const reviewRequested = await relay.invoke(
      "proof.continue",
      {
        proofId: created.proof.id,
        expectedVersion: created.proof.version,
        action: "request-plan-review",
        reason: "A person must review the initial frozen plan.",
      },
      { requestId: "review-request" },
    );
    await assert.rejects(
      relay.invoke(
        "proof.continue",
        {
          proofId: created.proof.id,
          expectedVersion: created.proof.version,
          action: "request-plan-review",
          reason: "A changed reason cannot reuse the request identity.",
        },
        { requestId: "review-request" },
      ),
      (error) => error instanceof ApiError && error.status === 409,
    );
    const replanning = await relay.invoke(
      "proof.continue",
      {
        proofId: created.proof.id,
        expectedVersion: reviewRequested.proof.version,
        action: "return-to-planning",
        reason: "The plan is ready for explicit approval.",
      },
      { requestId: "return-request" },
    );
    assert.equal(replanning.proof.planApproval, undefined);

    await assert.rejects(
      relay.invoke(
        "proof.plan.approve",
        {
          proofId: created.proof.id,
          expectedVersion: replanning.proof.version,
          decisionId: "decision-agent",
          reason: "An agent cannot approve its own Verification Plan.",
          confirm: true,
        },
        { requestId: "agent-approve-request" },
      ),
      (error) => error instanceof ApiError && error.status === 403,
    );

    const approved = await reviewer.invoke(
      "proof.plan.approve",
      {
        proofId: created.proof.id,
        expectedVersion: replanning.proof.version,
        decisionId: "decision-1",
        reason: "The plan covers the changed localization path and compact browser target.",
        confirm: true,
      },
      { requestId: "approve-request" },
    );
    assert.equal(approved.proof.state, "ready");
    assert.equal(approved.proof.planApproval?.approvedBy, "human:reviewer");
    assert.equal(approved.receipt.previousVersion, replanning.proof.version);

    const repeatedApproval = await reviewer.invoke(
      "proof.plan.approve",
      {
        proofId: created.proof.id,
        expectedVersion: replanning.proof.version,
        decisionId: "decision-1",
        reason: "The plan covers the changed localization path and compact browser target.",
        confirm: true,
      },
      { requestId: "approve-request" },
    );
    assert.deepEqual(repeatedApproval, approved);
    await assert.rejects(
      reviewer.invoke(
        "proof.plan.approve",
        {
          proofId: created.proof.id,
          expectedVersion: replanning.proof.version,
          decisionId: "decision-1",
          reason: "A different intent must not reuse the same request identity.",
          confirm: true,
        },
        { requestId: "approve-request" },
      ),
      (error) => error instanceof ApiError && error.status === 409,
    );

    await assert.rejects(
      relay.invoke(
        "proof.cancel",
        {
          proofId: created.proof.id,
          expectedVersion: created.proof.version,
          reason: "stale",
          confirm: true,
        },
        { requestId: "stale-cancel" },
      ),
      (error) => error instanceof ApiError && error.status === 409,
    );

    await assert.rejects(
      relay.invoke(
        "proof.rerun-affected",
        {
          proofId: approved.proof.id,
          expectedVersion: approved.proof.version,
          change: {
            ...approved.proof.change,
            baseSha: headSha,
            headSha: repairedHeadSha,
          },
        },
        { requestId: "active-rerun-request" },
      ),
      (error) =>
        error instanceof ApiError && error.status === 409 && error.body.code === "PROOF_IMMUTABLE",
    );
    const running = await advanceChangeVerification({
      organizationId,
      projectId,
      proofId: approved.proof.id,
      expectedVersion: approved.proof.version,
      state: "running-pilot",
      actorId: "agent:relay",
      requestId: "lifecycle-start-pilot",
      requestDigest: digest,
      action: "start-pilot",
      at: Date.now(),
      runIds: ["run-lifecycle"],
      evidenceDigests: [digest],
    });
    const completed = await advanceChangeVerification({
      organizationId,
      projectId,
      proofId: running.id,
      expectedVersion: running.version,
      state: "rejected",
      actorId: "agent:relay",
      requestId: "lifecycle-reject",
      requestDigest: digest,
      action: "record-decision",
      at: Date.now() + 1,
    });

    const rerun = await relay.invoke(
      "proof.rerun-affected",
      {
        proofId: completed.id,
        expectedVersion: completed.version,
        change: {
          ...completed.change,
          baseSha: headSha,
          headSha: repairedHeadSha,
        },
        policy: completed.policy,
      },
      { requestId: "rerun-request" },
    );
    assert.equal(rerun.previous.state, "superseded");
    assert.equal(rerun.replacement.state, "awaiting-build");
    assert.equal(rerun.replacement.supersedesProofId, created.proof.id);
    assert.equal(rerun.receipt.action, "rerun-affected");
    await assert.rejects(
      relay.invoke(
        "proof.rerun-affected",
        {
          proofId: completed.id,
          expectedVersion: completed.version,
          change: {
            ...completed.change,
            baseSha: headSha,
            headSha: "4".repeat(40),
          },
        },
        { requestId: "rerun-request" },
      ),
      (error) => error instanceof ApiError && error.status === 409,
    );

    const cancelled = await relay.invoke(
      "proof.cancel",
      {
        proofId: rerun.replacement.id,
        expectedVersion: rerun.replacement.version,
        reason: "The pull request was closed.",
        confirm: true,
      },
      { requestId: "cancel-request" },
    );
    assert.equal(cancelled.proof.state, "cancelled");
    assert.equal(cancelled.proof.cancellation?.reason, "The pull request was closed.");
    assert.equal(cancelled.proof.cancellation?.cancelledBy, "agent:coder");
    await assert.rejects(
      relay.invoke(
        "proof.cancel",
        {
          proofId: rerun.replacement.id,
          expectedVersion: rerun.replacement.version,
          reason: "A changed cancellation cannot reuse the request identity.",
          confirm: true,
        },
        { requestId: "cancel-request" },
      ),
      (error) => error instanceof ApiError && error.status === 409,
    );
  } finally {
    await server.close();
    resetControlDatabaseCache();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("Proof start rejects reuse of one request id for another change", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-proof-conflict-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  resetControlDatabaseCache();
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  const relay = client(server.port);
  try {
    await relay.invoke("proof.start", startInput(), { requestId: "same-request" });
    await assert.rejects(
      relay.invoke(
        "proof.start",
        {
          ...startInput(),
          change: { ...startInput().change, pullRequest: 185 },
        },
        { requestId: "same-request" },
      ),
      (error) => error instanceof ApiError && error.status === 409,
    );
  } finally {
    await server.close();
    resetControlDatabaseCache();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("Verification Plan approval fails closed while impact coverage gaps remain", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-proof-coverage-gap-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  resetControlDatabaseCache();
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  const relay = client(server.port);
  const reviewer = client(server.port, projectId, "human");
  try {
    const created = await relay.invoke(
      "proof.start",
      {
        ...startInput(),
        coverageGaps: ["No reviewed user journey is associated with src/shared/unknown.ts."],
      },
      { requestId: "coverage-gap-proof" },
    );
    await assert.rejects(
      reviewer.invoke(
        "proof.plan.approve",
        {
          proofId: created.proof.id,
          expectedVersion: created.proof.version,
          decisionId: "decision-gap",
          reason: "This must not override an unknown impact gap.",
          confirm: true,
        },
        { requestId: "coverage-gap-approval" },
      ),
      (error) =>
        error instanceof ApiError &&
        error.status === 409 &&
        JSON.stringify(error.body).includes("PROOF_COVERAGE_GAPS"),
    );
  } finally {
    await server.close();
    resetControlDatabaseCache();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("Proof execution records only server-derived Run facts and advances pilot to required coverage", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-proof-execution-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  resetControlDatabaseCache();
  const runs = new Map<string, PersistedRun & { targetCaseId: string }>();
  const published: Array<{ state: ChangeVerification["state"]; headSha: string }> = [];
  const scopedRun = (id: string, targetCaseId: string) =>
    ({
      id,
      projectId,
      targetCaseId,
      executionProvenance: {
        schemaVersion: 1,
        actorId: "agent:relay",
        actorKind: "agent",
        organizationId,
        projectId,
        operationId: "app-map.test.run",
        requestId: `request-${id}`,
        issuedAt: 1,
      },
    }) as PersistedRun & { targetCaseId: string };
  const caseResultFromRun = async (input: {
    proof: ChangeVerification;
    run: PersistedRun & { targetCaseId: string };
  }): Promise<ChangeProofCaseResult> => ({
    appMapId: "settings",
    testId: "settings-language",
    targetCaseId: input.run.targetCaseId,
    runId: input.run.id,
    sourceSha: input.proof.change.headSha,
    buildId: "web",
    artifactDigest: digest,
    outcome: "passed",
    evidenceDigests: [`sha256:${input.run.id === "pilot-run" ? "b" : "c"}${"0".repeat(63)}`],
    evidenceComplete: true,
    selectorResolution: "deterministic",
    inputOutcome: "reconciled",
    cleanup: "restored",
  });
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    proofRouteRuntime: {
      readRun: async (id) => runs.get(id) ?? null,
      caseResultFromRun: caseResultFromRun as never,
      publishTerminal: async ({ proof, intent, scope }) => {
        published.push({ state: proof.state, headSha: proof.change.headSha });
        // Acknowledge progress updates so the ordered outbox can reach the
        // terminal version. Deliberately omit the terminal receipt to retain
        // this test's reconciliation/recovery exercise.
        if (intent.check.status !== "completed") {
          await recordChangeProofPublication({
            ...scope,
            proofId: intent.proofId,
            proofVersion: intent.proofVersion,
            repository: intent.repository,
            check: intent.check,
            provider: "github",
            checkRunId: 42,
            externalId: intent.externalId,
            headSha: intent.headSha,
            publishedAt: Date.now(),
          });
        }
      },
    },
  });
  const relay = client(server.port);
  const reviewer = client(server.port, projectId, "human");
  try {
    const initial = startInput();
    const revisionless = await relay.invoke(
      "proof.start",
      {
        ...initial,
        change: { ...initial.change, pullRequest: 183 },
        selection: {
          ...initial.selection!,
          affectedJourneys: initial.selection!.affectedJourneys.map(
            ({ appMapRevision: _revision, ...journey }) => journey,
          ),
          cells: initial.selection!.cells!.map((cell) => ({
            ...cell,
            journey: (({ appMapRevision: _revision, ...journey }) => journey)(cell.journey),
          })),
        },
      },
      { requestId: "revisionless-proof-start" },
    );
    await assert.rejects(
      reviewer.invoke(
        "proof.plan.approve",
        {
          proofId: revisionless.proof.id,
          expectedVersion: revisionless.proof.version,
          decisionId: "revisionless-plan",
          reason: "Historical plan fixture without an App Map revision.",
          confirm: true,
        },
        { requestId: "revisionless-plan-approve" },
      ),
      (error) => error instanceof ApiError && error.status === 409,
    );
    const secondCase = {
      ...initial.selection!.targetCases[0]!,
      id: "chromium-desktop-ar",
      dimensions: { locale: "ar", viewport: "desktop" },
    };
    const created = await relay.invoke(
      "proof.start",
      {
        ...initial,
        selection: {
          ...initial.selection!,
          targetCases: [initial.selection!.targetCases[0]!, secondCase],
          cells: [
            ...initial.selection!.cells!,
            {
              ...initial.selection!.cells![0]!,
              id: "cell-settings-desktop",
              targetCaseId: secondCase.id,
              selectionReason: "Desktop Arabic web is required expansion coverage.",
              dimensions: secondCase.dimensions,
            },
          ],
        },
      },
      { requestId: "execution-proof-start" },
    );
    const approved = await reviewer.invoke(
      "proof.plan.approve",
      {
        proofId: created.proof.id,
        expectedVersion: created.proof.version,
        decisionId: "execution-plan",
        reason: "Reviewed the exact pilot and expansion target cases.",
        confirm: true,
      },
      { requestId: "execution-plan-approve" },
    );
    const runningPilot = await relay.invoke(
      "proof.continue",
      {
        proofId: approved.proof.id,
        expectedVersion: approved.proof.version,
        action: "start-pilot",
        reason: "Start one representative case before expansion.",
      },
      { requestId: "execution-start-pilot" },
    );
    assert.equal(runningPilot.proof.state, "running-pilot");
    runs.set("unscoped-run", {
      id: "unscoped-run",
      projectId,
      targetCaseId: "chromium-compact-ar",
    } as PersistedRun & { targetCaseId: string });
    await assert.rejects(
      relay.invoke(
        "proof.continue",
        {
          proofId: runningPilot.proof.id,
          expectedVersion: runningPilot.proof.version,
          action: "record-runs",
          runIds: ["unscoped-run"],
        },
        { requestId: "execution-reject-unscoped-run" },
      ),
      (error) => error instanceof ApiError && error.status === 409,
    );
    runs.set("pilot-run", scopedRun("pilot-run", "chromium-compact-ar"));
    const awaitingExpansion = await relay.invoke(
      "proof.continue",
      {
        proofId: runningPilot.proof.id,
        expectedVersion: runningPilot.proof.version,
        action: "record-runs",
        runIds: ["pilot-run"],
      },
      { requestId: "execution-record-pilot" },
    );
    assert.equal(awaitingExpansion.proof.state, "awaiting-expansion");
    assert.deepEqual(awaitingExpansion.proof.runIds, ["pilot-run"]);

    await assert.rejects(
      relay.invoke(
        "proof.continue",
        {
          proofId: awaitingExpansion.proof.id,
          expectedVersion: awaitingExpansion.proof.version,
          action: "record-runs",
          runIds: ["forged-run"],
          verdict: "passed",
        } as never,
        { requestId: "execution-forged-verdict" },
      ),
    );

    const running = await relay.invoke(
      "proof.continue",
      {
        proofId: awaitingExpansion.proof.id,
        expectedVersion: awaitingExpansion.proof.version,
        action: "start-required-coverage",
        reason: "Run the remaining required target case.",
      },
      { requestId: "execution-start-expansion" },
    );
    runs.set("expansion-run", scopedRun("expansion-run", "chromium-desktop-ar"));
    const proved = await relay.invoke(
      "proof.continue",
      {
        proofId: running.proof.id,
        expectedVersion: running.proof.version,
        action: "record-runs",
        runIds: ["expansion-run"],
      },
      { requestId: "execution-record-expansion" },
    );
    assert.equal(proved.proof.state, "proved");
    assert.equal(proved.proof.decision, "proved");
    assert.deepEqual(proved.proof.runIds, ["pilot-run", "expansion-run"]);
    assert.ok(published.length >= 1);
    assert.ok(
      published.every((publication) => publication.headSha === headSha),
      "at-least-once progress and terminal retries retain the exact Proof head",
    );
    const pendingPublication = await relay.invoke("proof.inspect", {
      proofId: proved.proof.id,
      includeHistory: false,
    });
    assert.ok(pendingPublication.publications.length >= 1);
    assert.ok(
      pendingPublication.publications.every((receipt) => receipt.status !== "completed"),
      "the deliberately unacknowledged terminal update has no forged receipt",
    );
    const terminalPublication = pendingPublication.publicationOutbox.find(
      (record) => record.proofVersion === proved.proof.version,
    );
    assert.ok(terminalPublication);
    assert.equal(terminalPublication.status, "retry");
    assert.equal(terminalPublication.lastFailure?.kind, "reconciliation-error");

    let exhausted = terminalPublication;
    while (exhausted.attempts < exhausted.maxAttempts) {
      const claimed = await claimChangeProofPublicationOutbox({
        organizationId,
        projectId,
        id: exhausted.id,
        workerId: "route-recovery-fixture",
        now: Date.now() + 1_000_000,
      });
      assert.ok(claimed?.lease);
      exhausted = await markChangeProofPublicationRetry({
        organizationId,
        projectId,
        id: exhausted.id,
        workerId: claimed.lease.workerId,
        leaseToken: claimed.lease.token,
        backoffMs: 0,
        at: Date.now() - 1,
        kind: "provider-error",
      });
    }
    const recoveredPublication = await relay.invoke(
      "proof.publication.retry",
      {
        proofId: proved.proof.id,
        publicationId: exhausted.id,
        expectedProofVersion: exhausted.proofVersion,
        reason: "GitHub connectivity has been restored.",
        confirm: true,
      },
      { requestId: "retry-exhausted-publication" },
    );
    assert.equal(recoveredPublication.disposition, "accepted");
    assert.equal(recoveredPublication.publication.id, exhausted.id);
    assert.equal(recoveredPublication.publication.proofVersion, exhausted.proofVersion);
    assert.deepEqual(recoveredPublication.publication.check, exhausted.check);
    assert.equal(recoveredPublication.publication.maxAttempts, exhausted.maxAttempts + 1);
    assert.equal(recoveredPublication.publication.attempts, exhausted.attempts + 1);
    assert.equal(recoveredPublication.publication.recovery?.requestedBy, "agent:coder");
    const repeatedRecovery = await relay.invoke(
      "proof.publication.retry",
      {
        proofId: proved.proof.id,
        publicationId: exhausted.id,
        expectedProofVersion: exhausted.proofVersion,
        reason: "GitHub connectivity has been restored.",
        confirm: true,
      },
      { requestId: "retry-exhausted-publication" },
    );
    assert.deepEqual(repeatedRecovery, recoveredPublication);
    await assert.rejects(
      relay.invoke(
        "proof.publication.retry",
        {
          proofId: proved.proof.id,
          publicationId: exhausted.id,
          expectedProofVersion: exhausted.proofVersion,
          reason: "A changed intent cannot reuse the request id.",
          confirm: true,
        },
        { requestId: "retry-exhausted-publication" },
      ),
      (error) => error instanceof ApiError && error.status === 409,
    );

    const repeatedProved = await relay.invoke(
      "proof.continue",
      {
        proofId: running.proof.id,
        expectedVersion: running.proof.version,
        action: "record-runs",
        runIds: ["expansion-run"],
      },
      { requestId: "execution-record-expansion" },
    );
    assert.equal(repeatedProved.proof.state, "proved");
    assert.ok(published.every((publication) => publication.headSha === headSha));

    const soloCreated = await relay.invoke(
      "proof.start",
      { ...initial, change: { ...initial.change, pullRequest: 185 } },
      { requestId: "solo-proof-start" },
    );
    const soloApproved = await reviewer.invoke(
      "proof.plan.approve",
      {
        proofId: soloCreated.proof.id,
        expectedVersion: soloCreated.proof.version,
        decisionId: "solo-plan",
        reason: "The single target case is the complete required matrix.",
        confirm: true,
      },
      { requestId: "solo-plan-approve" },
    );
    const soloRunning = await relay.invoke(
      "proof.continue",
      {
        proofId: soloApproved.proof.id,
        expectedVersion: soloApproved.proof.version,
        action: "start-pilot",
        reason: "Run the only required case.",
      },
      { requestId: "solo-start-pilot" },
    );
    runs.set("solo-run", scopedRun("solo-run", "chromium-compact-ar"));
    const soloProved = await relay.invoke(
      "proof.continue",
      {
        proofId: soloRunning.proof.id,
        expectedVersion: soloRunning.proof.version,
        action: "record-runs",
        runIds: ["solo-run"],
      },
      { requestId: "solo-record-pilot" },
    );
    assert.equal(soloProved.proof.state, "proved");
    assert.deepEqual(published.at(-1), { state: "proved", headSha });
    await assert.rejects(
      relay.invoke(
        "proof.continue",
        {
          proofId: soloProved.proof.id,
          expectedVersion: soloProved.proof.version,
          action: "start-required-coverage",
          reason: "There should be no expansion after a complete pilot.",
        },
        { requestId: "solo-start-expansion" },
      ),
      (error) => error instanceof ApiError && error.status === 409,
    );
  } finally {
    await server.close();
    resetControlDatabaseCache();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("proof.run is a durable server operation and proof.inspect recovers its execution summary", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-proof-run-route-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  resetControlDatabaseCache();
  let dispatches = 0;
  const coordinator = createChangeProofExecutionCoordinator({
    workerId: "worker:route-test",
    projectRun: async ({ run }) => ({
      appMapId: "settings",
      testId: "settings-language",
      targetCaseId: "chromium-compact-ar",
      runId: (run as { id: string }).id,
      sourceSha: headSha,
      buildId: "web",
      artifactDigest: digest,
      outcome: "passed",
      evidenceDigests: [`sha256:${"b".repeat(64)}`],
      evidenceComplete: true,
      selectorResolution: "deterministic",
      inputOutcome: "reconciled",
      cleanup: "not-required",
    }),
  });
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    proofRouteRuntime: {
      executionCoordinator: coordinator,
      executeCell: async () => {
        dispatches += 1;
        return { runId: "proof-route-run", wait: async () => ({ id: "proof-route-run" }) as never };
      },
    },
  });
  const relay = client(server.port);
  const reviewer = client(server.port, projectId, "human");
  try {
    const created = await relay.invoke("proof.start", startInput(), {
      requestId: "route-run-start",
    });
    const approved = await reviewer.invoke(
      "proof.plan.approve",
      {
        proofId: created.proof.id,
        expectedVersion: created.proof.version,
        decisionId: "route-run-approval",
        reason: "The exact target and build are approved.",
        confirm: true,
      },
      { requestId: "route-run-approval" },
    );
    const ran = await relay.invoke(
      "proof.run",
      { proofId: approved.proof.id, expectedVersion: approved.proof.version, wait: true },
      { requestId: "route-run" },
    );
    assert.equal(ran.proof.state, "proved");
    assert.equal(ran.proof.smallestNextVerification?.kind, "none");
    assert.equal(ran.execution.status, "completed");
    assert.equal(ran.execution.cursor, ran.execution.total);
    assert.equal(dispatches, 1);
    const inspected = await relay.invoke("proof.inspect", { proofId: ran.proof.id });
    assert.deepEqual(inspected.execution, ran.execution);
  } finally {
    await server.close();
    resetControlDatabaseCache();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("proof.cancel fences an active route execution before target dispatch", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-proof-cancel-route-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  resetControlDatabaseCache();
  let dispatches = 0;
  let signalFence!: () => void;
  const fence = new Promise<void>((resolve) => (signalFence = resolve));
  let releaseFence!: () => void;
  const release = new Promise<void>((resolve) => (releaseFence = resolve));
  const coordinator = createChangeProofExecutionCoordinator({
    workerId: "worker:cancel-route-test",
    onDispatchFencePersisted: async () => {
      signalFence();
      await release;
    },
  });
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    proofRouteRuntime: {
      executionCoordinator: coordinator,
      executeCell: async () => {
        dispatches += 1;
        return { runId: "must-not-run", wait: async () => ({ id: "must-not-run" }) as never };
      },
    },
  });
  const relay = client(server.port);
  const reviewer = client(server.port, projectId, "human");
  try {
    const created = await relay.invoke("proof.start", startInput(), {
      requestId: "cancel-route-start",
    });
    const approved = await reviewer.invoke(
      "proof.plan.approve",
      {
        proofId: created.proof.id,
        expectedVersion: created.proof.version,
        decisionId: "cancel-route-approval",
        reason: "The exact target and build are approved.",
        confirm: true,
      },
      { requestId: "cancel-route-approval" },
    );
    await relay.invoke(
      "proof.run",
      { proofId: approved.proof.id, expectedVersion: approved.proof.version, wait: false },
      { requestId: "cancel-route-run" },
    );
    await fence;
    const current = await relay.invoke("proof.inspect", { proofId: approved.proof.id });
    await assert.rejects(
      relay.invoke(
        "proof.continue",
        {
          proofId: current.proof.id,
          expectedVersion: current.proof.version,
          action: "request-plan-review",
          reason: "Review should not race the active target execution.",
        },
        { requestId: "cancel-route-review" },
      ),
      (error) =>
        error instanceof ApiError &&
        error.status === 409 &&
        error.body.code === "PROOF_EXECUTION_ACTIVE",
    );
    await assert.rejects(
      relay.invoke(
        "proof.rerun-affected",
        {
          proofId: current.proof.id,
          expectedVersion: current.proof.version,
          change: {
            ...current.proof.change,
            baseSha: headSha,
            headSha: repairedHeadSha,
          },
        },
        { requestId: "cancel-route-rerun" },
      ),
      (error) =>
        error instanceof ApiError &&
        error.status === 409 &&
        error.body.code === "PROOF_EXECUTION_ACTIVE",
    );
    const cancelled = await relay.invoke(
      "proof.cancel",
      {
        proofId: current.proof.id,
        expectedVersion: current.proof.version,
        reason: "Stop before target dispatch.",
        confirm: true,
      },
      { requestId: "cancel-route-cancel" },
    );
    assert.equal(cancelled.proof.state, "cancelled");
    releaseFence();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const inspected = await relay.invoke("proof.inspect", { proofId: approved.proof.id });
    assert.equal(inspected.execution?.status, "cancelled");
    assert.equal(dispatches, 0);
  } finally {
    releaseFence();
    await server.close();
    resetControlDatabaseCache();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("proof.run confirmation admits guarded cells only with a durable human receipt", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-proof-confirmation-route-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  resetControlDatabaseCache();
  let dispatches = 0;
  const coordinator = createChangeProofExecutionCoordinator({
    workerId: "worker:confirmation-route",
    projectRun: async ({ run }) => ({
      appMapId: "settings",
      testId: "settings-language",
      targetCaseId: "chromium-compact-ar",
      runId: (run as { id: string }).id,
      sourceSha: headSha,
      buildId: "web",
      artifactDigest: digest,
      outcome: "passed",
      evidenceDigests: [`sha256:${"b".repeat(64)}`],
      evidenceComplete: true,
      selectorResolution: "deterministic",
      inputOutcome: "reconciled",
      cleanup: "not-required",
    }),
  });
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    proofRouteRuntime: {
      executionCoordinator: coordinator,
      executeCell: async () => {
        dispatches += 1;
        return {
          runId: "guarded-route-run",
          wait: async () => ({ id: "guarded-route-run" }) as never,
        };
      },
    },
  });
  const relay = client(server.port);
  const reviewer = client(server.port, projectId, "human");
  try {
    const created = await relay.invoke("proof.start", startInputWithRisk(guardedExecutionRisk), {
      requestId: "guarded-confirm-start",
    });
    const approved = await reviewer.invoke(
      "proof.plan.approve",
      {
        proofId: created.proof.id,
        expectedVersion: created.proof.version,
        decisionId: "guarded-confirm-approval",
        reason: "The guarded external-app effect is explicitly reviewed.",
        confirm: true,
      },
      { requestId: "guarded-confirm-approval" },
    );
    const inspected = await relay.invoke("proof.inspect", { proofId: approved.proof.id });
    const preview = inspected.executionPreview!;
    const cell = preview.cells[0]!;
    const issued = await reviewer.invoke(
      "proof.run.confirm",
      {
        proofId: approved.proof.id,
        expectedVersion: approved.proof.version,
        cellId: cell.cellId,
        previewDigest: preview.previewDigest,
        confirm: true,
      },
      { requestId: "guarded-confirm-issue" },
    );
    assert.equal(issued.receipt.actorId, "human:reviewer");
    assert.equal(issued.receipt.scope.cellId, cell.cellId);

    const ran = await reviewer.invoke(
      "proof.run",
      {
        proofId: approved.proof.id,
        expectedVersion: approved.proof.version,
        wait: true,
        confirmationReceipts: [issued.receipt],
      },
      { requestId: "guarded-confirm-run" },
    );
    assert.equal(ran.execution.status, "completed");
    // Execution authority is satisfied, but the aggregate Proof still
    // requires its separate policy review before merge for a guarded effect.
    assert.equal(ran.proof.state, "needs-review");
    assert.equal(dispatches, 1);

    // A receipt-shaped object with an unissued identity must not become
    // authority merely because its preview and scope are otherwise exact.
    await assert.rejects(
      reviewer.invoke(
        "proof.run",
        {
          proofId: approved.proof.id,
          expectedVersion: approved.proof.version,
          confirmationReceipts: [{ ...issued.receipt, receiptId: "proof-confirmation:forged" }],
        },
        { requestId: "guarded-confirm-forged" },
      ),
      (error) =>
        error instanceof ApiError &&
        error.status === 409 &&
        error.body.code === "PROOF_CONFIRMATION_INVALID",
    );

    // Consumed receipts are single-use, including retries with a new request
    // identity after the first execution has completed.
    await assert.rejects(
      reviewer.invoke(
        "proof.run",
        {
          proofId: approved.proof.id,
          expectedVersion: approved.proof.version,
          confirmationReceipts: [issued.receipt],
        },
        { requestId: "guarded-confirm-replay" },
      ),
      (error) =>
        error instanceof ApiError &&
        error.status === 409 &&
        error.body.code === "PROOF_CONFIRMATION_REPLAYED",
    );
    assert.equal(dispatches, 1);
  } finally {
    await server.close();
    resetControlDatabaseCache();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("destructive Proof cells stay paused and human evidence resumes only with an exact host seam", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-proof-human-route-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  resetControlDatabaseCache();
  let dispatches = 0;
  const coordinator = createChangeProofExecutionCoordinator({
    workerId: "worker:human-route",
    projectRun: async ({ run }) => ({
      appMapId: "settings",
      testId: "settings-language",
      targetCaseId: "chromium-compact-ar",
      runId: (run as { id: string }).id,
      sourceSha: headSha,
      buildId: "web",
      artifactDigest: digest,
      outcome: "passed",
      evidenceDigests: [`sha256:${"c".repeat(64)}`],
      evidenceComplete: true,
      selectorResolution: "deterministic",
      inputOutcome: "reconciled",
      cleanup: "restored",
    }),
  });
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    proofRouteRuntime: {
      executionCoordinator: coordinator,
      executeCell: async ({ cell }) => {
        dispatches += 1;
        assert.equal(cell.cellId, "cell-settings-chromium");
        return { runId: "human-route-run", wait: async () => ({ id: "human-route-run" }) as never };
      },
      supportsHumanInterventionResume: true,
    },
  });
  const relay = client(server.port);
  const reviewer = client(server.port, projectId, "human");
  try {
    const created = await relay.invoke("proof.start", startInputWithRisk(humanOnlyExecutionRisk), {
      requestId: "human-route-start",
    });
    const approved = await reviewer.invoke(
      "proof.plan.approve",
      {
        proofId: created.proof.id,
        expectedVersion: created.proof.version,
        decisionId: "human-route-approval",
        reason: "The destructive fixture step must remain human-only.",
        confirm: true,
      },
      { requestId: "human-route-approval" },
    );
    const paused = await relay.invoke(
      "proof.run",
      { proofId: approved.proof.id, expectedVersion: approved.proof.version, wait: true },
      { requestId: "human-route-run" },
    );
    assert.equal(paused.execution.status, "paused-human");
    assert.deepEqual(paused.execution.humanIntervention, {
      cellId: "cell-settings-chromium",
      stepId: "delete-fixture",
      effects: ["data-deletion"],
      reason: "A person must verify the fixture before deleting it.",
      at: paused.execution.humanIntervention!.at,
    });
    assert.equal(dispatches, 0);

    await assert.rejects(
      reviewer.invoke(
        "proof.run.confirm",
        {
          proofId: approved.proof.id,
          expectedVersion: approved.proof.version,
          cellId: "cell-settings-chromium",
          previewDigest: (await relay.invoke("proof.inspect", { proofId: approved.proof.id }))
            .executionPreview!.previewDigest,
          fixtureScope: {
            targetCaseId: "chromium-compact-ar",
            targetProfileId: "web:compact:ar",
            cleanupCheckIds: ["fixture-cleanup"],
          },
          confirm: true,
        },
        { requestId: "human-route-confirm" },
      ),
      (error) => error instanceof ApiError && error.status === 409,
    );

    const evidence = await reviewer.invoke(
      "proof.run.human-evidence",
      {
        proofId: approved.proof.id,
        executionId: paused.execution.id,
        cellId: "cell-settings-chromium",
        stepId: "delete-fixture",
        evidenceDigest: `sha256:${"e".repeat(64)}`,
        wait: true,
        confirm: true,
      },
      { requestId: "human-route-evidence" },
    );
    assert.equal(evidence.execution.status, "completed");
    assert.equal(evidence.evidence.recordedBy, "human:reviewer");
    assert.equal(dispatches, 1);

    await assert.rejects(
      reviewer.invoke(
        "proof.run.human-evidence",
        {
          proofId: approved.proof.id,
          executionId: paused.execution.id,
          cellId: "cell-settings-chromium",
          stepId: "delete-fixture",
          evidenceDigest: `sha256:${"e".repeat(64)}`,
          wait: true,
          confirm: true,
        },
        { requestId: "human-route-evidence-replay" },
      ),
      (error) =>
        error instanceof ApiError &&
        error.status === 409 &&
        error.body.code === "PROOF_EXECUTION_HUMAN_INTERVENTION",
    );
    assert.equal(dispatches, 1);
  } finally {
    await server.close();
    resetControlDatabaseCache();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
