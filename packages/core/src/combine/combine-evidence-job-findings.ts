import type { CombineEvidenceFinding } from "@relay/protocol";

/** Minimal job shape the morning report needs to type a failed cell. */
export type JobOutcomeFindingSource = {
  id: string;
  action: string;
  status: string;
  title?: string;
  error?: string;
  outcome?: string;
  failureCategory?: string;
  /** Durable Test id when the job already knows it. Never inferred from title. */
  testId?: string;
  artifacts?: readonly { kind?: string; data?: unknown }[];
};

const EXPECT_SCREEN_RE = /expect-screen:\s*on\s+[“"](.+?)[”"],\s*not\s+[“"](.+?)[”"]/u;

const SKIP_STATUSES = new Set(["ok", "healed", "queued", "running"]);

export function isCancelledJobOutcome(job: JobOutcomeFindingSource): boolean {
  return job.status === "cancelled" || job.outcome === "cancelled";
}

export function isHarnessJobOutcome(job: JobOutcomeFindingSource): boolean {
  return job.outcome === "harness-failure" || Boolean(sosInterventionDetail(job));
}

export function isBlockedJobOutcome(job: JobOutcomeFindingSource): boolean {
  return job.status === "blocked" || job.outcome === "blocked";
}

/** Dual-judge disagreement or an uncertain verdict. Never a silent pass or baseline accept. */
export function isJudgeUncertainJob(job: JobOutcomeFindingSource): boolean {
  if (isHarnessJobOutcome(job) || isCancelledJobOutcome(job) || isBlockedJobOutcome(job)) {
    return false;
  }
  if (job.failureCategory === "judge-uncertainty") return true;
  const error = job.error ?? "";
  if (/judge unavailable/iu.test(error)) return false;
  return /judge uncertain/iu.test(error);
}

export function isProductAssertionJob(job: JobOutcomeFindingSource): boolean {
  if (SKIP_STATUSES.has(job.status) || isHarnessJobOutcome(job)) return false;
  if (isJudgeUncertainJob(job)) return false;
  if (job.outcome === "product-failure") return true;
  if (job.failureCategory === "deterministic-assertion") return true;
  return /expect-screen/iu.test(job.error ?? "");
}

function sosInterventionDetail(job: JobOutcomeFindingSource): string | undefined {
  for (const artifact of job.artifacts ?? []) {
    if (artifact.kind !== "campaign-recovery-intervention") continue;
    const data =
      artifact.data && typeof artifact.data === "object" && !Array.isArray(artifact.data)
        ? (artifact.data as { reason?: unknown; checkTitle?: unknown; transitionId?: unknown })
        : undefined;
    const parts = [data?.checkTitle, data?.reason, data?.transitionId]
      .filter((part): part is string => typeof part === "string" && Boolean(part.trim()))
      .map((part) => part.trim());
    if (parts.length) return `SOS: cold recovery blocked — ${parts.join(" — ")}`;
  }
  return undefined;
}

function harnessDetail(job: JobOutcomeFindingSource): string {
  const sos = sosInterventionDetail(job);
  if (sos) return sos;
  const error = job.error?.trim();
  if (isCancelledJobOutcome(job)) {
    return error
      ? `Cancelled — ${error}. SOS/cancelled is Infra, not a product pass.`
      : "Cancelled. SOS/cancelled is Infra, not a product pass.";
  }
  return error || "Harness failed this cell.";
}

function expectScreenSides(error: string | undefined): {
  expected?: string;
  observed?: string;
} {
  if (!error) return {};
  const match = EXPECT_SCREEN_RE.exec(error);
  if (!match) return {};
  return { observed: match[1], expected: match[2] };
}

function screenLabelFor(job: JobOutcomeFindingSource, expected?: string): string {
  if (expected?.trim()) return expected.trim();
  const title = job.title?.trim();
  if (title) {
    const leaf = title.split("·").at(-1)?.trim();
    if (leaf) return leaf;
  }
  return job.action;
}

function withJobTestId(
  finding: CombineEvidenceFinding,
  job: JobOutcomeFindingSource,
): CombineEvidenceFinding {
  const testId = job.testId?.trim();
  return testId ? { ...finding, testId } : finding;
}

