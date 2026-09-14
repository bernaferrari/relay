import type { BrowserCaseProfile, TargetProfile } from "@relay/protocol";
import { compileBrowserEnvironment } from "@relay/protocol";

/** Bind a requested Browser account/engine to a saved profile, or reject.
 * Recording the request is not the same as executing it. */

export type RequestedBrowserAccount =
  | { kind: "fixture"; accountId: string; accountRevision: string; reference?: string }
  | { kind: "signed-out"; attested: true };

export type SavedBrowserIdentity = {
  engine?: string;
  authenticationFixtureId?: string;
};

export type BrowserIdentityBindResult =
  | { status: "bound" }
  | { status: "blocked"; reason: string }
  | { status: "not-applicable" };

const CANONICAL_FIXTURE = /^authfx:([^:]+):([1-9][0-9]*)$/u;

export function parseCanonicalFixtureReference(
  reference: string | undefined,
): { fixtureId: string; revision: string } | undefined {
  if (!reference) return undefined;
  const match = CANONICAL_FIXTURE.exec(reference.trim());
  return match?.[1] && match[2] ? { fixtureId: match[1], revision: match[2] } : undefined;
}

export function fixtureRevisionFromReference(reference: string | undefined): string | undefined {
  return parseCanonicalFixtureReference(reference)?.revision;
}

/** Plan columns freeze the requested account onto the queued job without
 * rewriting the saved App Map evidence profile. */
export function overlayRequestedBrowserAccountOnTargetProfile(
  profile: TargetProfile | undefined,
  account?: RequestedBrowserAccount,
): TargetProfile | undefined {
  if (!profile?.browserCaseProfile || !account) return profile;
  if (account.kind === "signed-out") {
    const { authenticationFixtureId: _ignored, ...environment } = profile.browserCaseProfile;
    return {
      ...profile,
      browserCaseProfile: compileBrowserEnvironment(environment),
    };
  }
  const reference =
    account.reference?.trim() || `authfx:${account.accountId}:${account.accountRevision}`;
  return {
    ...profile,
    browserCaseProfile: compileBrowserEnvironment({
      ...profile.browserCaseProfile,
      authenticationFixtureId: reference,
    }),
  };
}

/** Canonical environment identity includes fixture revision and every runtime setting. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map((item) => JSON.parse(canonical(item))));
  if (value && typeof value === "object")
    return JSON.stringify(
      Object.fromEntries(
        Object.entries(value)
          .filter(([, v]) => v !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, v]) => [key, JSON.parse(canonical(v))]),
      ),
    );
  return JSON.stringify(value);
}

export function browserRuntimeConfigurationDigest(
  input: Partial<BrowserCaseProfile> & {
    targetId: string;
    signedOut?: boolean;
  },
): string {
  return canonical(input);
}

/** Close other live identities for this target. Keep authoring and the
 * requested live key. */
export function liveBrowserSessionKeysToClose(input: {
  keys: readonly string[];
  targetId: string;
  keepKey?: string;
}): string[] {
  return input.keys.filter((key) => {
    if (key === input.keepKey) return false;
    if (key === `authoring:${input.targetId}`) return false;
    return (
      key.startsWith(`live:${input.targetId}:`) ||
      key === `proof:${input.targetId}` ||
      key.startsWith(`proof:${input.targetId}:`)
    );
  });
}

export function browserLiveSessionKey(input: {
  targetId: string;
  authenticationFixtureId?: string;
  signedOut?: boolean;
}): string {
  if (input.signedOut) return `live:${input.targetId}:signed-out`;
  if (input.authenticationFixtureId) {
    return `live:${input.targetId}:${input.authenticationFixtureId}`;
  }
  return `authoring:${input.targetId}`;
}

/** Scheduled proof contexts are per account (and per unsigned Lane) so
 * parallel fixtures or unsigned Lanes do not share a Playwright session. */
export function browserProofSessionKey(input: {
  targetId: string;
  authenticationFixtureId?: string;
  unsignedLaneId?: string;
}): string {
  const fixture = input.authenticationFixtureId?.trim();
  if (fixture) return `proof:${input.targetId}:${fixture}`;
  const lane = input.unsignedLaneId?.trim();
  return lane
    ? `proof:${input.targetId}:signed-out:${lane}`
    : `proof:${input.targetId}:signed-out`;
}

