import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  browserAuthenticationHealthSchema,
  electronGrokLabProductPathBlocker,
  type BrowserAuthenticationFixture,
  type BrowserAuthenticationHealth,
  type BrowserLaneSessionStoreKind,
} from "@relay/protocol";
import { probeElectronGrokLabPartitionPresent } from "./electron-grok-lab-partition.js";
import { identityPolicyForTarget, type AppIdentityPolicy } from "./app-identity-policy.js";
import { findWorkspaceRoot } from "./workspace-root.js";
import {
  browserAuthenticationStorageState,
  isBrowserAuthenticationFixtureReference,
  listBrowserAuthenticationFixtures,
  listBrowserAuthenticationFixturesSync,
} from "./browser-authentication-fixtures.js";
import { listedFixtureForAccount } from "./browser-execution-identity.js";

export type BrowserAuthPageSnapshot = {
  title: string;
  bodyText: string;
  labels?: readonly string[];
};

const ACCOUNT_IDENTITY_STAND_INS = new Set([
  "super grok",
  "supergrok",
  "grok-lab",
  "grok-daily",
  "grok-daily-b",
  "grok-daily-c",
  "grok-daily-d",
  "grok-daily-e",
  "grok-daily-f",
  "grok-daily-g",
  "grok-daily-h",
  "grok-auth-email",
  "grok-auth-gmail",
  "grok-auth-x",
  "grok-auth-x-out",
  "sign in",
  "sign up",
  "new chat",
  "imagine",
]);

function normalizeIdentityCandidate(value: string): string | undefined {
  const trimmed = value.replace(/\s+/gu, " ").trim();
  if (!trimmed || trimmed.length > 80) return undefined;
  const key = trimmed.toLocaleLowerCase();
  if (ACCOUNT_IDENTITY_STAND_INS.has(key) || key.startsWith("grok-")) return undefined;
  return trimmed;
}

function collapseIdentityLine(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function personNameCandidate(value: string): string | undefined {
  const normalized = normalizeIdentityCandidate(value);
  if (!normalized) return undefined;
  if (!/^[A-Z][a-z]{1,30}(?: [A-Z][a-z]{1,30}){1,2}$/u.test(normalized)) return undefined;
  return normalized;
}

function nameMatchesInitials(letters: string, name: string): boolean {
  const words = name.split(/\s+/u);
  if (letters.length !== words.length) return false;
  return words.every((word, index) => word.startsWith(letters[index] ?? ""));
}

function identityFromInitialsAndName(letters: string, name: string): string | undefined {
  const person = personNameCandidate(name);
  if (!person || !nameMatchesInitials(letters, person)) return undefined;
  return person;
}

/** Live page account name. Lane ids, SuperGrok, and saved fixture names are not identity. */
export function extractProbedAccountIdentity(
  snapshot: BrowserAuthPageSnapshot,
  savedName?: string,
): string | undefined {
  const saved = savedName?.replace(/\s+/gu, " ").trim().toLocaleLowerCase();
  const lines = [...(snapshot.labels ?? []), ...snapshot.bodyText.split(/\r?\n/u), snapshot.title]
    .map(collapseIdentityLine)
    .filter((line) => line.length > 0);
  const accept = (value: string | undefined): string | undefined =>
    value && value.toLocaleLowerCase() !== saved ? value : undefined;

  for (const raw of lines) {
    const profile = raw.match(/profile picture,\s*([^,]+)/iu);
    const fromProfile = accept(normalizeIdentityCandidate(profile?.[1] ?? ""));
    if (fromProfile) return fromProfile;
    const initials = raw.match(/^([A-Z]{1,3}) (.+)$/u);
    const fromInitials = accept(
      identityFromInitialsAndName(initials?.[1] ?? "", initials?.[2] ?? ""),
    );
    if (fromInitials) return fromInitials;
  }

  const initialTokens = lines.filter((line) => /^[A-Z]{1,3}$/u.test(line));
  for (const letters of initialTokens) {
    for (const line of lines) {
      const fromSplit = accept(identityFromInitialsAndName(letters, line));
      if (fromSplit) return fromSplit;
    }
  }
  return undefined;
}

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
        detail: "Opened signed out. Complete OAuth, then Refresh.",
      };
    }
    if (signedIn === true) {
      const identity = extractProbedAccountIdentity(page, fixture.name);
      return {
        status: "ready",
        checkedAt: now,
        signedIn: true,
        detail: identity
          ? `Signed in as ${identity}.`
          : "Signed in. Page did not show an account name.",
        ...(identity ? { identity } : {}),
      };
    }
    return {
      status: "error",
      checkedAt: now,
      detail: "Page did not show a signed-in or signed-out marker.",
    };
  }
  return {
    status: "ready",
    checkedAt: now,
    detail: `${fixture.name} is not expired.`,
  };
}

