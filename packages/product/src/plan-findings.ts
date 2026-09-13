import type {
  CombineEvidenceAnalysisReport,
  CombineEvidenceFinding,
  CombineTriageStatus,
} from "@relay/protocol";

export type PlanFindingDecision = "confirm" | "reject";

export type PlanFindingReviewEffect = {
  readonly triageStatus: Extract<CombineTriageStatus, "investigating" | "wont-fix">;
  readonly acceptsVisualBaseline: false;
  readonly visualReviewAction: null;
  readonly note: string;
};

/** Confirm/Reject never accept a visual baseline or flip a product failure to pass. */
export function planFindingReviewEffect(decision: PlanFindingDecision): PlanFindingReviewEffect {
  if (decision === "confirm") {
    return {
      triageStatus: "investigating",
      acceptsVisualBaseline: false,
      visualReviewAction: null,
      note: "Confirmed as a product issue. This does not accept a new visual baseline.",
    };
  }
  return {
    triageStatus: "wont-fix",
    acceptsVisualBaseline: false,
    visualReviewAction: null,
    note: "Rejected as not a product failure this run. This does not accept a new visual baseline.",
  };
}

export type PlanFindingProposal = {
  readonly verdict: PlanFindingDecision;
  readonly reason: string;
};

/** Agent proposal only. Confirm/Reject still required; never accepts a baseline. */
export function proposePlanFinding(finding: CombineEvidenceFinding): PlanFindingProposal {
  if (finding.code === "ACCOUNT_NEEDS_RELOGIN") {
    return {
      verdict: "reject",
      reason:
        "This is Infra (expired or signed-out account), not a grok.com product failure. Open Sign-ins, complete OAuth, then Refresh. This still does not accept a visual baseline.",
    };
  }
  if (finding.code === "HARNESS_FAILURE") {
    return {
      verdict: "reject",
      reason:
        "This is Infra (harness or runner), not a grok.com product failure. This still does not accept a visual baseline.",
    };
  }
  if (finding.code === "USER_CANCELLED") {
    return {
      verdict: "reject",
      reason:
        "The operator cancelled this case. That is not an infra root cause and not a product pass. This still does not accept a visual baseline.",
    };
  }
  if (finding.code === "BLOCKED") {
    return {
      verdict: "reject",
      reason:
        "This case could not run. Resolve blockers. Coverage stays unverified. This still does not accept a visual baseline.",
    };
  }
  if (finding.code === "PRODUCT_ASSERTION") {
    return {
      verdict: "confirm",
      reason:
        "Recipe or expect-screen product-failure. Confirm if grok.com missed the expected screen or assertion. This still does not accept a visual baseline.",
    };
  }
  if (finding.code.startsWith("POSSIBLE_")) {
    return {
      verdict: "reject",
      reason: `${finding.code} is qualified, not a proven product failure. Reject unless you saw the defect on grok.com.`,
    };
  }
  return {
    verdict: "confirm",
    reason: `${finding.code} is missing in frozen evidence. Confirm if the product regressed. This still does not accept a visual baseline.`,
  };
}

/** One Infra finding when combine.start refuses an expired or signed-out fixture. */
export function accountReloginFindingsReport(input: {
  detail: string;
  batchId?: string;
  generatedAt?: number;
}): CombineEvidenceAnalysisReport {
  const batchId = input.batchId ?? "preflight";
  const finding: CombineEvidenceFinding = {
    id: "account-needs-relogin",
    code: "ACCOUNT_NEEDS_RELOGIN",
    severity: "critical",
    confidence: "high",
    canonicalKey: "account",
    screenLabel: "Sign-ins",
    locale: "en",
    baselineLocale: "en",
    expected: "signed-in account fixture",
    observed: "expired or signed out",
    detail: input.detail,
  };
  return {
    schemaVersion: 1,
    batchId,
    locales: ["en"],
    analysis: {
      schemaVersion: 1,
      sessionId: batchId,
      generatedAt: input.generatedAt ?? 0,
      baselineLocale: "en",
      findings: [finding],
      critical: 1,
      warnings: 0,
      affectedScreens: 1,
    },
    coverage: { frames: 0, inspectedFrames: 0 },
    cases: [],
  };
}

