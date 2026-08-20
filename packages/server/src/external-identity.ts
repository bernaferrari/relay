import {
  projectRoles as projectRoleValues,
  type ActorKind,
  type ProjectRole,
} from "@relay/protocol";

const MAX_SUBJECT_LENGTH = 256;
const MAX_SCOPE_ID_LENGTH = 128;
const MAX_PROJECT_ROLES = 100;
const trustedIdentities = new WeakSet<object>();
const verifiedExternalIdentityBrand: unique symbol = Symbol("relay.verifiedExternalIdentity");

export type ExternalIdentityActorKind = Extract<ActorKind, "human" | "agent">;

/**
 * The normalized result of a verifier that has already authenticated an
 * external bearer credential. Relay deliberately does not parse JWT claims:
 * the verifier owns signature, issuer, audience, expiry, and any group-to-role
 * mapping before it calls {@link verifiedExternalIdentity}.
 */
export type ExternalIdentityInput = {
  subject: string;
  organizationId: string;
  /** Project roles are resolved by the verifier, never from request headers. */
  projectRoles: Readonly<Record<string, ProjectRole>>;
  /** Unix epoch milliseconds, copied from a verifier-validated token expiry. */
  expiresAt: number;
  /** OIDC users are human by default; workload identities may be agents. */
  actorKind?: ExternalIdentityActorKind;
};

/**
 * A runtime-branded identity accepted at Relay's request boundary. The brand
 * prevents a verifier from accidentally returning decoded but unverified JWT
 * claims as if they were an authenticated identity.
 */
export type VerifiedExternalIdentity = Readonly<{
  subject: string;
  organizationId: string;
  projectRoles: Readonly<Record<string, ProjectRole>>;
  expiresAt: number;
  actorKind: ExternalIdentityActorKind;
  readonly [verifiedExternalIdentityBrand]: true;
}>;

export type ExternalIdentityVerificationRequest = Readonly<{
  /** Opaque bearer credential. Relay does not decode or interpret it. */
  token: string;
  /** Request time in epoch milliseconds, supplied for deterministic validation. */
  now: number;
}>;

/**
 * Trusted server-side integration point for a real OIDC/JWT verifier or token
 * introspection service. This is intentionally programmatic: an environment
 * variable must never turn decoded bearer assertions into Relay identities.
 */
export type ExternalIdentityVerifier = Readonly<{
  verifyBearerToken(
    request: ExternalIdentityVerificationRequest,
  ):
    | VerifiedExternalIdentity
    | null
    | undefined
    | Promise<VerifiedExternalIdentity | null | undefined>;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function scopeId(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new Error(`${label} must be a non-empty string no longer than ${maxLength} characters`);
  }
  if (value.trim() !== value || /[\u0000-\u001F\u007F]/.test(value)) {
    throw new Error(`${label} cannot contain leading/trailing whitespace or control characters`);
  }
  return value;
}

/**
 * Creates the only runtime-branded external identity Relay will accept. Call
 * this after (not instead of) cryptographic credential verification.
 */
export function verifiedExternalIdentity(input: ExternalIdentityInput): VerifiedExternalIdentity {
  const subject = scopeId(input.subject, "External subject", MAX_SUBJECT_LENGTH);
  const organizationId = scopeId(
    input.organizationId,
    "External organizationId",
    MAX_SCOPE_ID_LENGTH,
  );
  if (!isRecord(input.projectRoles)) {
    throw new Error("External projectRoles must be a record");
  }
  const entries = Object.entries(input.projectRoles);
  if (entries.length === 0 || entries.length > MAX_PROJECT_ROLES) {
    throw new Error(
      `External projectRoles must contain between 1 and ${MAX_PROJECT_ROLES} projects`,
    );
  }
  const normalizedProjectRoles = Object.create(null) as Record<string, ProjectRole>;
  for (const [projectId, role] of entries) {
    normalizedProjectRoles[scopeId(projectId, "External projectId", MAX_SCOPE_ID_LENGTH)] = (() => {
      if (!projectRoleValues.includes(role as ProjectRole)) {
        throw new Error("External project role must be viewer, author, runner, or admin");
      }
      return role as ProjectRole;
    })();
  }
  if (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= 0) {
    throw new Error("External identity expiry must be a positive epoch-millisecond integer");
  }
  if (input.actorKind !== undefined && input.actorKind !== "human" && input.actorKind !== "agent") {
    throw new Error("External actorKind must be human or agent");
  }

  const identity = Object.freeze({
    subject,
    organizationId,
    projectRoles: Object.freeze(normalizedProjectRoles),
    expiresAt: input.expiresAt,
    actorKind: input.actorKind ?? "human",
    [verifiedExternalIdentityBrand]: true as const,
  });
  trustedIdentities.add(identity);
  return identity;
}

export function isVerifiedExternalIdentity(value: unknown): value is VerifiedExternalIdentity {
  return isRecord(value) && trustedIdentities.has(value);
}

/**
 * Fails closed. A verifier exception, expired result, or an unbranded object
 * is indistinguishable from an invalid credential at the HTTP boundary.
 */
export async function verifyExternalBearerToken(
  verifier: ExternalIdentityVerifier,
  token: string,
  now = Date.now(),
): Promise<VerifiedExternalIdentity | undefined> {
  try {
    const identity = await verifier.verifyBearerToken({ token, now });
    if (!isVerifiedExternalIdentity(identity) || identity.expiresAt <= now) return undefined;
    return identity;
  } catch {
    return undefined;
  }
}