export function planAccountHealthBlocker(
  health: BrowserAuthenticationHealth,
  extra?: { readyCount?: number },
): string | undefined {
  const blocked = extra?.readyCount === 0 || health.signedIn === false || health.status !== "ready";
  if (!blocked) return undefined;
  if (health.status === "revoked") return health.detail ?? "This sign-in is revoked.";
  return `${health.detail ?? "This sign-in is not ready."} Open Sign-ins, complete OAuth, then Refresh.`;
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
  /** Claimed fixture ready count. Zero with a signed-in fixture fails closed. */
  readyCount?: number;
}): string | undefined {
  if (input.account?.kind === "signed-out") return undefined;
  const claimsSignedInFixture =
    input.account?.kind === "fixture" || Boolean(input.savedFixtureReference?.trim());
  if (!claimsSignedInFixture) return undefined;
  const listedMatch =
    input.account?.kind === "fixture" && input.account.accountId && input.account.accountRevision
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
    (input.account?.kind === "fixture" ? input.account.reference?.trim() : undefined) ||
    listedMatch?.reference ||
    input.savedFixtureReference?.trim();
  if (!reference) return undefined;
  const health = input.fixtures.find((item) => item.reference === reference)?.health;
  if (input.readyCount === 0) {
    return health
      ? planAccountHealthBlocker(health, { readyCount: 0 })
      : "No ready sign-in for this Plan. Open Sign-ins, complete OAuth, then Refresh.";
  }
  return health ? planAccountHealthBlocker(health) : undefined;
}

/** Typed fail-close for enqueue paths that are not HTTP (scheduler, option-run). */
export class AccountNeedsReloginError extends Error {
  readonly code = "ACCOUNT_NEEDS_RELOGIN" as const;
  constructor(readonly detail: string) {
    super(`ACCOUNT_NEEDS_RELOGIN: ${detail}`);
    this.name = "AccountNeedsReloginError";
  }
}

/** Fail-closed start check for a Test/Lane/cell that claims a signed-in fixture. */
export async function claimedFixtureStartBlocker(input: {
  projectId: string;
  targetId: string;
  account?: {
    kind: string;
    reference?: string;
    accountId?: string;
    accountRevision?: string;
  };
  savedFixtureReference?: string;
}): Promise<string | undefined> {
  if (input.account?.kind === "signed-out") return undefined;
  if (input.account?.kind !== "fixture" && !input.savedFixtureReference?.trim()) {
    return undefined;
  }
  const listed = await listBrowserAuthenticationFixtures({
    projectId: input.projectId,
    targetId: input.targetId,
  });
  const attached = await attachBrowserAuthenticationHealth(listed);
  const listedMatch =
    input.account?.kind === "fixture" && input.account.accountId && input.account.accountRevision
      ? listedFixtureForAccount(attached, {
          accountId: input.account.accountId,
          accountRevision: input.account.accountRevision,
          ...(input.account.reference ? { reference: input.account.reference } : {}),
        })
      : undefined;
  const claimed =
    (input.account?.kind === "fixture" ? input.account.reference?.trim() : undefined) ||
    listedMatch?.reference ||
    input.savedFixtureReference?.trim();
  return planAccountStartBlocker({
    account: input.account,
    savedFixtureReference: input.savedFixtureReference,
    fixtures: attached,
    readyCount: attached.filter(
      (fixture) => fixture.reference === claimed && fixture.health.status === "ready",
    ).length,
  });
}

