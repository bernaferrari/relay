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

export function browserRuntimeConfigurationDigest(input: {
  targetId: string;
  engine?: string;
  authenticationFixtureId?: string;
  signedOut?: boolean;
}): string {
  const identity = input.signedOut
    ? "signed-out"
    : (parseCanonicalFixtureReference(input.authenticationFixtureId)?.fixtureId ??
      input.authenticationFixtureId ??
      "authoring");
  return `${input.targetId}:${input.engine ?? ""}:${identity}:${input.signedOut ? "out" : "in"}`;
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
    return key.startsWith(`live:${input.targetId}:`) || key === `proof:${input.targetId}`;
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

/** Same saved profile must equal the requested identity. Undefined request
 * does not match an existing session. */
export function browserSessionProfileMatches(existing: unknown, requested: unknown): boolean {
  if (requested === undefined) return false;
  return JSON.stringify(existing) === JSON.stringify(requested);
}

export function bindRequestedBrowserIdentity(input: {
  requested?: { engine?: string; account?: RequestedBrowserAccount };
  saved?: SavedBrowserIdentity;
  platform?: string;
  /** Reviewed accountId → canonical fixture id. Display names are not authority. */
  accountFixtureIds?: Readonly<Record<string, string>>;
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
