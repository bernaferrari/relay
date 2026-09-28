import type {
  AppMap,
  AppMapScenarioTest,
  AppMapScenarioTestStep,
  RunOutcome,
  RunReview,
  RunSummary,
  RunTestStepEvidence,
} from "@relay/protocol";
import { parseOptionalRunTestStepEvidence, unrecordedProductName } from "@relay/protocol";
import { createRelayOperationPort, type RelayInvokeClient } from "@relay/workflows/operation-port";
import { routeUrls } from "./routes.js";
import { findUniqueProductTestOwner, type ProductTestOwner } from "./test-identity.js";
import { scenarioTestOriginMissingEvidence } from "./test-origin-readiness.js";

/** Public Test state. A missing binding is review work, not an execution error. */
export type ProductTestStatus = "ready" | "needs-review";

export function productTestStatusLabel(
  status: ProductTestStatus,
  name?: string,
): "Ready" | "Needs setup" | "Unrecorded" {
  if (name && unrecordedProductName(name)) return "Unrecorded";
  if (status === "ready") return "Ready";
  return "Needs setup";
}

export type ProductTestFilter = {
  appMapId?: string;
  search?: string;
  status?: ProductTestStatus;
};

export type ProductTestStep = {
  id: string;
  kind: AppMapScenarioTestStep["kind"];
  intent: string;
  label?: string;
  note?: string;
  capture: boolean;
  recordingFrames?: readonly { evidenceId: string; uri: string; role: "before" | "after" }[];
  status: ProductTestStatus;
  children?: readonly ProductTestStep[];
};

export type ProductTestSummary = {
  id: string;
  name: string;
  appMapId: string;
  appName: string;
  stepCount: number;
  status: ProductTestStatus;
  updatedAt: number;
  href: string;
  /** Why the Test cannot run yet ("A step needs fixing"), when it cannot. */
  setupIssue?: string;
  recentRun?: ProductRunSummary;
};

export type ProductTestDetail = ProductTestSummary & {
  description?: string;
  appMapRevision: number;
  steps: readonly ProductTestStep[];
  /** The screen Variant profile this Test was recorded on (browser size and
   * saved login). Runs default to it. */
  recordedProfileId?: string;
  links: { self: string; app: string; edit: string; record: string; run: string };
};

export type ProductRunPhase =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "unknown";
export type ProductRunView = "all" | "latest" | "active" | "failed" | "needs-review";

export type ProductRunFilter = {
  appMapId?: string;
  testId?: string;
  search?: string;
  status?: ProductRunPhase;
  outcome?: RunOutcome;
  view?: ProductRunView;
};

export type ProductRunIdentity = {
  runId: string;
  appMapId?: string;
  testId?: string;
};

export type ProductRunSummary = {
  captureSummary?: RunSummary["captureSummary"];
  /** Known retained frames; zero means the Runs list should not request a thumbnail. */
  frameCount?: number;
  id: string;
  title: string;
  action: string;
  status: string;
  phase: ProductRunPhase;
  outcome?: RunOutcome;
  appMapId?: string;
  testId?: string;
  appName?: string;
  testName?: string;
  targetName?: string;
  platform?: string;
  queuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  batchId?: string;
  caseIndex?: number;
  caseCount?: number;
  review?: RunReview;
  identity: ProductRunIdentity;
  /** Safe, non-secret execution facts used to decide whether a later result
   * can supersede an earlier attention result. Missing facts stay unknown. */
  executionIdentity?: ProductRunExecutionIdentity;
  links: { self: string; test?: string; app?: string; batch?: string };
};

export type ProductRunExecutionIdentity = {
  appMapId?: string;
  testId?: string;
  appMapRevision?: number;
  sourceRevision?: string;
  buildId?: string;
  targetProfileId?: string;
  platform?: string;
  deviceId?: string;
  dataSetId?: string;
  accountId?: string;
  startupMode?: "warm" | "cold" | "verified-checkpoint";
};

export type ProductRunDetail = ProductRunSummary & {
  steps: readonly ProductRunStep[];
  /** Stable authored Test-step evidence joins; empty for legacy Runs. */
  stepEvidence: readonly RunTestStepEvidence[];
  evidence: { available: boolean; frameCount: number; artifactCount: number };
  error?: string;
};

export type ProductRunStep = {
  id?: string;
  index: number;
  title: string;
  status?: string;
  durationMs?: number;
  frameCount: number;
};