/** One finding per recipe/expect-screen product-failure, harness-failure, blocked, or cancelled cell. */
export function jobOutcomeFindings<T extends JobOutcomeFindingSource>(
  jobs: readonly T[],
  localeFor: (job: T) => string,
): CombineEvidenceFinding[] {
  const findings: CombineEvidenceFinding[] = [];
  for (const job of jobs) {
    const locale = localeFor(job);
    if (isHarnessJobOutcome(job)) {
      findings.push(
        withJobTestId(
          {
            id: `harness-failure-${job.id}`,
            code: "HARNESS_FAILURE",
            severity: "critical",
            confidence: "high",
            canonicalKey: `job:${job.id}`,
            screenLabel: screenLabelFor(job),
            locale,
            baselineLocale: locale,
            detail: harnessDetail(job),
          },
          job,
        ),
      );
      continue;
    }
    if (isCancelledJobOutcome(job)) {
      findings.push(
        withJobTestId(
          {
            id: `user-cancelled-${job.id}`,
            code: "USER_CANCELLED",
            severity: "warning",
            confidence: "high",
            canonicalKey: `job:${job.id}`,
            screenLabel: screenLabelFor(job),
            locale,
            baselineLocale: locale,
            detail: job.error?.trim()
              ? `Cancelled — ${job.error.trim()}. Operator cancellation is not an infra root cause.`
              : "Cancelled by the operator. This is not an infra root cause.",
          },
          job,
        ),
      );
      continue;
    }
    if (isBlockedJobOutcome(job)) {
      findings.push(
        withJobTestId(
          {
            id: `blocked-${job.id}`,
            code: "BLOCKED",
            severity: "critical",
            confidence: "high",
            canonicalKey: `job:${job.id}`,
            screenLabel: screenLabelFor(job),
            locale,
            baselineLocale: locale,
            detail: job.error?.trim() || "This case could not run. Resolve blockers.",
          },
          job,
        ),
      );
      continue;
    }
    if (isJudgeUncertainJob(job)) {
      findings.push(
        withJobTestId(
          {
            id: `judge-uncertain-${job.id}`,
            code: "JUDGE_UNCERTAIN",
            severity: "warning",
            confidence: "medium",
            canonicalKey: `job:${job.id}`,
            screenLabel: screenLabelFor(job),
            locale,
            baselineLocale: locale,
            detail: job.error?.trim()
              ? `${job.error.trim()}. Needs review. This does not accept a visual baseline.`
              : "The visual or semantic judge was uncertain. Needs review. This does not accept a visual baseline.",
          },
          job,
        ),
      );
      continue;
    }
    if (!isProductAssertionJob(job)) continue;
    const sides = expectScreenSides(job.error);
    findings.push(
      withJobTestId(
        {
          id: `product-assertion-${job.id}`,
          code: "PRODUCT_ASSERTION",
          severity: "critical",
          confidence: "high",
          canonicalKey: `job:${job.id}`,
          screenLabel: screenLabelFor(job, sides.expected),
          locale,
          baselineLocale: locale,
          ...(sides.expected ? { expected: sides.expected } : {}),
          ...(sides.observed ? { observed: sides.observed } : {}),
          detail: job.error?.trim() || "Recipe product-failure.",
        },
        job,
      ),
    );
  }
  return findings;
}

export function primaryJobFindingCode(
  job: JobOutcomeFindingSource,
): CombineEvidenceFinding["code"] | undefined {
  return jobOutcomeFindings([job], () => "")[0]?.code;
}

export function mergeJobOutcomeFindings<
  T extends {
    findings: CombineEvidenceFinding[];
    critical: number;
    warnings: number;
    affectedScreens: number;
  },
>(analysis: T, extras: readonly CombineEvidenceFinding[]): T {
  if (!extras.length) return analysis;
  const findings = [...analysis.findings, ...extras];
  return {
    ...analysis,
    findings,
    critical: findings.filter((finding) => finding.severity === "critical").length,
    warnings: findings.filter((finding) => finding.severity === "warning").length,
    affectedScreens: new Set(findings.map((finding) => finding.canonicalKey)).size,
  };
}
