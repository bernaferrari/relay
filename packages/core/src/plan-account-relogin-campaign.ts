import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CombineCampaign, CombineEvidenceAnalysisReport } from "@relay/protocol";
import { combineExecutionCaseId } from "./combine-campaign-case-identity.js";
import { createCombineCampaign, type StoredCombineCampaign } from "./combine-campaign.js";
import { accountReloginFindingsReport } from "./plan-findings.js";
import { findWorkspaceRoot } from "./workspace-root.js";

const PREFLIGHT_DIGEST = "account-relogin-preflight";

function stateRoot(): string {
  return process.env.RELAY_STATE_DIR?.trim() || join(findWorkspaceRoot(), ".relay");
}

function findingsFile(batchId: string): string {
  return join(stateRoot(), "plan-preflight-findings", `${batchId}.json`);
}

function isFindingsReport(value: unknown): value is CombineEvidenceAnalysisReport {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const report = value as CombineEvidenceAnalysisReport;
  return (
    report.schemaVersion === 1 &&
    typeof report.batchId === "string" &&
    Boolean(report.analysis) &&
    Array.isArray(report.analysis.findings)
  );
}

/** Sidecar Findings for a Plan that never queued jobs. */
export async function readAccountReloginFindings(
  batchId: string,
): Promise<CombineEvidenceAnalysisReport | null> {
  try {
    const parsed = JSON.parse(await readFile(findingsFile(batchId), "utf8")) as unknown;
    return isFindingsReport(parsed) ? parsed : null;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

export async function writeAccountReloginFindings(
  report: CombineEvidenceAnalysisReport,
): Promise<void> {
  const destination = findingsFile(report.batchId);
  await mkdir(join(stateRoot(), "plan-preflight-findings"), { recursive: true });
  await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`);
}

export type AccountReloginPlanPersistInput = {
  projectId: string;
  ownerId?: string;
  appMapId: string;
  combineId: string;
  appMapRevision: number;
  testIds: readonly string[];
  targetProfileId: string;
  detail: string;
  account?: CombineCampaign["cases"][number]["account"];
  target?: CombineCampaign["target"];
};

/** One blocked Result per Test. No jobs, so the next Plan can start after OAuth. */
export function blockedAccountReloginCampaign(
  input: AccountReloginPlanPersistInput & { batchId: string; at: number },
): StoredCombineCampaign {
  const testIds = input.testIds.map((id) => id.trim()).filter(Boolean);
  const ids = testIds.length ? testIds : ["preflight"];
  const cases = ids.map((testId, index) => {
    const cellId = randomUUID();
    return {
      index,
      cellId,
      executionCaseId: combineExecutionCaseId({
        cellId,
        targetProfileId: input.targetProfileId,
        ...(input.account ? { account: input.account } : {}),
      }),
      testId,
      world: "account",
      values: {},
      targetProfileId: input.targetProfileId,
      ...(input.account ? { account: structuredClone(input.account) } : {}),
      childIntentDigest: PREFLIGHT_DIGEST,
      outerIntentDigest: PREFLIGHT_DIGEST,
      wrapperGraphDigest: PREFLIGHT_DIGEST,
      staticInputDigest: PREFLIGHT_DIGEST,
      phase: "coverage" as const,
      status: "blocked" as const,
      error: `ACCOUNT_NEEDS_RELOGIN: ${input.detail}`,
    };
  });
  const selectedCellIds = cases.map((item) => item.cellId);
  return {
    schemaVersion: 1,
    id: input.batchId,
    projectId: input.projectId,
    ...(input.ownerId ? { ownerId: input.ownerId } : {}),
    appMapId: input.appMapId,
    combineId: input.combineId,
    sourceRevision: input.appMapRevision,
    latestRevision: input.appMapRevision,
    ...(input.target ? { target: structuredClone(input.target) } : {}),
    status: "completed-with-problems",
    createdAt: input.at,
    updatedAt: input.at,
    cases,
    lineage: [
      {
        kind: "created",
        at: input.at,
        appMapRevision: input.appMapRevision,
        ...(input.ownerId ? { actorId: input.ownerId } : {}),
      },
    ],
    execution: {
      selectedCellIds,
      selectedExecutionCaseIds: cases.map((item) => item.executionCaseId),
      seed: 0,
      title: "Sign-ins",
    },
  };
}

export async function persistAccountReloginPlanResult(
  input: AccountReloginPlanPersistInput,
): Promise<{
  batchId: string;
  findings: CombineEvidenceAnalysisReport;
}> {
  const batchId = randomUUID();
  const findings = accountReloginFindingsReport({
    detail: input.detail,
    batchId,
    generatedAt: Date.now(),
  });
  await writeAccountReloginFindings(findings);
  await createCombineCampaign(
    blockedAccountReloginCampaign({
      ...input,
      batchId,
      at: Date.now(),
    }),
  );
  return { batchId, findings };
}