export type ProductCatalog = {
  listTests(filter?: ProductTestFilter): Promise<readonly ProductTestSummary[]>;
  getTest(testId: string, appMapId?: string): Promise<ProductTestDetail | undefined>;
  listRuns(filter?: ProductRunFilter): Promise<readonly ProductRunSummary[]>;
  /**
   * Reads the complete bounded Run history by following the server's opaque
   * continuation cursor. Ordinary indexes should use listRuns instead.
   */
  listRunsComplete?(filter?: ProductRunFilter): Promise<readonly ProductRunSummary[]>;
  getRun(runId: string): Promise<ProductRunDetail | undefined>;
};

const MAX_RUN_LIST_PAGES = 100;

const machineName = /^(?:app-map|run|job|test)[:_-]/iu;
const machineTarget = /^(?:emulator-\d+|(?:[0-9a-f]{16,}|[A-Za-z0-9_-]{24,}))$/u;

function nonEmpty(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, 8_192) : undefined;
}

function human(value: unknown, fallback: string): string {
  const candidate = nonEmpty(value);
  return candidate && !machineName.test(candidate) ? candidate : fallback;
}

function targetName(run: RunSummary): string | undefined {
  const candidate = nonEmpty((run as RunSummary & { deviceName?: unknown }).deviceName);
  if (!candidate || machineTarget.test(candidate)) return undefined;
  return candidate;
}

function outcome(value: unknown): RunOutcome | undefined {
  return value === "passed" ||
    value === "product-failure" ||
    value === "harness-failure" ||
    value === "uncertain" ||
    value === "cancelled"
    ? value
    : undefined;
}

function phase(run: Pick<RunSummary, "status" | "outcome">): ProductRunPhase {
  const value = outcome(run.outcome);
  if (value === "cancelled" || /cancel/u.test(run.status)) return "cancelled";
  if (value === "passed") return "completed";
  if (value === "product-failure" || value === "harness-failure") return "failed";
  if (value === "uncertain") return "completed";
  if (/^(?:queued|pending|waiting)$/iu.test(run.status)) return "queued";
  if (/^(?:running|started|in-progress|active|paused)$/iu.test(run.status)) return "running";
  if (/^(?:ok|healed|succeeded|success|completed|complete)$/iu.test(run.status)) return "completed";
  if (/^(?:error|failed|failure)$/iu.test(run.status)) return "failed";
  return "unknown";
}

function stepHasReview(step: AppMapScenarioTestStep): boolean {
  if (step.execution?.status === "disabled" || step.binding.status === "unresolved") return true;
  if (step.kind === "decision") {
    return step.thenSteps.some(stepHasReview) || (step.elseSteps?.some(stepHasReview) ?? false);
  }
  if (step.kind === "loop") return step.steps.some(stepHasReview);
  return false;
}

/**
 * Why a Test cannot run yet, in plain words, or undefined when it can.
 * A Test that has not been confirmed by a run is still runnable: running it
 * is how it gets confirmed.
 */
export function testSetupIssue(map: AppMap, test: AppMapScenarioTest): string | undefined {
  if (unrecordedProductName(test.name)) return "Not recorded yet";
  if (test.steps.length === 0) return "No steps yet";
  if (test.steps.some(stepHasReview)) return "A step needs fixing";
  if (scenarioTestOriginMissingEvidence(map, test)) return "Missing its first screen";
  return undefined;
}

function testStatus(map: AppMap, test: AppMapScenarioTest): ProductTestStatus {
  return testSetupIssue(map, test) ? "needs-review" : "ready";
}

function flattenCount(steps: readonly AppMapScenarioTestStep[]): number {
  return steps.reduce((count, step) => {
    const children =
      step.kind === "decision"
        ? [...step.thenSteps, ...(step.elseSteps ?? [])]
        : step.kind === "loop"
          ? step.steps
          : [];
    return count + 1 + flattenCount(children);
  }, 0);
}

