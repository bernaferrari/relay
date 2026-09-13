import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  COMBINE_TRIAGE_STATUSES,
  type CombineCampaign,
  type CombineCampaignCaseStatus,
  type CombineTriageStatus,
} from "@relay/protocol";
import { atomicWriteFile, KeyedSerialQueue } from "./coordination-store.js";
import { findWorkspaceRoot } from "./workspace-root.js";
import { getJob } from "./session.js";
import { readPersistedRun } from "./runs.js";
import { durableWorkerAssignmentStore } from "./durable-worker-assignments.js";
import { combineCampaignCaseIdentity } from "./combine-campaign-case-identity.js";
import { primaryJobFindingCode } from "./combine-evidence-job-findings.js";

export type StoredCombineCampaign = CombineCampaign & {
  execution: NonNullable<CombineCampaign["execution"]>;
};

const writes = new KeyedSerialQueue();

function root(): string {
  const state = process.env.RELAY_STATE_DIR?.trim();
  return join(state || join(findWorkspaceRoot(), ".relay"), "combine-campaigns");
}

function safeSegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed || !/^[A-Za-z0-9._:-]+$/u.test(trimmed)) {
    throw new Error(`${label} is invalid`);
  }
  return trimmed;
}

function file(projectId: string, campaignId: string): string {
  return join(
    root(),
    safeSegment(projectId, "projectId"),
    `${safeSegment(campaignId, "campaignId")}.json`,
  );
}

async function writeCampaign(campaign: StoredCombineCampaign): Promise<void> {
  const destination = file(campaign.projectId, campaign.id);
  await mkdir(join(root(), campaign.projectId), { recursive: true });
  await atomicWriteFile(destination, `${JSON.stringify(campaign, null, 2)}\n`);
}

function assertCampaign(value: unknown): asserts value is StoredCombineCampaign {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Combine campaign is corrupt");
  }
  const record = value as Partial<StoredCombineCampaign>;
  if (
    record.schemaVersion !== 1 ||
    typeof record.id !== "string" ||
    typeof record.projectId !== "string" ||
    typeof record.appMapId !== "string" ||
    typeof record.combineId !== "string" ||
    !Array.isArray(record.cases) ||
    !record.execution
  ) {
    throw new Error("Combine campaign is corrupt");
  }
}

