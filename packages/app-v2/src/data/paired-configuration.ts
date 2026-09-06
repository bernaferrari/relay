import type {
  ProductRunAccountBinding,
  ProductRunProfileOption,
  ProductRunStartInput,
} from "@relay/product/run-journey";
import type { BrowserEngine } from "@relay/protocol";

export const PAIRED_CONFIGURATION_STORAGE_KEY = "paired-configuration-workspace";

export type PairedConfigurationRow = {
  id: string;
  name: string;
  browserId: string;
  browserName: string;
  engine?: BrowserEngine;
  accountId?: string;
  accountName?: string;
  accountRevision?: string;
  accountReference?: string;
  /** Explicit human choice of a clean signed-out browser. A missing account
   * is not attested signed-out. */
  signedOutAttested?: true;
};

export type PairedConfigurationWorkspace = {
  schemaVersion: 1;
  rows: readonly PairedConfigurationRow[];
  updatedAt: number;
};

export type FrozenPairedConfiguration = {
  rowId: string;
  name: string;
  targetId: string;
  engine?: BrowserEngine;
  accountId?: string;
  accountRevision?: string;
  accountReference?: string;
  signedOutAttested?: true;
  coverage:
    | { kind: "signed-out"; attested: true }
    | { kind: "browser-account"; accountId: string; accountRevision: string }
    | { kind: "blocked"; reason: string };
};

/** Compiled pair identity. Account and engine are required so a later hop
 * cannot drop them and collapse Admin/Member into the same start. */
export type BoundExecutionIdentity = {
  targetId: string;
  engine: BrowserEngine;
  account: ProductRunAccountBinding;
  targetProfileId?: string;
};

export type BoundTestStart = BoundExecutionIdentity & {
  testId: string;
  appMapId?: string;
  sourceRevision?: ProductRunStartInput["sourceRevision"];
  startup?: ProductRunStartInput["startup"];
};

export type PairedStartAdmission =
  | { status: "ready"; request: BoundTestStart; configuration: FrozenPairedConfiguration }
  | { status: "blocked"; configuration: FrozenPairedConfiguration; reason: string };

export type PairedStartProfile = Pick<ProductRunProfileOption, "id" | "targetId"> & {
  account?: { id?: string; reference?: string };
};

export function emptyPairedWorkspace(now = Date.now()): PairedConfigurationWorkspace {
  return { schemaVersion: 1, rows: [], updatedAt: now };
}

export function parsePairedConfigurationWorkspace(
  raw: string | null | undefined,
): PairedConfigurationWorkspace {
  if (!raw) return emptyPairedWorkspace(0);
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Saved Browser and Account workspace is invalid.");
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1 || !Array.isArray(record.rows)) {
    throw new TypeError("Saved Browser and Account workspace is invalid.");
  }
  const rows = record.rows.map(parseRow);
  return {
    schemaVersion: 1,
    rows,
    updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : 0,
  };
}

function parseRow(value: unknown): PairedConfigurationRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Saved workspace row is invalid.");
  }
  const record = value as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const browserId = typeof record.browserId === "string" ? record.browserId.trim() : "";
  const browserName = typeof record.browserName === "string" ? record.browserName.trim() : "";
  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (!id || !name || !browserId) throw new TypeError("Saved workspace row is incomplete.");
  const engine =
    record.engine === "chromium" || record.engine === "firefox" || record.engine === "webkit"
      ? record.engine
      : undefined;
  const accountId = typeof record.accountId === "string" ? record.accountId.trim() : "";
  return {
    id,
    name,
    browserId,
    browserName: browserName || name,
    ...(engine ? { engine } : {}),
    ...(accountId ? { accountId } : {}),
    ...(typeof record.accountName === "string" && record.accountName.trim()
      ? { accountName: record.accountName.trim() }
      : {}),
    ...(typeof record.accountRevision === "string" && record.accountRevision.trim()
      ? { accountRevision: record.accountRevision.trim() }
      : {}),
    ...(typeof record.accountReference === "string" && record.accountReference.trim()
      ? { accountReference: record.accountReference.trim() }
      : {}),
    ...(record.signedOutAttested === true ? { signedOutAttested: true as const } : {}),
  };
}

function accountBinding(
  configuration: FrozenPairedConfiguration,
): ProductRunAccountBinding | undefined {
  if (configuration.coverage.kind === "signed-out") {
    return { kind: "signed-out", attested: true };
  }
  if (configuration.coverage.kind === "browser-account") {
    return {
      kind: "fixture",
      accountId: configuration.coverage.accountId,
      accountRevision: configuration.coverage.accountRevision,
      ...(configuration.accountReference ? { reference: configuration.accountReference } : {}),
    };
  }
  return undefined;
}

function profileMatchesAccount(
  profile: PairedStartProfile,
  configuration: FrozenPairedConfiguration,
): boolean {
  if (profile.targetId !== configuration.targetId) return false;
  if (configuration.coverage.kind === "signed-out") {
    return !profile.account?.id && !profile.account?.reference;
  }
  if (configuration.coverage.kind !== "browser-account") return false;
  const accountId = configuration.accountId;
  const reference =
    configuration.accountReference ??
    (accountId && configuration.accountRevision
      ? `authfx:${accountId}:${configuration.accountRevision}`
      : undefined);
  return (
    profile.account?.id === accountId ||
    profile.account?.reference === accountId ||
    (reference !== undefined &&
      (profile.account?.id === reference || profile.account?.reference === reference))
  );
}

