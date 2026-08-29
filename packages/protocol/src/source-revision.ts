/**
 * Immutable binding between one Relay run and the exact source change it
 * proves. Captured once at enqueue time and frozen into the run manifest,
 * this is audit-grade provenance: agents propose code, humans approve it,
 * and every proof names the commit it was produced against.
 */
export type SourceRevision = {
  vcs: "git";
  /** Abbreviated (7+) or full (40) lowercase hex commit SHA. */
  sha: string;
  prNumber?: number;
  branch?: string;
  /** Digest of the built artifact under test, when the build is known. */
  artifactDigest?: string;
  /** Registered build/deployment identity used for an executable Proof. */
  buildId?: string;
};

const GIT_SHA_PATTERN = /^[0-9a-f]{7,40}$/;

function fail(label: string, message: string): never {
  throw new Error(`Source revision ${label} ${message}`);
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) fail(label, "is required");
  return value.trim();
}

/** Fail-closed shape validation. A malformed source revision can never enter
 * a run manifest, where it would silently corrupt audit evidence. */
export function parseSourceRevision(value: unknown): SourceRevision {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("", "must be an object");
  }
  const input = value as Record<string, unknown>;
  if (input.vcs !== "git") fail("vcs", "must be 'git'");
  const sha = requiredText(input.sha, "sha");
  if (!GIT_SHA_PATTERN.test(sha)) {
    fail("sha", "must be 7-40 lowercase hex characters");
  }
  let prNumber: number | undefined;
  if (input.prNumber !== undefined) {
    if (
      typeof input.prNumber !== "number" ||
      !Number.isInteger(input.prNumber) ||
      input.prNumber < 1
    ) {
      fail("prNumber", "must be a positive integer");
    }
    prNumber = input.prNumber;
  }
  let branch: string | undefined;
  if (input.branch !== undefined) branch = requiredText(input.branch, "branch");
  let artifactDigest: string | undefined;
  if (input.artifactDigest !== undefined) {
    artifactDigest = requiredText(input.artifactDigest, "artifactDigest");
  }
  let buildId: string | undefined;
  if (input.buildId !== undefined) buildId = requiredText(input.buildId, "buildId");
  return {
    vcs: "git",
    sha,
    ...(prNumber !== undefined ? { prNumber } : {}),
    ...(branch !== undefined ? { branch } : {}),
    ...(artifactDigest !== undefined ? { artifactDigest } : {}),
    ...(buildId !== undefined ? { buildId } : {}),
  };
}

/** Read-side validation: returns undefined when the field is absent and
 * throws when a stored manifest carries a malformed revision. */
export function parseOptionalSourceRevision(value: unknown): SourceRevision | undefined {
  return value === undefined ? undefined : parseSourceRevision(value);
}
