import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  CombineEvidenceAnalysisReport,
  JevEvidenceTriage,
  ModelDecisionRequest,
} from "@relay/protocol";
import { canonicalSha256 } from "./canonical-json.js";
import {
  DEFAULT_OPENROUTER_DECISION_MODEL,
  createOpenRouterDecisionProvider,
  type ModelDecisionProvider,
} from "./model-decision-provider.js";
import { redactSensitiveEvidenceValue } from "./redaction.js";
import { findWorkspaceRoot } from "./workspace-root.js";

const MAX_FINDINGS = 40;

export type EvidenceTriageOptions = {
  model?: string;
};

/** Build the small, text-only input for a triage request over saved evidence. */
export function evidenceTriageRequest(
  report: CombineEvidenceAnalysisReport,
  options: EvidenceTriageOptions = {},
): ModelDecisionRequest {
  const state = {
    kind: "combine-evidence",
    batchId: report.batchId,
    summary: {
      critical: report.analysis.critical,
      warnings: report.analysis.warnings,
      affectedScreens: report.analysis.affectedScreens,
      frames: report.coverage.frames,
      inspectedFrames: report.coverage.inspectedFrames,
    },
    findings: report.analysis.findings.slice(0, MAX_FINDINGS).map((finding) => ({
      id: finding.id,
      code: finding.code,
      severity: finding.severity,
      confidence: finding.confidence,
      screen: finding.screenLabel,
      locale: finding.locale,
      detail: finding.detail,
    })),
  } as const;
  const safeState = redactSensitiveEvidenceValue(state);
  return {
    schemaVersion: 1,
    provider: "openrouter",
    model:
      options.model ?? process.env.OPENROUTER_DECISION_MODEL ?? DEFAULT_OPENROUTER_DECISION_MODEL,
    state: safeState as ModelDecisionRequest["state"],
    questions: {
      review_scope: {
        type: "choice",
        instructions: "Which category of saved evidence should a human review first?",
        criteria: {
          critical: "Confirmed critical findings or product assertions.",
          blocked: "Blocked or missing evidence that prevents a trustworthy conclusion.",
          warnings: "Qualified warnings and possible issues.",
          all: "Review every finding in the saved result.",
          none: "No additional review priority beyond the existing result.",
        },
      },
    },
    observationDigest: canonicalSha256(safeState),
    evidenceRefs: [`combine:${report.batchId}`],
  };
}

function idsForScope(report: CombineEvidenceAnalysisReport, scope: string): string[] {
  return report.analysis.findings
    .filter((finding) => {
      if (scope === "critical") return finding.severity === "critical";
      if (scope === "blocked") return finding.code === "BLOCKED";
      if (scope === "warnings") return finding.severity === "warning";
      if (scope === "all") return true;
      return false;
    })
    .map((finding) => finding.id);
}

/**
 * Ask OpenRouter to sort an existing result for human attention. This does not
 * mutate jobs, findings, screenshot decisions, execution state, or approval.
 */
export async function triageEvidenceReport(
  report: CombineEvidenceAnalysisReport,
  provider: ModelDecisionProvider = createOpenRouterDecisionProvider(),
  options: EvidenceTriageOptions = {},
): Promise<JevEvidenceTriage> {
  const decision = await provider.decide(evidenceTriageRequest(report, options));
  if (decision.status !== "ok") {
    return {
      schemaVersion: 1,
      status: decision.status,
      provider: "openrouter",
      batchId: report.batchId,
      findingIds: [],
      rationale: decision.error?.message ?? "OpenRouter did not return a usable triage suggestion.",
      decision,
    };
  }
  const answer = decision.answers?.review_scope;
  if (!answer || answer.type !== "choice") {
    return {
      schemaVersion: 1,
      status: "invalid",
      provider: "openrouter",
      batchId: report.batchId,
      findingIds: [],
      rationale: "OpenRouter returned no valid review scope.",
      decision: {
        ...decision,
        status: "invalid",
        error: { code: "invalid-response", message: "review_scope answer is missing" },
        answers: undefined,
      },
    };
  }
  const findingIds = idsForScope(report, answer.choice);
  return {
    schemaVersion: 1,
    status: "suggested",
    provider: "openrouter",
    batchId: report.batchId,
    findingIds,
    rationale: `Suggested human review scope: ${answer.choice}. This is triage only; it does not approve or reject evidence.`,
    decision,
  };
}

function triageRoot(batchId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(batchId)) {
    throw new TypeError("Invalid combine batch id for triage history.");
  }
  return join(
    process.env.RELAY_WORKSPACE_ROOT?.trim() || findWorkspaceRoot(),
    ".relay",
    "combine-evidence",
    batchId,
    "triage",
  );
}

/**
 * Persist one triage result as append-only history beside the batch evidence.
 * Suggestions stay separate from deterministic findings and human decisions;
 * re-evaluation writes a new record and never rewrites history.
 */
export async function saveEvidenceTriage(triage: JevEvidenceTriage): Promise<string> {
  const dir = triageRoot(triage.batchId);
  await mkdir(dir, { recursive: true });
  const name = `${triage.decision.completedAt}-${triage.decision.requestId}.json`;
  const path = join(dir, name);
  await writeFile(path, `${JSON.stringify(triage, null, 2)}\n`, "utf8");
  return path;
}

export type EvidenceTriageHistoryEntry = {
  fileName: string;
  triage: JevEvidenceTriage;
};

/** Every persisted triage for one batch, oldest first. */
export async function listEvidenceTriageHistory(
  batchId: string,
): Promise<EvidenceTriageHistoryEntry[]> {
  let files: string[];
  try {
    files = await readdir(triageRoot(batchId));
  } catch {
    return [];
  }
  const entries: EvidenceTriageHistoryEntry[] = [];
  for (const fileName of files.filter((name) => name.endsWith(".json")).sort()) {
    try {
      const parsed: unknown = JSON.parse(
        await readFile(join(triageRoot(batchId), fileName), "utf8"),
      );
      if (
        parsed &&
        typeof parsed === "object" &&
        "batchId" in parsed &&
        "decision" in parsed &&
        "schemaVersion" in parsed
      ) {
        entries.push({ fileName, triage: parsed as JevEvidenceTriage });
      }
    } catch {
      // A partially readable history entry must not break listing the rest.
    }
  }
  return entries;
}

/** The most recent persisted triage for one batch, when it exists. */
export async function latestEvidenceTriage(
  batchId: string,
): Promise<JevEvidenceTriage | undefined> {
  const history = await listEvidenceTriageHistory(batchId);
  return history.at(-1)?.triage;
}