/** One saved row is one execution. Browsers and accounts are never crossed. */
export function compilePairedConfigurations(
  workspace: PairedConfigurationWorkspace,
): FrozenPairedConfiguration[] {
  return workspace.rows.map((row) => {
    const accountId = row.accountId?.trim();
    const accountRevision = row.accountRevision?.trim();
    let coverage: FrozenPairedConfiguration["coverage"];
    if (accountId && accountRevision) {
      coverage = { kind: "browser-account", accountId, accountRevision };
    } else if (accountId && !accountRevision) {
      coverage = {
        kind: "blocked",
        reason:
          "This account has no fixture revision. Save the exact account revision before running.",
      };
    } else if (row.signedOutAttested === true) {
      coverage = { kind: "signed-out", attested: true };
    } else {
      coverage = {
        kind: "blocked",
        reason:
          "A blank account is not signed out. Attest a clean signed-out state or choose an account fixture.",
      };
    }
    return {
      rowId: row.id,
      name: row.name,
      targetId: row.browserId,
      ...(row.engine ? { engine: row.engine } : {}),
      ...(accountId ? { accountId } : {}),
      ...(accountRevision ? { accountRevision } : {}),
      ...(row.accountReference ? { accountReference: row.accountReference } : {}),
      ...(row.signedOutAttested ? { signedOutAttested: true as const } : {}),
      coverage,
    };
  });
}

export function admitPairedTestStarts(input: {
  testId: string;
  appMapId?: string;
  workspace: PairedConfigurationWorkspace;
  sourceRevision?: ProductRunStartInput["sourceRevision"];
  startup?: ProductRunStartInput["startup"];
  profiles?: readonly PairedStartProfile[];
}): PairedStartAdmission[] {
  return compilePairedConfigurations(input.workspace).map((configuration) => {
    if (configuration.coverage.kind === "blocked") {
      return { status: "blocked", configuration, reason: configuration.coverage.reason };
    }
    const account = accountBinding(configuration);
    if (!account || !configuration.engine) {
      return {
        status: "blocked",
        configuration,
        reason: !configuration.engine
          ? "This pair has no browser engine. Choose Chromium, Firefox, or WebKit before running."
          : "This pair has no executable account identity.",
      };
    }
    let targetProfileId: string | undefined;
    if (input.profiles) {
      const matches = input.profiles.filter((profile) =>
        profileMatchesAccount(profile, configuration),
      );
      if (matches.length !== 1) {
        return {
          status: "blocked",
          configuration,
          reason:
            matches.length === 0
              ? "Relay has no saved profile for this Browser and Account pair."
              : "More than one saved profile matches this Browser and Account pair.",
        };
      }
      targetProfileId = matches[0]!.id;
    }
    return {
      status: "ready",
      configuration,
      request: {
        testId: input.testId,
        ...(input.appMapId ? { appMapId: input.appMapId } : {}),
        targetId: configuration.targetId,
        engine: configuration.engine,
        account,
        ...(targetProfileId ? { targetProfileId } : {}),
        ...(input.sourceRevision ? { sourceRevision: input.sourceRevision } : {}),
        ...(input.startup ? { startup: input.startup } : {}),
      },
    };
  });
}

export function compileTestStarts(input: {
  testId: string;
  appMapId?: string;
  workspace: PairedConfigurationWorkspace;
  sourceRevision?: ProductRunStartInput["sourceRevision"];
  startup?: ProductRunStartInput["startup"];
  profiles?: readonly PairedStartProfile[];
}): BoundTestStart[] {
  const admitted = admitPairedTestStarts(input);
  const blocked = admitted.filter((item) => item.status === "blocked");
  if (blocked.length) {
    throw new TypeError(
      blocked.map((item) => `${item.configuration.name}: ${item.reason}`).join(" "),
    );
  }
  return admitted
    .filter(
      (item): item is Extract<PairedStartAdmission, { status: "ready" }> => item.status === "ready",
    )
    .map((item) => item.request);
}

export function compileSuiteTargets(
  workspace: PairedConfigurationWorkspace,
  environments: readonly {
    id: string;
    targetId: string;
    accountId?: string;
    authenticationOptions?: readonly { id?: string; reference?: string }[];
  }[],
): { profileIds: string[]; unresolved: string[] } {
  const profileIds: string[] = [];
  const claimed = new Set<string>();
  const unresolved: string[] = [];
  for (const configuration of compilePairedConfigurations(workspace)) {
    if (configuration.coverage.kind === "blocked") {
      unresolved.push(configuration.name);
      continue;
    }
    const profile = environments.find((item) => {
      if (item.targetId !== configuration.targetId) return false;
      if (configuration.coverage.kind === "signed-out") {
        return !item.accountId;
      }
      const accountId = configuration.accountId;
      const options = item.authenticationOptions ?? [];
      return (
        item.accountId === accountId ||
        options.some((option) => option.id === accountId || option.reference === accountId)
      );
    });
    const claim = profile ? `${profile.id}:${configuration.accountId ?? "signed-out"}` : undefined;
    if (profile && claim && !claimed.has(claim) && !profileIds.includes(profile.id)) {
      profileIds.push(profile.id);
      claimed.add(claim);
    } else if (profile && profileIds.includes(profile.id)) {
      unresolved.push(configuration.name);
    } else {
      unresolved.push(configuration.name);
    }
  }
  return { profileIds, unresolved };
}