function projectStep(step: AppMapScenarioTestStep, app: AppMap): ProductTestStep {
  const children =
    step.kind === "decision"
      ? [...step.thenSteps, ...(step.elseSteps ?? [])]
      : step.kind === "loop"
        ? step.steps
        : [];
  const recordingFrames =
    step.binding?.status === "resolved" && step.binding.kind === "connections"
      ? step.binding.connectionIds.flatMap(
          (id) => app.connections[id]?.recordingSource?.frames ?? [],
        )
      : [];
  const connection =
    step.binding.status === "resolved" &&
    step.binding.kind === "connections" &&
    step.binding.connectionIds.length === 1
      ? app.connections[step.binding.connectionIds[0]!]
      : undefined;
  const label = /^Go from (?:Start|Next screen) to (?:Start|Next screen)$/u.test(step.intent)
    ? connection?.label
    : undefined;
  return {
    ...(label ? { label } : {}),
    ...(recordingFrames.length ? { recordingFrames } : {}),
    id: step.id,
    kind: step.kind,
    intent: step.intent,
    ...(step.note ? { note: step.note } : {}),
    capture: step.capture === true,
    status: stepHasReview(step) ? "needs-review" : "ready",
    ...(children.length ? { children: children.map((child) => projectStep(child, app)) } : {}),
  };
}

function identityFromRun(run: RunSummary): ProductRunIdentity {
  if (run.sourceTest) return { runId: run.id, ...run.sourceTest };
  const matrix = run.matrixCase;
  const action = run.action.match(/^app-map:([^:]+):test:([^:]+)(?::|$)/u);
  const artifacts = (run as RunSummary & { artifacts?: unknown[] }).artifacts;
  let sourceAppMapId: string | undefined;
  let sourceTestId: string | undefined;
  if (Array.isArray(artifacts)) {
    for (const value of artifacts) {
      if (!value || typeof value !== "object") continue;
      const artifact = value as { kind?: unknown; data?: unknown };
      if (
        artifact.kind !== "app-map-test-execution-intent" ||
        !artifact.data ||
        typeof artifact.data !== "object"
      )
        continue;
      const sourcePlan = (artifact.data as { sourcePlan?: unknown }).sourcePlan;
      if (!sourcePlan || typeof sourcePlan !== "object") continue;
      const source = sourcePlan as { appMapId?: unknown; testId?: unknown };
      sourceAppMapId = nonEmpty(source.appMapId);
      sourceTestId = nonEmpty(source.testId);
      if (sourceAppMapId || sourceTestId) break;
    }
  }
  return {
    runId: run.id,
    ...(matrix?.appMapId || sourceAppMapId || action?.[1]
      ? { appMapId: matrix?.appMapId ?? sourceAppMapId ?? action?.[1] }
      : {}),
    ...(matrix?.testId || sourceTestId || action?.[2]
      ? { testId: matrix?.testId ?? sourceTestId ?? action?.[2] }
      : {}),
  };
}

function projectRun(run: RunSummary, maps: readonly AppMap[]): ProductRunSummary {
  const identity = identityFromRun(run);
  const map = identity.appMapId
    ? maps.find((candidate) => candidate.id === identity.appMapId)
    : undefined;
  const test = identity.testId && map ? map.tests[identity.testId] : undefined;
  const title = human(run.title, test?.name ?? "Saved Test");
  const links = {
    self: routeUrls.run(run.id),
    ...(identity.testId ? { test: routeUrls.test(identity.testId) } : {}),
    ...(identity.appMapId ? { app: routeUrls.app(identity.appMapId) } : {}),
    ...(run.batchId ? { batch: routeUrls.batch(run.batchId) } : {}),
  };
  return {
    id: run.id,
    captureSummary: run.captureSummary,
    frameCount: run.frameCount,
    title,
    action: run.action,
    status: run.status,
    phase: phase(run),
    ...(outcome(run.outcome) ? { outcome: outcome(run.outcome) } : {}),
    ...(identity.appMapId ? { appMapId: identity.appMapId } : {}),
    ...(identity.testId ? { testId: identity.testId } : {}),
    ...(map ? { appName: map.name } : {}),
    ...(test ? { testName: test.name } : {}),
    ...(targetName(run) ? { targetName: targetName(run) } : {}),
    ...(run.platform ? { platform: run.platform } : {}),
    queuedAt: run.queuedAt,
    ...(run.startedAt === undefined ? {} : { startedAt: run.startedAt }),
    ...(run.finishedAt === undefined ? {} : { finishedAt: run.finishedAt }),
    ...(run.durationMs === undefined ? {} : { durationMs: run.durationMs }),
    ...(run.batchId ? { batchId: run.batchId } : {}),
    ...(run.caseIndex === undefined ? {} : { caseIndex: run.caseIndex }),
    ...(run.caseCount === undefined ? {} : { caseCount: run.caseCount }),
    ...(run.review ? { review: structuredClone(run.review) } : {}),
    identity,
    ...(executionIdentityFromRun(run, identity)
      ? { executionIdentity: executionIdentityFromRun(run, identity) }
      : {}),
    links,
  };
}

