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

const FIXTURE_REFERENCE = /:([1-9][0-9]*)$/u;

export function fixtureRevisionFromReference(reference: string | undefined): string | undefined {
  if (!reference) return undefined;
  return FIXTURE_REFERENCE.exec(reference)?.[1];
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
}): BrowserIdentityBindResult {
  const requested = input.requested;
  if (!requested?.account && !requested?.engine) return { status: "not-applicable" };
  if (input.platform && input.platform !== "browser") return { status: "not-applicable" };

  if (requested.engine && input.saved?.engine && requested.engine !== input.saved.engine) {
    return {
      status: "blocked",
      reason: `Requested engine ${requested.engine} does not match saved engine ${input.saved.engine}.`,
    };
  }

  const account = requested.account;
  if (!account) return { status: "bound" };
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

  const requestedReference = account.reference?.trim();
  const requestedRevision = account.accountRevision.trim();
  if (savedFixture) {
    const savedRevision = fixtureRevisionFromReference(savedFixture);
    if (savedRevision && savedRevision !== requestedRevision) {
      return {
        status: "blocked",
        reason: `Requested account revision ${requestedRevision} does not match saved fixture revision ${savedRevision}.`,
      };
    }
    if (requestedReference && savedFixture !== requestedReference) {
      return {
        status: "blocked",
        reason: `Requested account ${account.accountId} v${requestedRevision} does not match saved fixture ${savedFixture}.`,
      };
    }
    return { status: "bound" };
  }

  if (input.platform === "browser") {
    return {
      status: "blocked",
      reason: `The saved runtime profile does not name account ${account.accountId} revision ${requestedRevision}.`,
    };
  }
  return { status: "bound" };
}