function findingBlock(finding: CombineEvidenceFinding): string {
  const proposal = proposePlanFinding(finding);
  const lines = [
    `### ${finding.severity === "critical" ? "Critical" : "Warning"} · ${finding.code}`,
    "",
    `- **id:** ${finding.id}`,
    `- **screen:** ${finding.screenLabel}`,
    `- **locale:** ${finding.locale} (baseline ${finding.baselineLocale})`,
    `- **confidence:** ${finding.confidence}`,
  ];
  if (finding.expected !== undefined) lines.push(`- **expected:** ${finding.expected}`);
  if (finding.observed !== undefined) lines.push(`- **observed:** ${finding.observed}`);
  lines.push(`- **detail:** ${finding.detail}`);
  lines.push(
    `- **Proposed:** ${proposal.verdict === "confirm" ? "Confirm" : "Reject"} — ${proposal.reason}`,
    "",
  );
  lines.push("- **Confirm:** keep this as a product issue (does not accept a visual baseline)");
  lines.push("- **Reject:** not a product failure this run (does not accept a visual baseline)");
  lines.push(
    "- **Accept baseline:** Report → Review screenshots → Compare screenshots, or `relay run visual review`. Never implied by Confirm or Reject",
  );
  return lines.join("\n");
}

/** Morning copy when a Plan Result has zero findings. Confirm/Reject still never accept a baseline. */
export const PLAN_FINDINGS_EMPTY_GUIDANCE = [
  "No findings. Passing cases are not a license to skip the next daily Plan.",
  "A missing Thread, a draft Delete, a rate-limit SOS, or a Cloudflare block is not a product pass.",
  "Confirm and Reject never accept a visual baseline. Accept a baseline from a Report's visual review, or relay run visual review.",
  "Check Sign-ins before the next unattended run. Expired accounts fail closed as Infra.",
] as const;

/** Empty Findings plus a failed cell is a QA gap, never a pass. */
export const PLAN_FINDINGS_FAILED_CELL_GUIDANCE = [
  "This Result has failed or cancelled cells and no findings. That is a QA bug, not a pass.",
  "A recipe product-failure or SOS/cancelled cell must appear here as a finding. Confirm and Reject never auto-pass.",
] as const;

export function planFindingsHasFailedCases(report: CombineEvidenceAnalysisReport): boolean {
  return report.cases.some(
    (item) =>
      item.status === "error" ||
      item.status === "failed" ||
      item.status === "cancelled" ||
      item.status === "blocked",
  );
}

export function planFindingsEmptyCopy(report: CombineEvidenceAnalysisReport): readonly string[] {
  if (!report.analysis.findings.length && planFindingsHasFailedCases(report)) {
    return PLAN_FINDINGS_FAILED_CELL_GUIDANCE;
  }
  return PLAN_FINDINGS_EMPTY_GUIDANCE;
}

/** Used when a finished Result has no analysis artifact. Missing findings are
 * not a product pass. */
export function emptyPlanFindingsReport(batchId: string): CombineEvidenceAnalysisReport {
  return {
    schemaVersion: 1,
    batchId,
    locales: ["en"],
    analysis: {
      schemaVersion: 1,
      sessionId: batchId,
      generatedAt: 0,
      baselineLocale: "en",
      findings: [],
      critical: 0,
      warnings: 0,
      affectedScreens: 0,
    },
    coverage: { frames: 0, inspectedFrames: 0 },
    cases: [],
  };
}

export function renderPlanFindingsMarkdown(report: CombineEvidenceAnalysisReport): string {
  const findings = report.analysis.findings;
  const heading = [
    `# Plan findings — ${report.batchId}`,
    "",
    `${findings.length} finding${findings.length === 1 ? "" : "s"} · ${report.analysis.critical} critical · ${report.analysis.warnings} warning${report.analysis.warnings === 1 ? "" : "s"} · ${report.coverage.inspectedFrames}/${report.coverage.frames} frames inspected.`,
    "",
    "Confirm and Reject record review. They never auto-accept baselines or turn a product failure into a pass.",
    "",
  ];
  if (!findings.length) {
    return [...heading, ...planFindingsEmptyCopy(report), ""].join("\n");
  }
  return [...heading, ...findings.map(findingBlock)].join("\n\n");
}

/** Batch id on a fail-closed ACCOUNT_NEEDS_RELOGIN start, if a Result was persisted. */
export function accountReloginBatchIdFromError(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || Array.isArray(error)) return undefined;
  const record = error as { status?: unknown; body?: unknown; code?: unknown; batchId?: unknown };
  const body =
    record.body && typeof record.body === "object" && !Array.isArray(record.body)
      ? (record.body as Record<string, unknown>)
      : (record as Record<string, unknown>);
  if (body.code !== "ACCOUNT_NEEDS_RELOGIN") return undefined;
  if (record.status !== undefined && record.status !== 409) return undefined;
  return typeof body.batchId === "string" && body.batchId.trim() ? body.batchId.trim() : undefined;
}
