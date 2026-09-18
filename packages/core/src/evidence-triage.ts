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
