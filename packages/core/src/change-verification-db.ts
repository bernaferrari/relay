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
  `);
}