function executionIdentityFromRun(
  run: RunSummary,
  identity: ProductRunIdentity,
): ProductRunExecutionIdentity | undefined {
  const candidate = run as RunSummary & {
    appMapRevision?: unknown;
    targetProfileId?: unknown;
    dataSetId?: unknown;
    accountId?: unknown;
    artifacts?: unknown;
  };
  let appMapRevision = Number.isSafeInteger(candidate.appMapRevision)
    ? (candidate.appMapRevision as number)
    : undefined;
  let startupMode: ProductRunExecutionIdentity["startupMode"];
  if (Array.isArray(candidate.artifacts)) {
    for (const artifact of candidate.artifacts) {
      if (!artifact || typeof artifact !== "object") continue;
      const value = artifact as { kind?: unknown; data?: unknown };
      if (value.kind !== "app-map-test-execution-intent" || !value.data) continue;
      const data =
        typeof value.data === "object" && !Array.isArray(value.data)
          ? (value.data as { sourcePlan?: unknown; plan?: unknown })
          : undefined;
      if (!data) continue;
      if (appMapRevision === undefined) {
        const revision =
          typeof data.sourcePlan === "object" &&
          data.sourcePlan !== null &&
          !Array.isArray(data.sourcePlan)
            ? (data.sourcePlan as { appMapRevision?: unknown }).appMapRevision
            : undefined;
        if (Number.isSafeInteger(revision)) appMapRevision = revision as number;
      }
      if (!startupMode) {
        const mode =
          typeof data.plan === "object" && data.plan !== null && !Array.isArray(data.plan)
            ? (data.plan as { startup?: { mode?: unknown } }).startup?.mode
            : undefined;
        if (mode === "warm" || mode === "cold" || mode === "verified-checkpoint") {
          startupMode = mode;
        }
      }
      if (appMapRevision !== undefined && startupMode) break;
    }
  }
  const executionIdentity: ProductRunExecutionIdentity = {
    ...(identity.appMapId ? { appMapId: identity.appMapId } : {}),
    ...(identity.testId ? { testId: identity.testId } : {}),
    ...(appMapRevision === undefined ? {} : { appMapRevision }),
    ...(run.sourceRevision?.sha ? { sourceRevision: run.sourceRevision.sha } : {}),
    ...(run.sourceRevision?.buildId ? { buildId: run.sourceRevision.buildId } : {}),
    ...(typeof candidate.targetProfileId === "string" && candidate.targetProfileId
      ? { targetProfileId: candidate.targetProfileId }
      : {}),
    ...(run.platform ? { platform: run.platform } : {}),
    ...(run.serial ? { deviceId: run.serial } : {}),
    ...(typeof candidate.dataSetId === "string" && candidate.dataSetId
      ? { dataSetId: candidate.dataSetId }
      : {}),
    ...(typeof candidate.accountId === "string" && candidate.accountId
      ? { accountId: candidate.accountId }
      : {}),
    ...(startupMode ? { startupMode } : {}),
  };
  return Object.keys(executionIdentity).length ? executionIdentity : undefined;
}

function matchesTest(summary: ProductTestSummary, filter: ProductTestFilter): boolean {
  if (filter.appMapId && summary.appMapId !== filter.appMapId) return false;
  if (filter.status && summary.status !== filter.status) return false;
  const query = filter.search?.trim().toLocaleLowerCase();
  return !query || `${summary.name} ${summary.appName}`.toLocaleLowerCase().includes(query);
}

function matchesRun(summary: ProductRunSummary, filter: ProductRunFilter): boolean {
  if (filter.appMapId && summary.appMapId !== filter.appMapId) return false;
  if (filter.testId && summary.testId !== filter.testId) return false;
  if (filter.status && summary.phase !== filter.status) return false;
  if (filter.outcome && summary.outcome !== filter.outcome) return false;
  if (filter.view === "active" && summary.phase !== "queued" && summary.phase !== "running")
    return false;
  if (filter.view === "failed" && summary.phase !== "failed") return false;
  if (
    filter.view === "needs-review" &&
    summary.review?.status !== "pending" &&
    summary.outcome !== "uncertain"
  )
    return false;
  const query = filter.search?.trim().toLocaleLowerCase();
  return (
    !query ||
    `${summary.title} ${summary.testName ?? ""} ${summary.appName ?? ""}`
      .toLocaleLowerCase()
      .includes(query)
  );
}

