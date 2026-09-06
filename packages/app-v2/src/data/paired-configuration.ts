import type { ProductRunStartInput } from "@relay/product/run-journey";
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
  coverage:
    | { kind: "signed-out" }
    | { kind: "browser-account"; accountId: string }
    | { kind: "browser-engine"; engine: BrowserEngine };
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
  };
}

/** One saved row is one execution. Browsers and accounts are never crossed. */
export function compilePairedConfigurations(
  workspace: PairedConfigurationWorkspace,
): FrozenPairedConfiguration[] {
  return workspace.rows.map((row) => {
    const coverage = row.accountId
      ? { kind: "browser-account" as const, accountId: row.accountId }
      : row.engine
        ? { kind: "browser-engine" as const, engine: row.engine }
        : { kind: "signed-out" as const };
    return {
      rowId: row.id,
      name: row.name,
      targetId: row.browserId,
      ...(row.engine ? { engine: row.engine } : {}),
      ...(row.accountId ? { accountId: row.accountId } : {}),
      ...(row.accountRevision ? { accountRevision: row.accountRevision } : {}),
      coverage,
    };
  });
}

export function compileTestStarts(input: {
  testId: string;
  appMapId?: string;
  workspace: PairedConfigurationWorkspace;
  sourceRevision?: ProductRunStartInput["sourceRevision"];
  startup?: ProductRunStartInput["startup"];
}): ProductRunStartInput[] {
  return compilePairedConfigurations(input.workspace).map((configuration) => ({
    testId: input.testId,
    ...(input.appMapId ? { appMapId: input.appMapId } : {}),
    targetId: configuration.targetId,
    ...(input.sourceRevision ? { sourceRevision: input.sourceRevision } : {}),
    ...(input.startup ? { startup: input.startup } : {}),
  }));
}

export function compileSuiteTargets(
  workspace: PairedConfigurationWorkspace,
  environments: readonly { id: string; targetId: string }[],
): { profileIds: string[]; unresolved: string[] } {
  const profileIds: string[] = [];
  const unresolved: string[] = [];
  for (const configuration of compilePairedConfigurations(workspace)) {
    const profile = environments.find((item) => item.targetId === configuration.targetId);
    if (profile) profileIds.push(profile.id);
    else unresolved.push(configuration.name);
  }
  return { profileIds, unresolved };
}

export function compileRepeatScope(input: {
  workspace: PairedConfigurationWorkspace;
  dataCaseCount: number;
}): { executionCount: number; pairCount: number; scopeLabel: string } {
  const pairCount = compilePairedConfigurations(input.workspace).length;
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

export function liveOpenPlan(workspace: PairedConfigurationWorkspace): readonly {
  name: string;
  browserId: string;
  accountId?: string;
  accountName?: string;
}[] {
  return workspace.rows.map((row) => ({
    name: row.name,
    browserId: row.browserId,
    ...(row.accountId ? { accountId: row.accountId } : {}),
    ...(row.accountName ? { accountName: row.accountName } : {}),
  }));
}

export async function openPairedWorkspaceInLive(input: {
  workspace: PairedConfigurationWorkspace;
  openSpace: (browserId: string) => Promise<unknown>;
}): Promise<{ opened: number; plan: ReturnType<typeof liveOpenPlan> }> {
  const plan = liveOpenPlan(input.workspace);
  for (const row of plan) await input.openSpace(row.browserId);
  return { opened: plan.length, plan };
}

export async function startPairedTestRuns(input: {
  start: (request: ProductRunStartInput) => Promise<unknown>;
  testId: string;
  appMapId?: string;
  workspace: PairedConfigurationWorkspace;
  sourceRevision?: ProductRunStartInput["sourceRevision"];
  startup?: ProductRunStartInput["startup"];
}): Promise<{
  requests: ProductRunStartInput[];
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