export function browserSessionStoreKey(input: {
  targetId: string;
  mode: "authoring" | "proof";
  reuseMatchingIdentity?: boolean;
  authenticationFixtureId?: string;
  unsignedLaneId?: string;
}): string {
  if (input.reuseMatchingIdentity) {
    return browserLiveSessionKey({
      targetId: input.targetId,
      authenticationFixtureId: input.authenticationFixtureId,
      signedOut: !input.authenticationFixtureId,
    });
  }
  if (input.mode === "proof") {
    return browserProofSessionKey(input);
  }
  return `${input.mode}:${input.targetId}`;
}

export function browserSessionBelongsToTarget(
  key: string,
  targetId: string | undefined,
  mode?: "authoring" | "proof",
): boolean {
  if (targetId === undefined) {
    if (mode === "authoring") return key.startsWith("authoring:");
    if (mode === "proof") return key.startsWith("proof:");
    return true;
  }
  if (key === `authoring:${targetId}`) return mode === undefined || mode === "authoring";
  if (key === `proof:${targetId}` || key.startsWith(`proof:${targetId}:`)) {
    return mode === undefined || mode === "proof";
  }
  if (key.startsWith(`live:${targetId}:`)) return mode === undefined;
  return false;
}

/** Same saved profile must equal the requested identity. Undefined request
 * does not match an existing session. */
export function browserSessionProfileMatches(existing: unknown, requested: unknown): boolean {
  if (requested === undefined) return false;
  return canonical(existing) === canonical(requested);
}

/** Explicit request wins. Otherwise attach to an already-open live identity
 * before falling back to the saved profile (authoring). */
export function resolveBrowserDeviceOpenIdentity(input: {
  requested?: { authenticationFixtureId?: string; signedOut?: boolean };
  existingLive?: { authenticationFixtureId?: string; signedOut?: boolean };
  savedProfile?: { authenticationFixtureId?: string };
}): { authenticationFixtureId?: string; signedOut?: boolean } {
  const requestedFixture = input.requested?.authenticationFixtureId?.trim();
  if (input.requested?.signedOut === true) return { signedOut: true };
  if (requestedFixture) return { authenticationFixtureId: requestedFixture };
  if (input.existingLive?.signedOut === true) return { signedOut: true };
  const existingFixture = input.existingLive?.authenticationFixtureId?.trim();
  if (existingFixture) return { authenticationFixtureId: existingFixture };
  const saved = input.savedProfile?.authenticationFixtureId?.trim();
  if (saved) return { authenticationFixtureId: saved };
  return {};
}

/** Independent registry keys from listed fixtures. Do not derive keys from a
 * request's own reference. */
export function accountFixtureIdsFromListed(
  fixtures: readonly { id: string; name: string; reference: string }[],
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const fixture of fixtures) {
    const id = fixture.id.trim();
    if (!id) continue;
    map[id] = id;
    const name = fixture.name.trim();
    if (name) map[name] = id;
    const parsed = parseCanonicalFixtureReference(fixture.reference);
    if (parsed?.fixtureId) map[parsed.fixtureId] = id;
  }
  return map;
}

export function listedFixtureForAccount(
  fixtures: readonly { id: string; name: string; reference: string }[],
  account: { accountId: string; accountRevision: string; reference?: string },
): { id: string; reference: string } | undefined {
  const accountId = account.accountId.trim();
  const revision = account.accountRevision.trim();
  const requestedRef = parseCanonicalFixtureReference(account.reference);
  for (const fixture of fixtures) {
    const parsed = parseCanonicalFixtureReference(fixture.reference);
    if (!parsed || parsed.revision !== revision) continue;
    if (account.reference && fixture.reference !== account.reference.trim()) continue;
    if (
      fixture.id === accountId ||
      fixture.name === accountId ||
      parsed.fixtureId === accountId ||
      (requestedRef !== undefined && parsed.fixtureId === requestedRef.fixtureId)
    ) {
      return { id: fixture.id, reference: fixture.reference };
    }
  }
  return undefined;
}

/** Configuration requests reuse only an equal environment. Exact attachment is separate. */
export function browserLiveIdentityMatches(
  existing: Partial<BrowserCaseProfile> | undefined,
  requested: Partial<BrowserCaseProfile> | undefined,
): boolean {
  return Boolean(existing && requested && browserSessionProfileMatches(existing, requested));
}