/** Remembered health wins. Parent blocked health cannot be dropped to SuperGrok. */
export function retryAuthenticationHealthStamp(input: {
  parent?: BrowserAuthenticationHealth;
  remembered?: BrowserAuthenticationHealth;
}): { blocker?: string; authenticationHealth?: BrowserAuthenticationHealth } {
  if (input.remembered) {
    const blocker = planAccountHealthBlocker(input.remembered);
    if (blocker) return { blocker };
    return { authenticationHealth: structuredClone(input.remembered) };
  }
  if (input.parent) {
    const blocker = planAccountHealthBlocker(input.parent);
    if (blocker) return { blocker };
    return { authenticationHealth: structuredClone(input.parent) };
  }
  return {};
}

function claimedFixtureReference(input: {
  browserCaseProfile?: { authenticationFixtureId?: string };
  targetProfile?: { browserCaseProfile?: { authenticationFixtureId?: string } };
}): string | undefined {
  return (
    input.browserCaseProfile?.authenticationFixtureId?.trim() ||
    input.targetProfile?.browserCaseProfile?.authenticationFixtureId?.trim() ||
    undefined
  );
}

type ClaimedBrowserJobStartInput = {
  projectId: string;
  targetId?: string;
  laneId?: string;
  sessionStore?: BrowserLaneSessionStoreKind;
  presentation?: "embedded" | "external";
  electronGrokLabPartitionPresent?: boolean;
  browserCaseProfile?: { authenticationFixtureId?: string };
  targetProfile?: { browserCaseProfile?: { authenticationFixtureId?: string } };
  parentAuthenticationHealth?: BrowserAuthenticationHealth;
};

function electronGrokLabStartBlocker(input: ClaimedBrowserJobStartInput): string | undefined {
  return electronGrokLabProductPathBlocker({
    laneId: input.laneId,
    sessionStore: input.sessionStore,
    presentation: input.presentation,
    electronGrokLabPartitionPresent:
      input.electronGrokLabPartitionPresent ?? probeElectronGrokLabPartitionPresent(),
  });
}

function evaluateClaimedBrowserJobStart(input: {
  savedFixtureReference: string;
  fixtures: readonly { reference: string; health: BrowserAuthenticationHealth }[];
  remembered?: BrowserAuthenticationHealth;
  parentAuthenticationHealth?: BrowserAuthenticationHealth;
}): { blocker?: string; authenticationHealth?: BrowserAuthenticationHealth } {
  const known = input.fixtures.some((item) => item.reference === input.savedFixtureReference);
  const listedBlocker =
    known || isBrowserAuthenticationFixtureReference(input.savedFixtureReference)
      ? planAccountStartBlocker({
          savedFixtureReference: input.savedFixtureReference,
          fixtures: input.fixtures,
          readyCount: input.fixtures.filter(
            (fixture) =>
              fixture.reference === input.savedFixtureReference &&
              fixture.health.status === "ready",
          ).length,
        })
      : undefined;
  const stamp = retryAuthenticationHealthStamp({
    parent: input.parentAuthenticationHealth,
    remembered: input.remembered,
  });
  if (listedBlocker) return { blocker: listedBlocker };
  if (stamp.blocker) return { blocker: stamp.blocker };
  return { authenticationHealth: stamp.authenticationHealth };
}

function attachRememberedHealth<
  T extends Pick<BrowserAuthenticationFixture, "reference" | "name" | "expiresAt" | "revokedAt">,
>(
  fixtures: readonly T[],
  remembered: HealthIndex,
  now = Date.now(),
): Array<T & { health: BrowserAuthenticationHealth }> {
  return fixtures.map((fixture) => {
    const stored = remembered[fixture.reference];
    const health = classifyBrowserAuthenticationHealth(fixture, now, undefined);
    if (health.status !== "ready") return { ...fixture, health };
    return { ...fixture, health: stored ?? health };
  });
}

/** Fail-closed enqueue check for flow/connection/job/retry/replay identities. */
export async function claimedBrowserJobStartBlocker(
  input: ClaimedBrowserJobStartInput,
): Promise<{ blocker?: string; authenticationHealth?: BrowserAuthenticationHealth }> {
  const electronBlocker = electronGrokLabStartBlocker(input);
  if (electronBlocker) return { blocker: electronBlocker };
  const savedFixtureReference = claimedFixtureReference(input);
  if (!savedFixtureReference) return {};
  const targetId = input.targetId?.trim();
  const listed = targetId
    ? await listBrowserAuthenticationFixtures({
        projectId: input.projectId,
        targetId,
      })
    : [];
  const remembered = await readHealthIndex();
  return evaluateClaimedBrowserJobStart({
    savedFixtureReference,
    fixtures: attachRememberedHealth(listed, remembered),
    remembered: remembered[savedFixtureReference],
    parentAuthenticationHealth: input.parentAuthenticationHealth,
  });
}

