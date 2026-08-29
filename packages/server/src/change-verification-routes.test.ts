import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ApiError, RelayClient } from "@relay/client";
import { resetControlDatabaseCache } from "@relay/core";
import type { ChangeVerification, OperationInput } from "@relay/protocol";
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
