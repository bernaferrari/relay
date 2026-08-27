import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { CombineCampaign, CombineCampaignCaseStatus } from "@relay/protocol";
import { atomicWriteFile, KeyedSerialQueue } from "./coordination-store.js";
import { findWorkspaceRoot } from "./workspace-root.js";
import { getJob } from "./session.js";
import { readPersistedRun } from "./runs.js";
import { durableWorkerAssignmentStore } from "./durable-worker-assignments.js";

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

/** Find unfinished work for one canonical Combine. This is used as a
 * server-side backstop when a browser loses its opaque workflow reference. */
export async function findActiveCombineCampaignForCombine(
  projectId: string,
  appMapId: string,
  combineId: string,
): Promise<StoredCombineCampaign | null> {
  for (const campaignId of await campaignEntries(projectId)) {
    const campaign = await readCombineCampaign(projectId, campaignId);
    if (
      campaign?.appMapId === appMapId &&
      campaign.combineId === combineId &&
      activeCampaignStatuses.has((await projectCombineCampaign(campaign)).status)
    ) {
      return campaign;
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
    if (
      campaign?.appMapId === appMapId &&
      campaign.execution.repeat?.testId === testId &&
      activeCampaignStatuses.has((await projectCombineCampaign(campaign)).status)
    ) {
      matches.push(campaign);
    }
  }
  return matches;
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
      return {
        ...unprovedCase,
        status,
        ...(provingRunEvidence
          ? { error: "Relay is still proving immutable Run evidence for this completed cell." }
          : observed?.job.error
            ? { error: observed.job.error }
            : {}),
        ...(observed?.runId ? { runId: observed.runId } : {}),
      };
    }),
  );
  const selectedCellIds = new Set(campaign.execution.selectedCellIds ?? []);
  const pendingSelected = cases.filter(
    (item) => item.status === "pending" && selectedCellIds.has(item.cellId),
  );
  const active = cases.some((item) => item.status === "queued" || item.status === "running");
  const problems = cases.some(
    (item) => item.status === "failed" || item.status === "blocked" || item.status === "cancelled",
  );
  const blocked = cases.some((item) => item.status === "blocked");
  const pilot = cases.find((item) => item.phase === "pilot");
  let status = campaign.status;
  if (campaign.status !== "cancelled") {
    if (blocked) {
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
  const selected = new Set(campaign.execution.selectedCellIds ?? []);
  return campaign.cases.filter((item) => item.status === "pending" && selected.has(item.cellId));
}
