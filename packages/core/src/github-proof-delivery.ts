import { randomUUID } from "node:crypto";
import { withControlStore } from "./collaboration-store.js";
import { canonicalSha256 } from "./canonical-json.js";

const DELIVERY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
export const GITHUB_PROOF_DELIVERY_LEASE_MS = 5 * 60 * 1_000;

export type GitHubProofDeliveryState = {
  schemaVersion: 1;
  status: "pending" | "completed";
  digest: `sha256:${string}`;
  claimToken: string;
  claimedAt: number;
  leaseExpiresAt: number;
  completedAt?: number;
};

export type GitHubProofDeliveryClaim = {
  disposition: "claimed" | "pending" | "completed";
  state: GitHubProofDeliveryState;
};

function key(scope: { organizationId: string; projectId: string }, deliveryId: string): string {
  if (!scope.organizationId.trim() || !scope.projectId.trim() || !DELIVERY_ID.test(deliveryId)) {
    throw new Error("GitHub Proof delivery scope and id must be valid");
  }
  return `github-proof-delivery:${canonicalSha256({
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    deliveryId,
  }).slice(7)}`;
}

function completedLegacyState(digest: string): GitHubProofDeliveryState {
  return {
    schemaVersion: 1,
    status: "completed",
    digest: digest as `sha256:${string}`,
    claimToken: "legacy",
    claimedAt: 0,
    leaseExpiresAt: 0,
  };
}

function decodeState(value: number | string | undefined): GitHubProofDeliveryState | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string" && DIGEST.test(value)) return completedLegacyState(value);
  if (typeof value !== "string") {
    throw new Error("GitHub Proof delivery state is invalid");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error("GitHub Proof delivery state is invalid");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("GitHub Proof delivery state is invalid");
  }
  const candidate = parsed as Record<string, unknown>;
  const digest = candidate.digest;
  const status = candidate.status;
  const claimedAt = candidate.claimedAt;
  const leaseExpiresAt = candidate.leaseExpiresAt;
  const claimToken = candidate.claimToken;
  if (
    candidate.schemaVersion !== 1 ||
    (status !== "pending" && status !== "completed") ||
    typeof digest !== "string" ||
    !DIGEST.test(digest) ||
    typeof claimToken !== "string" ||
    !claimToken.trim() ||
    typeof claimedAt !== "number" ||
    !Number.isFinite(claimedAt) ||
    typeof leaseExpiresAt !== "number" ||
    !Number.isFinite(leaseExpiresAt) ||
    (candidate.completedAt !== undefined &&
      (typeof candidate.completedAt !== "number" || !Number.isFinite(candidate.completedAt)))
  ) {
    throw new Error("GitHub Proof delivery state is invalid");
  }
  return {
    schemaVersion: 1,
    status,
    digest: digest as `sha256:${string}`,
    claimToken,
    claimedAt,
    leaseExpiresAt,
    ...(typeof candidate.completedAt === "number" ? { completedAt: candidate.completedAt } : {}),
  };
}

function deliveryConflict(): Error {
  return new Error("GitHub Proof delivery id is already bound to another payload");
}

function validateClock(value: number | undefined): number {
  const at = value ?? Date.now();
  if (!Number.isFinite(at) || at < 0) throw new Error("GitHub Proof delivery clock is invalid");
  return at;
}

export async function readGitHubProofDeliveryDigest(input: {
  organizationId: string;
  projectId: string;
  deliveryId: string;
}): Promise<string | undefined> {
  return withControlStore((store) => {
    const state = decodeState(store.idempotency(key(input, input.deliveryId)));
    return state?.digest;
  });
}

/**
 * Claim a delivery before doing any network or Proof mutation. The short
 * ControlStore transaction is the only place that decides ownership. A
 * non-expired pending claim makes concurrent webhook attempts inert; an
 * expired claim can be safely retried after a crashed worker.
 */