/** Sync twin for prepareJobBatch. Same fail-closed rule as the async enqueue check. */
export function claimedBrowserJobStartBlockerSync(input: ClaimedBrowserJobStartInput): {
  blocker?: string;
  authenticationHealth?: BrowserAuthenticationHealth;
} {
  const electronBlocker = electronGrokLabStartBlocker(input);
  if (electronBlocker) return { blocker: electronBlocker };
  const savedFixtureReference = claimedFixtureReference(input);
  if (!savedFixtureReference) return {};
  const targetId = input.targetId?.trim();
  const listed = targetId
    ? listBrowserAuthenticationFixturesSync({
        projectId: input.projectId,
        targetId,
      })
    : [];
  const remembered = readHealthIndexSync();
  return evaluateClaimedBrowserJobStart({
    savedFixtureReference,
    fixtures: attachRememberedHealth(listed, remembered),
    remembered: remembered[savedFixtureReference],
    parentAuthenticationHealth: input.parentAuthenticationHealth,
  });
}

/** Throw instead of returning a blocker. Scheduler and option-run enqueue use this. */
export async function assertClaimedBrowserJobStartAllowed(
  input: ClaimedBrowserJobStartInput,
): Promise<BrowserAuthenticationHealth | undefined> {
  const result = await claimedBrowserJobStartBlocker(input);
  if (result.blocker) throw new AccountNeedsReloginError(result.blocker);
  return result.authenticationHealth;
}

/** Throw from sync job-batch admission so in-process enqueue cannot skip SuperGrok health. */
export function assertClaimedBrowserJobStartAllowedSync(
  input: ClaimedBrowserJobStartInput,
): BrowserAuthenticationHealth | undefined {
  const result = claimedBrowserJobStartBlockerSync(input);
  if (result.blocker) throw new AccountNeedsReloginError(result.blocker);
  return result.authenticationHealth;
}

/** Backstop so Combine-cell enqueue cannot skip a dead signed-in profile. */
export async function preparedCellsFixtureStartBlocker(input: {
  projectId: string;
  cells: readonly {
    executionTarget: { targetId: string; platform?: string };
    selectedRuntimeTargetProfile?: {
      browserCaseProfile?: { authenticationFixtureId?: string };
    };
  }[];
}): Promise<string | undefined> {
  for (const cell of input.cells) {
    if (cell.executionTarget.platform && cell.executionTarget.platform !== "browser") continue;
    const saved =
      cell.selectedRuntimeTargetProfile?.browserCaseProfile?.authenticationFixtureId?.trim();
    if (!saved) continue;
    const blocker = await claimedFixtureStartBlocker({
      projectId: input.projectId,
      targetId: cell.executionTarget.targetId,
      savedFixtureReference: saved,
    });
    if (blocker) return blocker;
  }
  return undefined;
}

function parseHealthIndex(raw: string): HealthIndex {
  const parsed = JSON.parse(raw) as {
    entries?: Record<string, unknown>;
  };
  if (!parsed.entries || typeof parsed.entries !== "object") return {};
  const entries: HealthIndex = {};
  for (const [reference, value] of Object.entries(parsed.entries)) {
    const health = browserAuthenticationHealthSchema.safeParse(value);
    if (health.success) entries[reference] = health.data;
  }
  return entries;
}

function healthIndexFromMissingFile(error: unknown): HealthIndex | undefined {
  if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
  return undefined;
}

async function readHealthIndex(): Promise<HealthIndex> {
  try {
    return parseHealthIndex(await readFile(healthPath(), "utf8"));
  } catch (error) {
    const missing = healthIndexFromMissingFile(error);
    if (missing) return missing;
    throw error;
  }
}

function readHealthIndexSync(): HealthIndex {
  try {
    return parseHealthIndex(readFileSync(healthPath(), "utf8"));
  } catch (error) {
    const missing = healthIndexFromMissingFile(error);
    if (missing) return missing;
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
  return attachRememberedHealth(fixtures, await readHealthIndex(), now);
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