function latestRuns(runs: readonly ProductRunSummary[]): readonly ProductRunSummary[] {
  const latest = new Map<string, ProductRunSummary>();
  for (const run of runs) {
    const key = run.testId ? `${run.appMapId ?? ""}:${run.testId}` : run.id;
    const prior = latest.get(key);
    const at = run.finishedAt ?? run.startedAt ?? run.queuedAt;
    const priorAt = prior ? (prior.finishedAt ?? prior.startedAt ?? prior.queuedAt) : -1;
    if (!prior || at > priorAt || (at === priorAt && run.id > prior.id)) latest.set(key, run);
  }
  return [...latest.values()];
}

export function projectProductTests(
  maps: readonly AppMap[],
  runs: readonly RunSummary[] = [],
): readonly ProductTestSummary[] {
  const projectedRuns = runs.map((run) => projectRun(run, maps));
  return maps.flatMap((map) =>
    Object.values(map.tests).map((test) => projectTestSummary(map, test, projectedRuns)),
  );
}

function projectTestSummary(
  map: AppMap,
  test: AppMapScenarioTest,
  projectedRuns: readonly ProductRunSummary[] = [],
): ProductTestSummary {
  const recentRun = projectedRuns
    .filter((run) => run.appMapId === map.id && run.testId === test.id)
    .sort(
      (a, b) =>
        (b.finishedAt ?? b.startedAt ?? b.queuedAt) - (a.finishedAt ?? a.startedAt ?? a.queuedAt),
    )[0];
  return {
    id: test.id,
    name: test.name,
    appMapId: map.id,
    appName: map.name,
    stepCount: flattenCount(test.steps),
    status: testStatus(map, test),
    ...(testSetupIssue(map, test) ? { setupIssue: testSetupIssue(map, test)! } : {}),
    updatedAt: test.updatedAt,
    href: routeUrls.test(test.id),
    ...(recentRun ? { recentRun } : {}),
  };
}

export function projectProductRuns(
  runs: readonly RunSummary[],
  maps: readonly AppMap[] = [],
): readonly ProductRunSummary[] {
  return runs.map((run) => projectRun(run, maps));
}

/** The profile of the Variant whose evidence came from this Test's recording. */
function recordedTestProfileId(app: AppMap, test: AppMapScenarioTest): string | undefined {
  const evidence = new Set<string>();
  const visit = (steps: readonly AppMapScenarioTestStep[]) => {
    for (const step of steps) {
      if (step.binding?.status === "resolved" && step.binding.kind === "connections") {
        for (const id of step.binding.connectionIds) {
          for (const evidenceId of app.connections[id]?.recordingSource?.evidenceIds ?? []) {
            evidence.add(evidenceId);
          }
        }
      }
      if (step.kind === "decision") visit([...step.thenSteps, ...(step.elseSteps ?? [])]);
      if (step.kind === "loop") visit(step.steps);
    }
  };
  visit(test.steps);
  if (!evidence.size) return undefined;
  return Object.values(app.screenVariants).find((variant) =>
    variant.evidenceIds.some((id) => evidence.has(id)),
  )?.targetProfile?.id;
}

export function productTestDetail(
  owner: ProductTestOwner,
  runs: readonly RunSummary[] = [],
): ProductTestDetail {
  const { app, test } = owner;
  const summary = projectTestSummary(app, test, projectProductRuns(runs, [app]));
  const recordedProfileId = recordedTestProfileId(app, test);
  return {
    ...summary,
    ...(recordedProfileId ? { recordedProfileId } : {}),
    appMapRevision: app.revision,
    steps: test.steps.map((step) => projectStep(step, app)),
    links: {
      self: routeUrls.test(test.id),
      app: routeUrls.app(app.id),
      edit: routeUrls.testEdit(test.id),
      record: routeUrls.testRecord(test.id),
      run: routeUrls.testRunAcross(test.id),
    },
  };
}

