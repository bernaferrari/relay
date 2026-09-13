import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  browserAuthenticationHealthSchema,
  type BrowserAuthenticationFixture,
  type BrowserAuthenticationHealth,
} from "@relay/protocol";
import { identityPolicyForTarget, type AppIdentityPolicy } from "./app-identity-policy.js";
import { findWorkspaceRoot } from "./workspace-root.js";
import {
  browserAuthenticationStorageState,
  listBrowserAuthenticationFixtures,
} from "./browser-authentication-fixtures.js";
import { listedFixtureForAccount } from "./browser-execution-identity.js";

export type BrowserAuthPageSnapshot = {
  title: string;
  bodyText: string;
};

type HealthIndex = Record<string, BrowserAuthenticationHealth>;

function workspaceRoot(): string {
  return process.env.RELAY_WORKSPACE_ROOT?.trim() || findWorkspaceRoot();
}

function healthPath(): string {
  return join(workspaceRoot(), ".relay", "browser-auth-health.json");
}

function protocolFixture(
  fixture: Awaited<ReturnType<typeof listBrowserAuthenticationFixtures>>[number],
  health: BrowserAuthenticationHealth,
): BrowserAuthenticationFixture {
  return {
    schemaVersion: fixture.schemaVersion,
    id: fixture.id,
    reference: fixture.reference,
    revision: fixture.revision,
    projectId: fixture.projectId,
    targetId: fixture.targetId,
    name: fixture.name,
    origins: [...fixture.origins],
    cookieCount: fixture.cookieCount,
    createdAt: fixture.createdAt,
    createdBy: fixture.createdBy,
    ...(fixture.expiresAt === undefined ? {} : { expiresAt: fixture.expiresAt }),
    ...(fixture.revokedAt === undefined ? {} : { revokedAt: fixture.revokedAt }),
    ...(fixture.revokedBy === undefined ? {} : { revokedBy: fixture.revokedBy }),
    health,
  };
}

export function signedInFromPage(
  snapshot: BrowserAuthPageSnapshot,
  policy?: AppIdentityPolicy,
): boolean | undefined {
  const markers = policy?.signIn;
  if (!markers) return undefined;
  const haystack = `${snapshot.title}\n${snapshot.bodyText}`.toLocaleLowerCase();
  const signedIn = markers.signedInMarkers.some((marker) => haystack.includes(marker));
  const signedOut = markers.signedOutMarkers.some((marker) => haystack.includes(marker));
  // Logged-out grok.com still shows Imagine / Ask Grok anything next to Sign in.
  // Visible sign-in chrome wins so a fixture that bounced to the wall is needs-relogin.
  if (signedOut) return false;
  if (signedIn) return true;
  return undefined;
}

export function classifyBrowserAuthenticationHealth(
  fixture: Pick<BrowserAuthenticationFixture, "name" | "expiresAt" | "revokedAt">,
  now = Date.now(),
  page?: BrowserAuthPageSnapshot,
  policy?: AppIdentityPolicy,
): BrowserAuthenticationHealth {
  if (fixture.revokedAt !== undefined) {
    return {
      status: "revoked",
      checkedAt: now,
      detail: `${fixture.name} is revoked.`,
    };
  }
  if (fixture.expiresAt !== undefined && fixture.expiresAt <= now) {
    return {
      status: "expired",
      checkedAt: now,
      detail: `${fixture.name} expired. Refresh it before the next Plan.`,
    };
  }
  if (page) {
    const signedIn = signedInFromPage(page, policy);
    if (signedIn === false) {
      return {
        status: "needs-relogin",
        checkedAt: now,
        signedIn: false,
        detail: `${fixture.name} opened signed out. Complete OAuth, then Refresh.`,
      };
    }
    if (signedIn === true) {
      return {
        status: "ready",
        checkedAt: now,
        signedIn: true,
        detail: `${fixture.name} is signed in.`,
      };
    }
    return {
      status: "error",
      checkedAt: now,
      detail: `${fixture.name} did not show a signed-in or signed-out marker.`,
    };
  }
  return {
    status: "ready",
    checkedAt: now,
    detail: `${fixture.name} is not expired.`,
  };
}

export function planAccountHealthBlocker(health: BrowserAuthenticationHealth): string | undefined {
  if (health.status === "ready" || health.status === "error") return undefined;
  if (health.status === "needs-relogin" || health.status === "expired") {
    return `${health.detail ?? "This sign-in needs re-login"} Open Sign-ins, complete OAuth, then Refresh.`;
  }
  if (health.status === "revoked") return health.detail ?? "This sign-in is revoked.";
  return health.detail ?? "This sign-in is not ready.";
}

export function planAccountStartBlocker(input: {
  account?: {
    kind: string;
    reference?: string;
    accountId?: string;
    accountRevision?: string;
  };
  savedFixtureReference?: string;
  fixtures: readonly {
    id?: string;
    name?: string;
    reference: string;
    health: BrowserAuthenticationHealth;
  }[];
}): string | undefined {
  if (input.account?.kind !== "fixture") return undefined;
  const listedMatch =
    input.account.accountId && input.account.accountRevision
      ? listedFixtureForAccount(
          input.fixtures.map((item) => ({
            id: item.id ?? "",
            name: item.name ?? "",
            reference: item.reference,
          })),
          {
            accountId: input.account.accountId,
            accountRevision: input.account.accountRevision,
            ...(input.account.reference ? { reference: input.account.reference } : {}),
          },
        )
      : undefined;
  const reference =
    input.account.reference ??
    listedMatch?.reference ??
    (input.account.accountId && input.account.accountRevision
      ? `authfx:${input.account.accountId}:${input.account.accountRevision}`
      : undefined) ??
    input.savedFixtureReference;
  if (!reference) return undefined;
  const health = input.fixtures.find((item) => item.reference === reference)?.health;
  return health ? planAccountHealthBlocker(health) : undefined;
}