export function compileRepeatScope(input: {
  workspace: PairedConfigurationWorkspace;
  dataCaseCount: number;
}): { executionCount: number; pairCount: number; scopeLabel: string } {
  const pairCount = compilePairedConfigurations(input.workspace).filter(
    (item) => item.coverage.kind !== "blocked",
  ).length;
  const dataCaseCount = Math.max(0, input.dataCaseCount);
  const executionCount = pairCount * dataCaseCount;
  return {
    pairCount,
    executionCount,
    scopeLabel:
      pairCount === 0
        ? "No paired Browser and Account rows are saved."
        : `${executionCount} ${executionCount === 1 ? "execution" : "executions"} · ${pairCount} paired ${pairCount === 1 ? "configuration" : "configurations"}`,
  };
}

export type LiveOpenPlanRow = {
  name: string;
  browserId: string;
  accountId?: string;
  accountName?: string;
  accountRevision?: string;
  accountReference?: string;
  signedOut?: true;
};

export function liveOpenPlan(workspace: PairedConfigurationWorkspace): readonly LiveOpenPlanRow[] {
  return workspace.rows.map((row) => ({
    name: row.name,
    browserId: row.browserId,
    ...(row.accountId ? { accountId: row.accountId } : {}),
    ...(row.accountName ? { accountName: row.accountName } : {}),
    ...(row.accountRevision ? { accountRevision: row.accountRevision } : {}),
    ...(row.accountReference ? { accountReference: row.accountReference } : {}),
    ...(row.signedOutAttested ? { signedOut: true as const } : {}),
  }));
}

function liveAccountKey(row: LiveOpenPlanRow): string {
  if (row.signedOut) return "signed-out";
  if (row.accountReference) return `fixture:${row.accountReference}`;
  if (row.accountId && row.accountRevision) {
    return `fixture:${row.accountId}:${row.accountRevision}`;
  }
  if (row.accountId) return `fixture:${row.accountId}`;
  return "unknown";
}

/** Admin, Member, and Signed out cannot share one persistent Browser session. */
export function admitLiveOpenPlan(
  workspace: PairedConfigurationWorkspace,
): readonly LiveOpenPlanRow[] {
  const compiled = compilePairedConfigurations(workspace);
  const blocked = compiled.filter((item) => item.coverage.kind === "blocked");
  if (blocked.length) {
    throw new TypeError(
      blocked
        .map(
          (item) => `${item.name}: ${item.coverage.kind === "blocked" ? item.coverage.reason : ""}`,
        )
        .join(" "),
    );
  }
  const plan = liveOpenPlan(workspace);
  const identities = new Map<string, Set<string>>();
  for (const row of plan) {
    const key = liveAccountKey(row);
    const seen = identities.get(row.browserId) ?? new Set<string>();
    seen.add(key);
    identities.set(row.browserId, seen);
  }
  const shared = [...identities.entries()].filter(([, keys]) => keys.size > 1);
  if (shared.length) {
    throw new TypeError(
      "Admin, Member, and Signed out cannot share one persistent Browser session. Give each account its own Browser.",
    );
  }
  return plan;
}

export async function openPairedWorkspaceInLive(input: {
  workspace: PairedConfigurationWorkspace;
  openSpace: (plan: LiveOpenPlanRow) => Promise<unknown>;
}): Promise<{ opened: number; plan: ReturnType<typeof liveOpenPlan> }> {
  const plan = admitLiveOpenPlan(input.workspace);
  for (const row of plan) await input.openSpace(row);
  return { opened: plan.length, plan };
}

export async function startPairedTestRuns(input: {
  start: (request: BoundTestStart) => Promise<unknown>;
  testId: string;
  appMapId?: string;
  workspace: PairedConfigurationWorkspace;
  sourceRevision?: ProductRunStartInput["sourceRevision"];
  startup?: ProductRunStartInput["startup"];
}): Promise<{
  requests: BoundTestStart[];
  started: unknown[];
  first: unknown;
}> {
  const requests = compileTestStarts(input);
  if (!requests.length) throw new TypeError("Save at least one Browser and Account pair.");
  const started: unknown[] = [];
  for (const request of requests) started.push(await input.start(request));
  return { requests, started, first: started[0] };
}

export function pairedWorkspaceSummary(workspace: PairedConfigurationWorkspace): string {
  const count = workspace.rows.length;
  if (count === 0) return "No paired Browser and Account rows yet.";
  return `${count} paired ${count === 1 ? "configuration" : "configurations"}`;
}