export function productRunDetail(run: RunSummary, maps: readonly AppMap[] = []): ProductRunDetail {
  const summary = projectRun(run, maps);
  const raw = run as RunSummary & {
    steps?: unknown[];
    artifacts?: unknown[];
    error?: unknown;
    testStepEvidence?: unknown;
  };
  const steps = Array.isArray(raw.steps)
    ? raw.steps.map((value, index) => {
        const item = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
        const frames = Array.isArray(item.frames) ? item.frames.length : 0;
        return {
          ...(typeof item.id === "string" ? { id: item.id } : {}),
          index: typeof item.index === "number" ? item.index : index,
          title: nonEmpty(item.title) ?? `Step ${index + 1}`,
          ...(typeof item.status === "string" ? { status: item.status } : {}),
          ...(typeof item.durationMs === "number" ? { durationMs: item.durationMs } : {}),
          frameCount: frames,
        } satisfies ProductRunStep;
      })
    : [];
  const stepEvidence = parseOptionalRunTestStepEvidence(raw.testStepEvidence) ?? [];
  return {
    ...summary,
    steps,
    stepEvidence,
    evidence: {
      available: run.frameCount > 0 || (raw.artifacts?.length ?? 0) > 0,
      frameCount: run.frameCount,
      artifactCount: raw.artifacts?.length ?? run.artifactCount,
    },
    ...(typeof raw.error === "string" && raw.error ? { error: raw.error } : {}),
  };
}

/** Operation-backed Product catalog. It never writes or invents runtime state. */
export function createProductCatalog(client: RelayInvokeClient): ProductCatalog {
  const operations = createRelayOperationPort(client);
  async function runPage(appMapId?: string, cursor?: string, complete = false) {
    return operations.invoke(
      "run.list",
      cursor
        ? { cursor, ...(appMapId ? { appMapId } : {}) }
        : appMapId
          ? complete
            ? { appMapId, limit: 200 }
            : { appMapId }
          : complete
            ? { limit: 200 }
            : {},
    );
  }
  async function allRunSummaries(appMapId?: string): Promise<readonly RunSummary[]> {
    const runs: RunSummary[] = [];
    let cursor: string | undefined;
    for (let page = 0; ; page += 1) {
      const result = await runPage(appMapId, cursor, true);
      runs.push(...result.runs);
      if (!result.nextCursor) return runs;
      if (page + 1 >= MAX_RUN_LIST_PAGES) {
        throw new Error("Run history exceeds Relay's bounded pagination window");
      }
      cursor = result.nextCursor;
    }
  }
  async function maps(appMapId?: string): Promise<readonly AppMap[]> {
    if (appMapId) return [(await operations.invoke("app-map.get", { appMapId })).appMap];
    return (await operations.invoke("app-map.list", {})).appMaps;
  }
  return {
    async listTests(filter = {}) {
      const appMaps = await maps(filter.appMapId);
      // Each Test's newest run from the whole history, not just a recent page.
      const runs = await operations
        .invoke("run.list", {
          latestPerTest: true,
          ...(filter.appMapId ? { appMapId: filter.appMapId } : {}),
        })
        .then((result) => result.runs);
      return projectProductTests(appMaps, runs).filter((test) => matchesTest(test, filter));
    },
    async getTest(testId, appMapId) {
      const appMaps = await maps(appMapId);
      const owner = appMapId
        ? appMaps[0] && appMaps[0].tests[testId]
          ? { app: appMaps[0], test: appMaps[0].tests[testId] }
          : undefined
        : findUniqueProductTestOwner(appMaps, testId);
      if (!owner) return undefined;
      const runs = (await operations.invoke("run.list", { appMapId: owner.app.id })).runs;
      return productTestDetail(owner, runs);
    },
    async listRuns(filter = {}) {
      const runs = (await runPage(filter.appMapId)).runs;
      const appMaps = await maps(filter.appMapId);
      const projected = projectProductRuns(runs, appMaps).filter((run) => matchesRun(run, filter));
      return filter.view === "latest" ? latestRuns(projected) : projected;
    },
    async listRunsComplete(filter = {}) {
      const runs = await allRunSummaries(filter.appMapId);
      const appMaps = await maps(filter.appMapId);
      const projected = projectProductRuns(runs, appMaps).filter((run) => matchesRun(run, filter));
      return filter.view === "latest" ? latestRuns(projected) : projected;
    },
    async getRun(runId) {
      const { run } = await operations.invoke("run.get", { runId });
      const identity = identityFromRun(run as RunSummary);
      const appMaps = await maps(identity.appMapId);
      return productRunDetail(run as RunSummary, appMaps);
    },
  };
}
