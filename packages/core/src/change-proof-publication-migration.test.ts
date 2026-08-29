import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  CONTROL_DB_NAME,
  openControlDatabase,
  resetControlDatabaseCache,
} from "./collaboration-db.js";
import { listChangeProofPublicationOutbox } from "./change-proof-publication-outbox.js";

const scope = { organizationId: "acme", projectId: "relay" } as const;
const headSha = "a".repeat(40);

function legacyCheck() {
  return {
    schemaVersion: 1 as const,
    name: "Relay Proof" as const,
    externalId: "proof-legacy",
    headSha,
    status: "completed" as const,
    conclusion: "action-required" as const,
    classification: "insufficient-evidence" as const,
    title: "Relay Proof — INSUFFICIENT EVIDENCE",
    summary: "The exact terminal Proof needs a missing required case.",
    text: "Required evidence is missing.",
  };
}

function legacyOutboxSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE change_proof_publication_outbox (
      id TEXT NOT NULL,
      organization_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      proof_id TEXT NOT NULL,
      provider TEXT NOT NULL CHECK (provider IN ('github')),
      status TEXT NOT NULL CHECK (status IN ('pending', 'claimed', 'retry', 'published')),
      attempts INTEGER NOT NULL CHECK (attempts >= 0),
      max_attempts INTEGER NOT NULL CHECK (max_attempts >= 1 AND max_attempts <= 32),
      next_attempt_at INTEGER,
      lease_worker_id TEXT,
      lease_token TEXT,
      lease_claimed_at INTEGER,
      lease_expires_at INTEGER,
      published_at INTEGER,
      updated_at INTEGER NOT NULL,
      document TEXT NOT NULL,
      PRIMARY KEY (organization_id, project_id, id)
    );
  `);
}

test("upgrades a legacy outbox row and restores its historical Proof version", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-proof-publication-migration-"));
  const path = join(root, CONTROL_DB_NAME);
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  resetControlDatabaseCache();
  try {
    // Bootstrap the rest of the control schema, then replace only the outbox
    // with its pre-proof-version shape, matching an in-place upgrade.
    const bootstrap = openControlDatabase(path);
    bootstrap
      .prepare(
        `INSERT INTO change_verification_versions(
           proof_id, version, organization_id, project_id, repository,
           base_sha, head_sha, state, document, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "proof-legacy",
        4,
        scope.organizationId,
        scope.projectId,
        "acme/settings",
        "b".repeat(40),
        headSha,
        "insufficient-evidence",
        JSON.stringify({ id: "proof-legacy", version: 4 }),
        400,
      );
    bootstrap.exec(`
      DROP INDEX IF EXISTS change_proof_publication_outbox_due;
      DROP INDEX IF EXISTS change_proof_publication_outbox_scope;
      DROP TABLE change_proof_publication_outbox;
    `);
    legacyOutboxSchema(bootstrap);
    const document = {
      schemaVersion: 1 as const,
      id: "legacy-publication",
      ...scope,
      proofId: "proof-legacy",
      provider: "github" as const,
      repository: "acme/settings",
      headSha,
      externalId: "proof-legacy",
      check: legacyCheck(),
      createdAt: 100,
      status: "retry" as const,
      attempts: 1,
      maxAttempts: 5,
      nextAttemptAt: 200,
      lastFailure: { kind: "provider-error" as const, at: 150 },
      updatedAt: 150,
      // Deliberately omit proofVersion: this is the legacy document shape.
    };
    bootstrap
      .prepare(
        `INSERT INTO change_proof_publication_outbox(
           id, organization_id, project_id, proof_id, provider, status,
           attempts, max_attempts, next_attempt_at, lease_worker_id,
           lease_token, lease_claimed_at, lease_expires_at, published_at,
           updated_at, document
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        document.id,
        document.organizationId,
        document.projectId,
        document.proofId,
        document.provider,
        document.status,
        document.attempts,
        document.maxAttempts,
        document.nextAttemptAt,
        null,
        null,
        null,
        null,
        null,
        document.updatedAt,
        JSON.stringify(document),
      );
    bootstrap.close();
    resetControlDatabaseCache();

    const records = await listChangeProofPublicationOutbox(scope);
    assert.equal(records.length, 1);
    assert.equal(records[0]?.id, document.id);
    assert.equal(records[0]?.proofVersion, 4);
    assert.equal(records[0]?.status, "retry");
    assert.equal(records[0]?.nextAttemptAt, 200);

    const migrated = openControlDatabase(path);
    try {
      const row = migrated
        .prepare("SELECT proof_version, document FROM change_proof_publication_outbox WHERE id = ?")
        .get(document.id) as { proof_version: number; document: string };
      assert.equal(Number(row.proof_version), 4);
      assert.equal(JSON.parse(row.document).proofVersion, 4);
    } finally {
      migrated.close();
    }
  } finally {
    resetControlDatabaseCache();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