export async function claimGitHubProofDelivery(input: {
  organizationId: string;
  projectId: string;
  deliveryId: string;
  digest: `sha256:${string}`;
  now?: number;
  leaseMs?: number;
}): Promise<GitHubProofDeliveryClaim> {
  if (!DIGEST.test(input.digest)) throw new Error("GitHub Proof delivery digest must be canonical");
  const at = validateClock(input.now);
  const leaseMs = input.leaseMs ?? GITHUB_PROOF_DELIVERY_LEASE_MS;
  if (!Number.isFinite(leaseMs) || leaseMs <= 0) {
    throw new Error("GitHub Proof delivery lease must be positive");
  }
  return withControlStore((store) => {
    const deliveryKey = key(input, input.deliveryId);
    const existing = decodeState(store.idempotency(deliveryKey));
    if (!existing) {
      const state: GitHubProofDeliveryState = {
        schemaVersion: 1,
        status: "pending",
        digest: input.digest,
        claimToken: randomUUID(),
        claimedAt: at,
        leaseExpiresAt: at + leaseMs,
      };
      store.upsertIdempotency(deliveryKey, JSON.stringify(state));
      return { disposition: "claimed", state };
    }
    if (existing.digest !== input.digest) throw deliveryConflict();
    if (existing.status === "completed") return { disposition: "completed", state: existing };
    if (existing.leaseExpiresAt > at) return { disposition: "pending", state: existing };
    const state: GitHubProofDeliveryState = {
      ...existing,
      status: "pending",
      claimedAt: at,
      claimToken: randomUUID(),
      leaseExpiresAt: at + leaseMs,
      completedAt: undefined,
    };
    store.upsertIdempotency(deliveryKey, JSON.stringify(state));
    return { disposition: "claimed", state };
  });
}

/** Mark a claimed delivery complete after all Proof side effects succeeded. */
export async function completeGitHubProofDelivery(input: {
  organizationId: string;
  projectId: string;
  deliveryId: string;
  digest: `sha256:${string}`;
  claimToken?: string;
  now?: number;
}): Promise<"completed" | "existing"> {
  if (!DIGEST.test(input.digest)) throw new Error("GitHub Proof delivery digest must be canonical");
  const at = validateClock(input.now);
  return withControlStore((store) => {
    const deliveryKey = key(input, input.deliveryId);
    const existing = decodeState(store.idempotency(deliveryKey));
    if (!existing) throw new Error("GitHub Proof delivery has no durable claim");
    if (existing.digest !== input.digest) throw deliveryConflict();
    if (existing.status === "completed") return "existing";
    if (input.claimToken !== undefined && input.claimToken !== existing.claimToken) {
      throw new Error("GitHub Proof delivery claim is no longer owned by this worker");
    }
    store.upsertIdempotency(
      deliveryKey,
      JSON.stringify({ ...existing, status: "completed", completedAt: at }),
    );
    return "completed";
  });
}

/** Bind a provider delivery id to one canonical payload digest. The existing
 * ControlStore transaction makes changed replay unable to overwrite the first
 * accepted identity, including after process restart. */
export async function recordGitHubProofDeliveryDigest(input: {
  organizationId: string;
  projectId: string;
  deliveryId: string;
  digest: `sha256:${string}`;
}): Promise<"recorded" | "existing"> {
  if (!DIGEST.test(input.digest)) throw new Error("GitHub Proof delivery digest must be canonical");
  return withControlStore((store) => {
    const deliveryKey = key(input, input.deliveryId);
    const existing = decodeState(store.idempotency(deliveryKey));
    if (existing !== undefined) {
      if (existing.digest !== input.digest) throw deliveryConflict();
      if (existing.status === "pending") {
        store.upsertIdempotency(
          deliveryKey,
          JSON.stringify({ ...existing, status: "completed", completedAt: Date.now() }),
        );
        return "recorded";
      }
      return "existing";
    }
    store.upsertIdempotency(
      deliveryKey,
      JSON.stringify({
        schemaVersion: 1,
        status: "completed",
        digest: input.digest,
        claimToken: "legacy",
        claimedAt: 0,
        leaseExpiresAt: 0,
        completedAt: Date.now(),
      } satisfies GitHubProofDeliveryState),
    );
    return "recorded";
  });
}