async function readHealthIndex(): Promise<HealthIndex> {
  try {
    const parsed = JSON.parse(await readFile(healthPath(), "utf8")) as {
      entries?: Record<string, unknown>;
    };
    if (!parsed.entries || typeof parsed.entries !== "object") return {};
    const entries: HealthIndex = {};
    for (const [reference, value] of Object.entries(parsed.entries)) {
      const health = browserAuthenticationHealthSchema.safeParse(value);
      if (health.success) entries[reference] = health.data;
    }
    return entries;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function writeHealth(reference: string, health: BrowserAuthenticationHealth): Promise<void> {
  const path = healthPath();
  await mkdir(dirname(path), { recursive: true });
  const entries = await readHealthIndex();
  entries[reference] = health;
  await writeFile(path, `${JSON.stringify({ schemaVersion: 1, entries }, null, 2)}\n`);
}

export async function rememberedBrowserAuthenticationHealth(
  reference: string,
): Promise<BrowserAuthenticationHealth | undefined> {
  return (await readHealthIndex())[reference];
}

export async function attachBrowserAuthenticationHealth<
  T extends Pick<BrowserAuthenticationFixture, "reference" | "name" | "expiresAt" | "revokedAt">,
>(
  fixtures: readonly T[],
  now = Date.now(),
): Promise<Array<T & { health: BrowserAuthenticationHealth }>> {
  const remembered = await readHealthIndex();
  return fixtures.map((fixture) => {
    const stored = remembered[fixture.reference];
    const health = classifyBrowserAuthenticationHealth(fixture, now, undefined);
    if (health.status !== "ready") return { ...fixture, health };
    return { ...fixture, health: stored ?? health };
  });
}

export async function probeBrowserAuthenticationFixture(input: {
  projectId: string;
  targetId: string;
  reference: string;
  now?: number;
  url?: string;
  inspectPage?(url: string): Promise<BrowserAuthPageSnapshot>;
}): Promise<{
  fixture: BrowserAuthenticationFixture;
  health: BrowserAuthenticationHealth;
}> {
  const now = input.now ?? Date.now();
  const fixtures = await listBrowserAuthenticationFixtures({
    projectId: input.projectId,
    targetId: input.targetId,
  });
  const fixture = fixtures.find((item) => item.reference === input.reference);
  if (!fixture)
    throw new Error("Browser authentication fixture was not found in this project and target");
  let page: BrowserAuthPageSnapshot | undefined;
  const metadataHealth = classifyBrowserAuthenticationHealth(fixture, now);
  if (metadataHealth.status === "ready" && input.inspectPage) {
    const origin = input.url ?? fixture.origins[0];
    if (!origin) {
      const health = {
        status: "error" as const,
        checkedAt: now,
        detail: `${fixture.name} has no origin to probe.`,
      };
      await writeHealth(fixture.reference, health);
      return { fixture: protocolFixture(fixture, health), health };
    }
    try {
      await browserAuthenticationStorageState({
        projectId: input.projectId,
        targetId: input.targetId,
        reference: input.reference,
        now,
      });
      page = await input.inspectPage(origin);
    } catch (error) {
      const health = {
        status: "error" as const,
        checkedAt: now,
        detail:
          error instanceof Error
            ? error.message
            : `${fixture.name} could not be opened for a health probe.`,
      };
      await writeHealth(fixture.reference, health);
      return { fixture: protocolFixture(fixture, health), health };
    }
  }
  const policy = identityPolicyForTarget({ browserTargetId: input.targetId });
  const health = classifyBrowserAuthenticationHealth(fixture, now, page, policy);
  await writeHealth(fixture.reference, health);
  return { fixture: protocolFixture(fixture, health), health };
}

export type ScheduledAccountProbeTarget = {
  account?: {
    kind: string;
    accountId?: string;
    accountRevision?: string;
    reference?: string;
  };
  target: {
    targetKind?: string;
    browserTargetId?: string;
  };
};

/** Cookie probe for scheduled Plan columns. Expired / signed-out fixtures
 * fail closed before combine.start queues jobs. */
export async function probeScheduledPlanAccountHealth(input: {
  projectId: string;
  fallbackTargetId?: string;
  profileTargets?: readonly ScheduledAccountProbeTarget[];
  now?: number;
  inspectPage?(
    url: string,
    context: { targetId: string; reference: string },
  ): Promise<BrowserAuthPageSnapshot>;
}): Promise<readonly BrowserAuthenticationHealth[]> {
  const health: BrowserAuthenticationHealth[] = [];
  for (const profile of input.profileTargets ?? []) {
    if (profile.account?.kind !== "fixture") continue;
    const accountId = profile.account.accountId?.trim();
    const accountRevision = profile.account.accountRevision?.trim();
    if (!accountId || !accountRevision) continue;
    const targetId =
      (typeof profile.target.browserTargetId === "string" &&
        profile.target.browserTargetId.trim()) ||
      input.fallbackTargetId?.trim();
    if (!targetId) continue;
    const listed = await listBrowserAuthenticationFixtures({
      projectId: input.projectId,
      targetId,
    });
    const match = listedFixtureForAccount(listed, {
      accountId,
      accountRevision,
      ...(profile.account.reference ? { reference: profile.account.reference } : {}),
    });
    if (!match) continue;
    const probed = await probeBrowserAuthenticationFixture({
      projectId: input.projectId,
      targetId,
      reference: match.reference,
      now: input.now,
      inspectPage: input.inspectPage
        ? (url) => input.inspectPage!(url, { targetId, reference: match.reference })
        : undefined,
    });
    health.push(probed.health);
  }
  return health;
}