export function bindRequestedBrowserIdentity(input: {
  requested?: { engine?: string; account?: RequestedBrowserAccount };
  saved?: SavedBrowserIdentity;
  platform?: string;
  /** Reviewed accountId → canonical fixture id. Display names are not authority. */
  accountFixtureIds?: Readonly<Record<string, string>>;
  listedFixtures?: readonly { id: string; name: string; reference: string }[];
  /** Plan columns bind listed fixtures even when the saved runtime profile
   * recorded a different or empty account. Engine mismatch still fails closed. */
  listedFixtureAuthority?: boolean;
}): BrowserIdentityBindResult {
  const requested = input.requested;
  if (!requested?.account && !requested?.engine) return { status: "not-applicable" };
  const platform = browserIdentityPlatform(input.platform, requested);
  if (platform && platform !== "browser") return { status: "not-applicable" };

  if (requested.engine && input.saved?.engine && requested.engine !== input.saved.engine) {
    return {
      status: "blocked",
      reason: `Requested engine ${requested.engine} does not match saved engine ${input.saved.engine}.`,
    };
  }

  const account = requested.account;
  if (
    input.listedFixtureAuthority &&
    account?.kind === "fixture" &&
    listedFixtureForAccount(input.listedFixtures ?? [], account)
  ) {
    if (!requested.engine && !input.saved?.engine) {
      return {
        status: "blocked",
        reason: `Account ${account.accountId} v${account.accountRevision} cannot bind without a browser engine.`,
      };
    }
    return { status: "bound" };
  }
  if (input.listedFixtureAuthority && account?.kind === "signed-out") {
    if (!requested.engine && !input.saved?.engine) {
      return {
        status: "blocked",
        reason: "Signed out cannot bind without a browser engine.",
      };
    }
    return { status: "bound" };
  }
  if (!account) {
    if (requested.engine && !input.saved?.engine) {
      return {
        status: "blocked",
        reason: "A browser engine request cannot bind without a saved engine.",
      };
    }
    return { status: "bound" };
  }
  const savedFixture = input.saved?.authenticationFixtureId?.trim();

  if (account.kind === "signed-out") {
    if (savedFixture) {
      return {
        status: "blocked",
        reason: "Signed out cannot reuse a saved account fixture.",
      };
    }
    return { status: "bound" };
  }

  if (!requested.engine || !input.saved?.engine) {
    return {
      status: "blocked",
      reason: `Account ${account.accountId} v${account.accountRevision} cannot bind without a saved browser engine.`,
    };
  }

  const requestedRevision = account.accountRevision.trim();
  const requestedReference = parseCanonicalFixtureReference(account.reference);
  const savedReference = parseCanonicalFixtureReference(savedFixture);
  if (!savedReference) {
    return {
      status: "blocked",
      reason: `The saved runtime profile does not name a canonical fixture for account ${account.accountId} revision ${requestedRevision}.`,
    };
  }
  if (savedReference.revision !== requestedRevision) {
    return {
      status: "blocked",
      reason: `Requested account revision ${requestedRevision} does not match saved fixture revision ${savedReference.revision}.`,
    };
  }
  if (account.reference && !requestedReference) {
    return {
      status: "blocked",
      reason: `Requested account ${account.accountId} v${requestedRevision} is not a canonical fixture reference.`,
    };
  }
  if (requestedReference && requestedReference.revision !== requestedRevision) {
    return {
      status: "blocked",
      reason: `Requested account ${account.accountId} v${requestedRevision} contradicts fixture reference ${account.reference}.`,
    };
  }
  if (
    requestedReference &&
    (requestedReference.fixtureId !== savedReference.fixtureId ||
      requestedReference.revision !== savedReference.revision)
  ) {
    return {
      status: "blocked",
      reason: `Requested account ${account.accountId} v${requestedRevision} does not match saved fixture ${savedFixture}.`,
    };
  }
  const mappedId = input.accountFixtureIds?.[account.accountId] ?? account.accountId;
  if (mappedId !== savedReference.fixtureId) {
    return {
      status: "blocked",
      reason: `Requested account ${account.accountId} v${requestedRevision} does not map to saved fixture ${savedFixture}.`,
    };
  }
  return { status: "bound" };
}

/** Account/engine without an explicit platform is a browser case. */
export function browserIdentityPlatform(
  platform: string | undefined,
  requested?: { engine?: string; account?: RequestedBrowserAccount },
): string | undefined {
  if (platform) return platform;
  if (requested?.account || requested?.engine) return "browser";
  return undefined;
}