export async function createCombineCampaign(campaign: StoredCombineCampaign): Promise<void> {
  await writes.run(`${campaign.projectId}:${campaign.id}`, async () => {
    try {
      await readFile(file(campaign.projectId, campaign.id), "utf8");
      throw new Error(`Combine campaign ${campaign.id} already exists`);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    await writeCampaign(structuredClone(campaign));
  });
}

export async function readCombineCampaign(
  projectId: string,
  campaignId: string,
): Promise<StoredCombineCampaign | null> {
  try {
    const parsed = JSON.parse(await readFile(file(projectId, campaignId), "utf8")) as unknown;
    assertCampaign(parsed);
    return parsed;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

const activeCampaignStatuses: ReadonlySet<CombineCampaign["status"]> = new Set([
  "pilot-running",
  "ready-to-resume",
  "needs-review",
  "running",
]);

type RepeatResumeMode = "untouched" | "failed" | "all";

function repeatResumeMode(campaign: StoredCombineCampaign): RepeatResumeMode {
  return campaign.execution.repeat?.resolved.resume ?? "untouched";
}

function retryableTerminalStatus(
  mode: RepeatResumeMode,
  status: CombineCampaignCaseStatus,
): boolean {
  if (mode === "failed") return status === "failed";
  if (mode === "all") {
    return status === "failed" || status === "blocked" || status === "cancelled";
  }
  return false;
}

function usesExpandedExecutionIdentity(campaign: StoredCombineCampaign): boolean {
  return Boolean(campaign.cases.some((item) => item.executionCaseId));
}

/** Select exact frozen cases for one continuation. Every mode continues
 * untouched work; failed/all additionally reopen reviewed terminal outcomes.
 * Passed and active cases are never eligible. */
/** An explicit cellIds scope is the reviewed selective-rerun path. */
export function prepareSelectedCombineCampaignResume(
  campaign: StoredCombineCampaign,
  options: { cellIds?: readonly string[]; executionCaseIds?: readonly string[] } = {},
): {
  campaign: StoredCombineCampaign;
  selectedCellIds: string[];
  selectedExecutionCaseIds: string[];
  retriedTerminalCellIds: string[];
} {
  if (options.cellIds !== undefined && options.executionCaseIds !== undefined) {
    throw new Error("Choose either cell ids or execution case ids for a Repeat rerun scope.");
  }
  if (options.cellIds !== undefined && usesExpandedExecutionIdentity(campaign)) {
    throw new Error("Expanded campaigns require execution case ids for a selective retry.");
  }
  const explicitCellIds = options.cellIds;
  const explicitExecutionCaseIds = options.executionCaseIds;
  const explicitIds = explicitExecutionCaseIds ?? explicitCellIds;
  const selected = new Set(
    explicitIds === undefined
      ? usesExpandedExecutionIdentity(campaign)
        ? (campaign.execution.selectedExecutionCaseIds ?? campaign.execution.selectedCellIds ?? [])
        : (campaign.execution.selectedCellIds ?? [])
      : explicitIds.map((id) => id.trim()).filter(Boolean),
  );
  if (explicitIds !== undefined) {
    if (!selected.size || selected.size !== explicitIds.length) {
      throw new Error("An explicit Repeat rerun scope must contain unique non-empty ids.");
    }
    const known = new Set(
      campaign.cases.map((item) =>
        explicitExecutionCaseIds === undefined ? item.cellId : combineCampaignCaseIdentity(item),
      ),
    );
    const unknown = [...selected].filter((id) => !known.has(id));
    if (unknown.length) {
      throw new Error(`Repeat rerun scope names unknown campaign case ${unknown[0]}.`);
    }
  }
  const mode = repeatResumeMode(campaign);
  const expanded = usesExpandedExecutionIdentity(campaign);
  const selectedCellIds: string[] = [];
  const selectedExecutionCaseIds: string[] = [];
  const retriedTerminalCellIds: string[] = [];
  const cases = campaign.cases.map((item) => {
    const executionId = combineCampaignCaseIdentity(item);
    const selectedById =
      explicitExecutionCaseIds !== undefined || expanded ? executionId : item.cellId;
    if (!selected.has(selectedById)) return item;
    const terminalRetry = retryableTerminalStatus(
      explicitIds === undefined ? mode : "all",
      item.status,
    );
    if (explicitIds !== undefined) {
      if (!retryableTerminalStatus("all", item.status)) {
        throw new Error(
          `Repeat rerun scope may include only failed, blocked, or cancelled cases; ${selectedById} is ${item.status}.`,
        );
      }
      if (!item.jobId || !item.runId) {
        throw new Error(
          `Campaign case ${selectedById} cannot retry without immutable Run evidence.`,
        );
      }
    }
    if (item.status !== "pending" && !terminalRetry) return item;
    if (terminalRetry && (!item.jobId || !item.runId)) {
      throw new Error(`Campaign case ${selectedById} cannot retry without immutable Run evidence.`);
    }
    selectedCellIds.push(item.cellId);
    selectedExecutionCaseIds.push(executionId);
    if (terminalRetry) retriedTerminalCellIds.push(item.cellId);
    const priorRunIds = item.runId
      ? [...new Set([...(item.priorRunIds ?? []), item.runId])]
      : item.priorRunIds;
    const {
      jobId: _jobId,
      runId: _runId,
      error: _error,
      priorRunIds: _priorRunIds,
      ...stable
    } = item;
    return {
      ...stable,
      status: "pending" as const,
      ...(priorRunIds?.length ? { priorRunIds } : {}),
    };
  });
  return {
    campaign: { ...campaign, cases },
    selectedCellIds,
    selectedExecutionCaseIds,
    retriedTerminalCellIds,
  };
}

function hasReviewableRepeatResume(campaign: StoredCombineCampaign): boolean {
  if (!campaign.execution.repeat || campaign.status === "cancelled") return false;
  const mode = repeatResumeMode(campaign);
  if (mode === "untouched") return false;
  const selected = new Set(
    usesExpandedExecutionIdentity(campaign)
      ? (campaign.execution.selectedExecutionCaseIds ?? campaign.execution.selectedCellIds)
      : campaign.execution.selectedCellIds,
  );
  return campaign.cases.some(
    (item) =>
      selected.has(combineCampaignCaseIdentity(item)) &&
      retryableTerminalStatus(mode, item.status) &&
      Boolean(item.jobId && item.runId),
  );
}

async function campaignEntries(projectId: string): Promise<string[]> {
  const projectRoot = join(root(), safeSegment(projectId, "projectId"));
  try {
    return (await readdir(projectRoot))
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => name.slice(0, -".json".length));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

/** Disk campaigns for one project. Callers that need live job status must project. */
export async function listStoredCombineCampaigns(
  projectId: string,
): Promise<StoredCombineCampaign[]> {
  const campaigns = await Promise.all(
    (await campaignEntries(projectId)).map((campaignId) =>
      readCombineCampaign(projectId, campaignId),
    ),
  );
  return campaigns.filter((campaign): campaign is StoredCombineCampaign => Boolean(campaign));
}

/** Find unfinished work for one canonical Combine. This is used as a
 * server-side backstop when a browser loses its opaque workflow reference. */
export async function findActiveCombineCampaignForCombine(
  projectId: string,
  appMapId: string,
  combineId: string,
): Promise<StoredCombineCampaign | null> {
  for (const campaignId of await campaignEntries(projectId)) {
    const campaign = await readCombineCampaign(projectId, campaignId);
    const projected = campaign ? await projectCombineCampaign(campaign) : null;
    if (
      projected?.appMapId === appMapId &&
      projected.combineId === combineId &&
      (activeCampaignStatuses.has(projected.status) || hasReviewableRepeatResume(projected))
    ) {
      return projected;
    }
  }
  return null;
}

/** Find unfinished outcome-level Repeats for one Test. Callers must apply
 * subject visibility before deciding whether the result is unique. */
export async function findActiveRepeatCampaigns(
  projectId: string,
  appMapId: string,
  testId: string,
): Promise<StoredCombineCampaign[]> {
  const matches: StoredCombineCampaign[] = [];
  for (const campaignId of await campaignEntries(projectId)) {
    const campaign = await readCombineCampaign(projectId, campaignId);
    const projected = campaign ? await projectCombineCampaign(campaign) : null;
    if (
      projected?.appMapId === appMapId &&
      projected.execution.repeat?.testId === testId &&
      (activeCampaignStatuses.has(projected.status) || hasReviewableRepeatResume(projected))
    ) {
      matches.push(projected);
    }
  }
  return matches;
}

/** Exact durable workflow receipt lookup used only to reconcile a lost pilot
 * response. It never infers identity from app/test coincidence. */
export async function findRepeatCampaignsByWorkflow(
  projectId: string,
  workflowId: string,
): Promise<StoredCombineCampaign[]> {
  const matches: StoredCombineCampaign[] = [];
  for (const campaignId of await campaignEntries(projectId)) {
    const campaign = await readCombineCampaign(projectId, campaignId);
    if (campaign?.execution.repeat?.workflowMutation?.workflowId === workflowId) {
      matches.push(campaign);
    }
  }
  return matches;
}

export class CombineCampaignTriageError extends Error {
  constructor(
    message: string,
    readonly code:
      | "COMBINE_TRIAGE_EMPTY"
      | "COMBINE_TRIAGE_UNKNOWN_CASE"
      | "COMBINE_TRIAGE_INVALID_STATUS" = "COMBINE_TRIAGE_EMPTY",
  ) {
    super(message);
    this.name = "CombineCampaignTriageError";
  }
}

export function campaignCaseMatchesId(
  item: StoredCombineCampaign["cases"][number],
  id: string,
): boolean {
  return item.executionCaseId === id || item.cellId === id || `case-${item.index + 1}` === id;
}

export function applyCombineCampaignTriage(
  campaign: StoredCombineCampaign,
  input: {
    caseIds: readonly string[];
    triageStatus?: CombineTriageStatus;
    assignee?: string;
    actorId: string;
    now: number;
  },
): StoredCombineCampaign {
  const caseIds = [...new Set(input.caseIds.map((id) => id.trim()).filter(Boolean))];
  if (!caseIds.length) {
    throw new CombineCampaignTriageError(
      "triage requires at least one case id",
      "COMBINE_TRIAGE_EMPTY",
    );
  }
  if (input.triageStatus === undefined && input.assignee === undefined) {
    throw new CombineCampaignTriageError(
      "triage requires triageStatus or assignee",
      "COMBINE_TRIAGE_EMPTY",
    );
  }
  if (input.triageStatus !== undefined && !COMBINE_TRIAGE_STATUSES.includes(input.triageStatus)) {
    throw new CombineCampaignTriageError(
      "triageStatus is unsupported",
      "COMBINE_TRIAGE_INVALID_STATUS",
    );
  }
  const assignee =
    input.assignee === undefined ? undefined : input.assignee.trim() ? input.assignee.trim() : "";
  const matched = new Set<string>();
  const cases = campaign.cases.map((item) => {
    const hit = caseIds.find((id) => campaignCaseMatchesId(item, id));
    if (!hit) return item;
    matched.add(hit);
    const next = {
      ...item,
      ...(input.triageStatus !== undefined ? { triageStatus: input.triageStatus } : {}),
    };
    if (assignee === undefined) return next;
    if (assignee) return { ...next, assignee };
    const { assignee: _cleared, ...rest } = next;
    void _cleared;
    return rest;
  });
  if (matched.size !== caseIds.length) {
    throw new CombineCampaignTriageError(
      "One or more triage case ids are not in this campaign",
      "COMBINE_TRIAGE_UNKNOWN_CASE",
    );
  }
  return {
    ...campaign,
    updatedAt: input.now,
    cases,
    lineage: [
      ...campaign.lineage,
      {
        kind: "triaged",
        at: input.now,
        appMapRevision: campaign.latestRevision,
        actorId: input.actorId,
        affectedCellIds: campaign.cases
          .filter((item) => caseIds.some((id) => campaignCaseMatchesId(item, id)))
          .map((item) => item.executionCaseId ?? item.cellId),
      },
    ],
  };
}

export async function updateCombineCampaignTriage(
  projectId: string,
  campaignId: string,
  input: {
    caseIds: readonly string[];
    triageStatus?: CombineTriageStatus;
    assignee?: string;
    actorId: string;
    now?: number;
  },
): Promise<StoredCombineCampaign> {
  return updateCombineCampaign(projectId, campaignId, (current) =>
    applyCombineCampaignTriage(current, { ...input, now: input.now ?? Date.now() }),
  );
}

export async function updateCombineCampaign(
  projectId: string,
  campaignId: string,
  update: (
    campaign: StoredCombineCampaign,
  ) => StoredCombineCampaign | Promise<StoredCombineCampaign>,
): Promise<StoredCombineCampaign> {
  return writes.run(`${projectId}:${campaignId}`, async () => {
    const current = await readCombineCampaign(projectId, campaignId);
    if (!current) throw new Error(`Combine campaign ${campaignId} not found`);
    const next = await update(structuredClone(current));
    if (next.id !== current.id || next.projectId !== current.projectId) {
      throw new Error("Combine campaign identity cannot change");
    }
    await writeCampaign(next);
    return next;
  });
}

type ObservableJob = {
  id?: string;
  status?: string;
  error?: string;
  action?: string;
  title?: string;
  outcome?: string;
  failureCategory?: string;
  persisted?: boolean;
  artifacts?: Array<{ kind?: string; data?: unknown }>;
};

function checkProblem(job: ObservableJob): "failed" | "blocked" | undefined {
  for (const artifact of job.artifacts ?? []) {
    if (
      artifact.kind !== "campaign-check-result" ||
      !artifact.data ||
      typeof artifact.data !== "object"
    ) {
      continue;
    }
    const status = (artifact.data as { status?: unknown }).status;
    if (status === "failed") return "failed";
    if (status === "blocked") return "blocked";
  }
  return undefined;
}

function caseStatus(job: ObservableJob | null): CombineCampaignCaseStatus {
  if (!job) return "queued";
  if (job.status === "queued" || job.status === "paused") return "queued";
  if (job.status === "running") return "running";
  if (job.status === "cancelled") return "cancelled";
  if (job.status === "error") return "failed";
  return checkProblem(job) ?? "passed";
}

function isTerminalCaseStatus(status: CombineCampaignCaseStatus): boolean {
  return (
    status === "passed" || status === "failed" || status === "blocked" || status === "cancelled"
  );
}

async function observableJob(
  jobId: string,
): Promise<{ job: ObservableJob; runId?: string } | null> {
  const live = getJob(jobId);
  if (live) return { job: live, ...(live.persisted ? { runId: live.id } : {}) };
  const persisted = await readPersistedRun(jobId);
  return persisted ? { job: persisted, runId: persisted.id } : null;
}

/** A durable row is the restart truth when no live registry entry or completed
 * manifest exists. A queued row never reached a target and can safely return
 * to the Combine resume set; a claimed row may have changed device state and
 * must stop for human review. */
function recoveryCaseStatus(jobId: string): "pending" | "blocked" | undefined {
  const assignment = durableWorkerAssignmentStore().get(jobId);
  if (assignment?.status !== "recovery-required") return undefined;
  return assignment.execution ? "blocked" : "pending";
}

/** Refresh only execution observations. Authored inputs and lineage remain
 * immutable unless an explicit resume/cancel operation updates them. */
export async function projectCombineCampaign(
  campaign: StoredCombineCampaign,
): Promise<StoredCombineCampaign> {
  const cases = await Promise.all(
    campaign.cases.map(async (item) => {
      if (!item.jobId) return item;
      const observed = await observableJob(item.jobId);
      if (!observed) {
        const recoveryStatus = recoveryCaseStatus(item.jobId);
        if (recoveryStatus) {
          return {
            ...item,
            status: recoveryStatus,
            ...(recoveryStatus === "blocked"
              ? {
                  error:
                    "Relay restarted after this cell began execution. Review device state before retrying.",
                }
              : {}),
          };
        }
      }
      const observedStatus = caseStatus(observed?.job ?? null);
      const provingRunEvidence = isTerminalCaseStatus(observedStatus) && !observed?.runId;
      const status = provingRunEvidence ? "running" : observedStatus;
      const { runId: _unverifiedRunId, ...unprovedCase } = item;
      const findingSource = observed?.job
        ? {
            id: observed.job.id ?? item.jobId,
            action: observed.job.action ?? item.testId,
            status: observed.job.status ?? observedStatus,
            ...(observed.job.title ? { title: observed.job.title } : {}),
            ...(observed.job.error ? { error: observed.job.error } : {}),
            ...(observed.job.outcome ? { outcome: observed.job.outcome } : {}),
            ...(observed.job.failureCategory
              ? { failureCategory: observed.job.failureCategory }
              : {}),
            ...(observed.job.artifacts ? { artifacts: observed.job.artifacts } : {}),
          }
        : undefined;
      const findingCode = findingSource ? primaryJobFindingCode(findingSource) : undefined;
      return {
        ...unprovedCase,
        status,
        ...(provingRunEvidence
          ? { error: "Relay is still proving immutable Run evidence for this completed cell." }
          : observed?.job.error
            ? { error: observed.job.error }
            : {}),
        ...(observed?.runId ? { runId: observed.runId } : {}),
        ...(findingCode ? { findingCode } : {}),
        ...(observed?.job.failureCategory ? { failureCategory: observed.job.failureCategory } : {}),
        ...(observed?.job.outcome ? { outcome: observed.job.outcome } : {}),
      };
    }),
  );
  const selectedExecutionCaseIds = new Set(
    usesExpandedExecutionIdentity(campaign)
      ? (campaign.execution.selectedExecutionCaseIds ?? campaign.execution.selectedCellIds ?? [])
      : (campaign.execution.selectedCellIds ?? []),
  );
  const expanded = usesExpandedExecutionIdentity(campaign);
  const pendingSelected = cases.filter(
    (item) =>
      item.status === "pending" &&
      selectedExecutionCaseIds.has(expanded ? combineCampaignCaseIdentity(item) : item.cellId),
  );
  const active = cases.some((item) => item.status === "queued" || item.status === "running");
  const problems = cases.some(
    (item) => item.status === "failed" || item.status === "blocked" || item.status === "cancelled",
  );
  const blocked = cases.some((item) => item.status === "blocked");
  const preflightBlocked =
    blocked &&
    cases.every((item) => item.status === "blocked" && !item.jobId) &&
    !active &&
    pendingSelected.length === 0;
  const pilot = cases.find((item) => item.phase === "pilot");
  let status = campaign.status;
  if (campaign.status !== "cancelled") {
    if (preflightBlocked) {
      status = "completed-with-problems";
    } else if (blocked) {
      status = "needs-review";
    } else if (pendingSelected.length) {
      if (pilot?.status === "queued" || pilot?.status === "running") status = "pilot-running";
      else if (pilot?.status === "passed" || pilot?.status === "pending")
        status = "ready-to-resume";
      else status = "needs-review";
    } else if (active) status = "running";
    else status = problems ? "completed-with-problems" : "completed";
  }
  return { ...campaign, cases, status };
}

/** A passed/failed/cancelled cell with no jobId is not pending work. */
export function pendingSelectedCombineCampaignCells(
  campaign: StoredCombineCampaign,
): StoredCombineCampaign["cases"] {
  const selected = new Set(
    usesExpandedExecutionIdentity(campaign)
      ? (campaign.execution.selectedExecutionCaseIds ?? campaign.execution.selectedCellIds ?? [])
      : (campaign.execution.selectedCellIds ?? []),
  );
  const expanded = usesExpandedExecutionIdentity(campaign);
  return campaign.cases.filter(
    (item) =>
      item.status === "pending" &&
      selected.has(expanded ? combineCampaignCaseIdentity(item) : item.cellId),
  );
}
