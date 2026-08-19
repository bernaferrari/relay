import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CombineCampaign, CombineCampaignCaseStatus } from "@relay/protocol";
import { atomicWriteFile, KeyedSerialQueue } from "./coordination-store.js";
import { findWorkspaceRoot } from "./workspace-root.js";
import { getJob } from "./session.js";
import { readPersistedRun } from "./runs.js";

export type StoredCombineCampaign = CombineCampaign & {
  execution: {
    selected?: Record<string, string[]>;
    strategy?: "zip" | "cartesian" | "pairwise";
    seed: number;
    title?: string;
  };
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
  status?: string;
  error?: string;
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

async function observableJob(jobId: string): Promise<ObservableJob | null> {
  const live = getJob(jobId);
  if (live) return live;
  return readPersistedRun(jobId);
}

/** Refresh only execution observations. Authored inputs and lineage remain
 * immutable unless an explicit resume/cancel operation updates them. */
export async function projectCombineCampaign(
  campaign: StoredCombineCampaign,
): Promise<StoredCombineCampaign> {
  const cases = await Promise.all(
    campaign.cases.map(async (item) => {
      if (!item.jobId) return item;
      const job = await observableJob(item.jobId);
      return {
        ...item,
        status: caseStatus(job),
        ...(job?.error ? { error: job.error } : {}),
      };
    }),
  );
  const scheduled = cases.filter((item) => item.jobId);
  const pending = cases.filter((item) => !item.jobId);
  const active = scheduled.some((item) => item.status === "queued" || item.status === "running");
  const problems = scheduled.some(
    (item) => item.status === "failed" || item.status === "blocked" || item.status === "cancelled",
  );
  const pilot = cases.find((item) => item.phase === "pilot");
  let status = campaign.status;
  if (campaign.status !== "cancelled") {
    if (pending.length) {
      if (pilot?.status === "queued" || pilot?.status === "running") status = "pilot-running";
      else if (pilot?.status === "passed") status = "ready-to-resume";
      else status = "needs-review";
    } else if (active) status = "running";
    else status = problems ? "completed-with-problems" : "completed";
  }
  return { ...campaign, cases, status };
}
