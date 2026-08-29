import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ChangeProofProviderCheck } from "@relay/protocol";
import { resetControlDatabaseCache } from "./collaboration-db.js";
import {
  ChangeProofPublicationConflictError,
  readChangeProofPublications,
  recordChangeProofPublication,
} from "./change-proof-publication.js";
import {
  advanceChangeVerification,
  createChangeVerification,
} from "./change-verification-store.js";

const scope = { organizationId: "acme", projectId: "relay" } as const;
const headSha = "2".repeat(40);
const digest = `sha256:${"a".repeat(64)}` as const;

async function withStateRoot(operation: () => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "relay-proof-publication-"));
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

async function terminalProof() {
  const created = await createChangeVerification({
    ...scope,
    id: "proof-1",
    change: { repository: "acme/settings", baseSha: "1".repeat(40), headSha },
    policy: { id: "relay.verify-change", version: 1 },
    requestedBy: "agent:coder",
    actorId: "agent:coder",
    requestId: "start",
    requestDigest: digest,
    at: 100,
  });
  return advanceChangeVerification({
    ...scope,
    proofId: created.id,
    expectedVersion: created.version,
    state: "insufficient-evidence",
    actorId: "system:relay",
    requestId: "decision",
    requestDigest: `sha256:${"b".repeat(64)}`,
    action: "record-decision",
    at: 200,
    coverageGaps: ["Exact build evidence is missing."],
    smallestNextVerification: { kind: "provide-build", reason: "Bind the exact head build." },
  });
}

function check(summary = "Bind the exact head build."): ChangeProofProviderCheck {
  return {
    schemaVersion: 1,
    name: "Relay Proof",
    externalId: "proof-1",
    headSha,
    status: "completed",
    conclusion: "action-required",
    classification: "insufficient-evidence",
    title: "Relay Proof — INSUFFICIENT EVIDENCE",
    summary,
    text: [
      `Head: ${headSha}`,
      "Required cases: 0",
      "Recorded Runs: 0",
      "Evidence objects: 0",
      "Policy: relay.verify-change.v1",
      "",
      "Coverage gaps:",
      "- Exact build evidence is missing.",
    ].join("\n"),
  };
}

function publication(checkValue: ChangeProofProviderCheck, publishedAt: number) {
  return {
    ...scope,
    proofId: "proof-1",
    repository: "acme/settings",
    check: checkValue,
    provider: "github" as const,
    checkRunId: 42,
    externalId: "proof-1",
    headSha,
    htmlUrl: "https://github.com/acme/settings/runs/42",
    publishedAt,
  };
}

test("persists one check identity and appends only materially changed publications", async () => {
  await withStateRoot(async () => {
    await terminalProof();
    const first = await recordChangeProofPublication(publication(check(), 300));
    assert.equal(first.sequence, 1);
    assert.equal(first.checkRunId, 42);
    assert.equal(first.conclusion, "action-required");

    const repeated = await recordChangeProofPublication(publication(check(), 400));
    assert.deepEqual(repeated, first);

    const changed = await recordChangeProofPublication(
      publication({ ...check(), detailsUrl: "https://relay.example.com/proofs/proof-1" }, 500),
    );
    assert.equal(changed.sequence, 2);
    assert.notEqual(changed.checkDigest, first.checkDigest);

    await assert.rejects(
      recordChangeProofPublication(publication(check("A friendlier forged summary."), 600)),
      (error) =>
        error instanceof ChangeProofPublicationConflictError &&
        error.code === "PROOF_CHECK_MISMATCH",
    );

    resetControlDatabaseCache();
    assert.deepEqual(
      (await readChangeProofPublications(scope, "proof-1")).map(({ sequence }) => sequence),
      [1, 2],
    );
  });
});

test("rejects cross-head, cross-check, cross-project, and nonterminal publications", async () => {
  await withStateRoot(async () => {
    await terminalProof();
    await recordChangeProofPublication(publication(check(), 300));

    await assert.rejects(
      recordChangeProofPublication({ ...publication(check(), 400), checkRunId: 43 }),
      (error) =>
        error instanceof ChangeProofPublicationConflictError &&
        error.code === "PUBLICATION_IDENTITY_MISMATCH",
    );
    await assert.rejects(
      recordChangeProofPublication({ ...publication(check(), 400), headSha: "3".repeat(40) }),
      (error) =>
        error instanceof ChangeProofPublicationConflictError &&
        error.code === "PUBLICATION_IDENTITY_MISMATCH",
    );
    assert.deepEqual(
      await readChangeProofPublications({ ...scope, projectId: "other" }, "proof-1"),
      [],
    );

    await createChangeVerification({
      ...scope,
      id: "proof-planning",
      change: { repository: "acme/settings", baseSha: "3".repeat(40), headSha: "4".repeat(40) },
      policy: { id: "relay.verify-change", version: 1 },
      requestedBy: "agent:coder",
      actorId: "agent:coder",
      requestId: "planning",
      requestDigest: digest,
      at: 500,
    });
    const planningCheck = { ...check(), externalId: "proof-planning", headSha: "4".repeat(40) };
    await assert.rejects(
      recordChangeProofPublication({
        ...publication(planningCheck, 600),
        proofId: "proof-planning",
        externalId: "proof-planning",
        headSha: "4".repeat(40),
      }),
      (error) =>
        error instanceof ChangeProofPublicationConflictError &&
        error.code === "PROOF_DECISION_REQUIRED",
    );
  });
});
