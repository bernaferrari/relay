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
};

const EXPECT_SCREEN_RE = /expect-screen:\s*on\s+[“"](.+?)[”"],\s*not\s+[“"](.+?)[”"]/u;

const SKIP_STATUSES = new Set(["ok", "healed", "queued", "running", "cancelled"]);

export function isHarnessJobOutcome(job: JobOutcomeFindingSource): boolean {
  return job.outcome === "harness-failure";
}

export function isProductAssertionJob(job: JobOutcomeFindingSource): boolean {
  if (SKIP_STATUSES.has(job.status) || isHarnessJobOutcome(job)) return false;
  if (job.outcome === "product-failure") return true;
  if (job.failureCategory === "deterministic-assertion") return true;
  return /expect-screen/iu.test(job.error ?? "");
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

/** One finding per recipe/expect-screen product-failure or harness-failure. */
export function jobOutcomeFindings(
  jobs: readonly JobOutcomeFindingSource[],
  localeFor: (job: JobOutcomeFindingSource) => string,
): CombineEvidenceFinding[] {
  const findings: CombineEvidenceFinding[] = [];
  for (const job of jobs) {
    const locale = localeFor(job);
    if (isHarnessJobOutcome(job)) {
      findings.push({
        id: `harness-failure-${job.id}`,
        code: "HARNESS_FAILURE",
        severity: "critical",
        confidence: "high",
        canonicalKey: `job:${job.id}`,
        screenLabel: screenLabelFor(job),
        locale,
        baselineLocale: locale,
        detail: job.error?.trim() || "Harness failed this cell.",
      });
      continue;
    }
    if (!isProductAssertionJob(job)) continue;
    const sides = expectScreenSides(job.error);
    findings.push({
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
    });
  }
  return findings;
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
