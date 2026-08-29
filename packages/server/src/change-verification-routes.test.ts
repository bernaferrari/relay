import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ApiError, RelayClient } from "@relay/client";
import { resetControlDatabaseCache } from "@relay/core";
import type { ChangeProofCaseResult, ChangeVerification, OperationInput } from "@relay/protocol";
import type { PersistedRun } from "@relay/core";
import { startServer } from "./index.js";

const organizationId = "acme";
const projectId = "relay";
const baseSha = "1".repeat(40);
const headSha = "2".repeat(40);
const repairedHeadSha = "3".repeat(40);
const digest = `sha256:${"a".repeat(64)}`;

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
        cleanupRequired: false,
      },
    ],
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

    const rerun = await relay.invoke(
      "proof.rerun-affected",
      {
        proofId: approved.proof.id,
        expectedVersion: approved.proof.version,
        change: {
          ...approved.proof.change,
          baseSha: headSha,
          headSha: repairedHeadSha,
        },
        policy: approved.proof.policy,
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
          proofId: approved.proof.id,
          expectedVersion: approved.proof.version,
          change: {
            ...approved.proof.change,
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
      publishTerminal: async ({ proof }) => {
        published.push({ state: proof.state, headSha: proof.change.headSha });
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
      published.every(
        (publication) => publication.state === "proved" && publication.headSha === headSha,
      ),
      "at-least-once publisher retries retain the exact terminal Proof identity",
    );
    const pendingPublication = await relay.invoke("proof.inspect", {
      proofId: proved.proof.id,
      includeHistory: false,
    });
    assert.equal(pendingPublication.publications.length, 0);
    assert.equal(pendingPublication.publicationOutbox.length, 1);
    assert.equal(pendingPublication.publicationOutbox[0]?.status, "retry");
    assert.equal(
      pendingPublication.publicationOutbox[0]?.lastFailure?.kind,
      "reconciliation-error",
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
    assert.ok(
      published.every(
        (publication) => publication.state === "proved" && publication.headSha === headSha,
      ),
    );

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
