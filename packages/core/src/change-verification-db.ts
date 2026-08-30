import type { DatabaseSync } from "node:sqlite";

/** Install the dedicated append-only Change Verification projection. Keeping
 * this schema beside the Proof store prevents the shared control database
 * module from becoming the owner of product-specific lifecycle details. */
export function ensureChangeVerificationSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS change_verification_versions (
      proof_id TEXT NOT NULL,
      version INTEGER NOT NULL CHECK (version >= 1),
      organization_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      repository TEXT NOT NULL,
      base_sha TEXT NOT NULL,
      head_sha TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN (
        'planning', 'awaiting-build', 'ready', 'running-pilot',
        'awaiting-expansion', 'running', 'proved', 'rejected',
        'needs-review', 'insufficient-evidence', 'cancelled', 'superseded'
      )),
      document TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (proof_id, version)
    );
    CREATE INDEX IF NOT EXISTS change_verification_versions_project_updated
      ON change_verification_versions(organization_id, project_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS change_verification_versions_change
      ON change_verification_versions(repository, head_sha, updated_at DESC);
    CREATE TABLE IF NOT EXISTS change_proof_publications (
      proof_id TEXT NOT NULL,
      provider TEXT NOT NULL CHECK (provider IN ('github')),
      sequence INTEGER NOT NULL CHECK (sequence >= 1),
      organization_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      check_run_id INTEGER NOT NULL CHECK (check_run_id >= 1),
      document TEXT NOT NULL,
      published_at INTEGER NOT NULL,
      PRIMARY KEY (proof_id, provider, sequence)
    );
    CREATE INDEX IF NOT EXISTS change_proof_publications_project
      ON change_proof_publications(organization_id, project_id, published_at DESC);
    /* Provider publication is an external side effect. Keep its deterministic
     * intent and worker lease in the same control database as the Proof and
     * its token-free receipts, so a terminal transition can enqueue before a
     * provider call and a restart can recover an abandoned claim. */
    CREATE TABLE IF NOT EXISTS change_proof_publication_outbox (
      id TEXT NOT NULL,
      organization_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      proof_id TEXT NOT NULL,
      proof_version INTEGER NOT NULL CHECK (proof_version >= 1),
      provider TEXT NOT NULL CHECK (provider IN ('github')),
      status TEXT NOT NULL CHECK (status IN ('pending', 'claimed', 'retry', 'published')),
      attempts INTEGER NOT NULL CHECK (attempts >= 0),
      max_attempts INTEGER NOT NULL CHECK (max_attempts >= 1 AND max_attempts <= 32),
      created_at INTEGER NOT NULL,
      next_attempt_at INTEGER,
      lease_worker_id TEXT,
      lease_token TEXT,
      lease_claimed_at INTEGER,
      lease_expires_at INTEGER,
      published_at INTEGER,
      updated_at INTEGER NOT NULL,
      document TEXT NOT NULL,
      PRIMARY KEY (organization_id, project_id, id),
      UNIQUE (organization_id, project_id, proof_id, proof_version, provider)
    );
    CREATE INDEX IF NOT EXISTS change_proof_publication_outbox_due
      ON change_proof_publication_outbox(status, next_attempt_at, updated_at);
    CREATE INDEX IF NOT EXISTS change_proof_publication_outbox_scope
      ON change_proof_publication_outbox(organization_id, project_id, updated_at DESC);
    /* One durable coordinator per Proof. The document carries the frozen
     * matrix and per-cell state; indexed columns make restart inventory and
     * scoped claims cheap without exposing those internals at the HTTP seam. */
    CREATE TABLE IF NOT EXISTS change_proof_executions (
      id TEXT NOT NULL,
      organization_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      proof_id TEXT NOT NULL,
      proof_version INTEGER NOT NULL CHECK (proof_version >= 1),
      request_id TEXT NOT NULL,
      request_digest TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'cancelled', 'uncertain')),
      cursor INTEGER NOT NULL CHECK (cursor >= 0),
      total INTEGER NOT NULL CHECK (total >= 1),
      deadline_at INTEGER NOT NULL CHECK (deadline_at >= 0),
      worker_id TEXT,
      lease_token TEXT,
      lease_claimed_at INTEGER,
      lease_expires_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      document TEXT NOT NULL,
      PRIMARY KEY (organization_id, project_id, id),
      UNIQUE (organization_id, project_id, proof_id)
    );
    CREATE INDEX IF NOT EXISTS change_proof_executions_due
      ON change_proof_executions(status, lease_expires_at, updated_at);
    CREATE INDEX IF NOT EXISTS change_proof_executions_scope
      ON change_proof_executions(organization_id, project_id, updated_at DESC);
  `);

  const outboxColumns = db
    .prepare("PRAGMA table_info(change_proof_publication_outbox)")
    .all() as Array<{ name?: string }>;
  if (outboxColumns.length && !outboxColumns.some(({ name }) => name === "proof_version")) {
    db.exec(`
      BEGIN IMMEDIATE;
      DROP INDEX IF EXISTS change_proof_publication_outbox_due;
      DROP INDEX IF EXISTS change_proof_publication_outbox_scope;
      ALTER TABLE change_proof_publication_outbox RENAME TO change_proof_publication_outbox_legacy;
      CREATE TABLE change_proof_publication_outbox (
        id TEXT NOT NULL,
        organization_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        proof_id TEXT NOT NULL,
        proof_version INTEGER NOT NULL CHECK (proof_version >= 1),
        provider TEXT NOT NULL CHECK (provider IN ('github')),
        status TEXT NOT NULL CHECK (status IN ('pending', 'claimed', 'retry', 'published')),
        attempts INTEGER NOT NULL CHECK (attempts >= 0),
        max_attempts INTEGER NOT NULL CHECK (max_attempts >= 1 AND max_attempts <= 32),
        created_at INTEGER NOT NULL,
        next_attempt_at INTEGER,
        lease_worker_id TEXT,
        lease_token TEXT,
        lease_claimed_at INTEGER,
        lease_expires_at INTEGER,
        published_at INTEGER,
        updated_at INTEGER NOT NULL,
        document TEXT NOT NULL,
        PRIMARY KEY (organization_id, project_id, id),
        UNIQUE (organization_id, project_id, proof_id, proof_version, provider)
      );
      INSERT INTO change_proof_publication_outbox(
        id, organization_id, project_id, proof_id, proof_version, provider, status,
        attempts, max_attempts, created_at, next_attempt_at, lease_worker_id, lease_token,
        lease_claimed_at, lease_expires_at, published_at, updated_at, document
      )
      WITH legacy_versions AS (
        SELECT
          legacy.*,
          COALESCE(
            CASE
              WHEN CAST(json_extract(legacy.document, '$.proofVersion') AS INTEGER) >= 1
                THEN CAST(json_extract(legacy.document, '$.proofVersion') AS INTEGER)
            END,
            (
              SELECT MAX(history.version)
              FROM change_verification_versions AS history
              WHERE history.proof_id = legacy.proof_id
                AND history.organization_id = legacy.organization_id
                AND history.project_id = legacy.project_id
            ),
            1
          ) AS historical_version
        FROM change_proof_publication_outbox_legacy AS legacy
      )
      SELECT
        id, organization_id, project_id, proof_id, historical_version,
        provider, status, attempts, max_attempts,
        COALESCE(CAST(json_extract(document, '$.createdAt') AS INTEGER), updated_at),
        next_attempt_at,
        lease_worker_id, lease_token, lease_claimed_at, lease_expires_at, published_at,
        updated_at, json_set(document, '$.proofVersion', historical_version)
      FROM legacy_versions;
      DROP TABLE change_proof_publication_outbox_legacy;
      CREATE INDEX change_proof_publication_outbox_due
        ON change_proof_publication_outbox(status, next_attempt_at, updated_at);
      CREATE INDEX change_proof_publication_outbox_scope
        ON change_proof_publication_outbox(organization_id, project_id, updated_at DESC);
      COMMIT;
    `);
  }
}
