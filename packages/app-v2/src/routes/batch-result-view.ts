import { summarizeProductResultGrid } from "@relay/product/plan-result-cells";
import type {
  ProductBatchCase,
  ProductBatchFailureCluster,
  ProductBatchReport,
} from "@relay/product/run-across";

const KNOWN_LANES = ["grok-lab", "grok-daily"] as const;
const ENGINE_SUMMARY =
  /^(causal|visual|localization|network|crash)\s+failure(?:\s+in\s+\S+)?$/iu;
const VIEWPORT_TOKEN = /[-_:\s]*\d{3,4}\s*[x×]\s*\d{3,4}\b/giu;
const HEX_TOKEN = /(?:[-_:.])[0-9a-f]{8,}\b/giu;
const HARNESS_CATEGORIES = new Set([
  "environment",
  "target-state",
  "locator",
  "completion",
  "extraction",
  "harness-defect",
]);

export type BatchResultFact = {
  readonly label: string;
  readonly value: number;
  readonly tone?: "critical" | "warning";
};

export type BatchClusterCopy = {
  readonly lane: string;
  readonly title: string;
  readonly meta: string;
};

export function batchResultHeadline(report: ProductBatchReport): string {
  const grid = summarizeProductResultGrid(report.cases);
  if (grid.coverage.planned === 0) return "No cases were run";
  if (grid.cells.cancelled === grid.coverage.planned) return "This Plan Result was cancelled";
  if (grid.failed === 1) return "1 product issue to review";
  if (grid.failed > 1) return `${grid.failed} product issues to review`;
  if (grid.cells["needs-review"] === 1) return "1 case needs review";
  if (grid.cells["needs-review"] > 1) {
    return `${grid.cells["needs-review"]} cases need review`;
  }
  if (grid.cells["could-not-run"] === 1) return "1 case could not run";
  if (grid.cells["could-not-run"] > 1) {
    return `${grid.cells["could-not-run"]} cases could not run`;
  }
  if (grid.cells.running || grid.cells.pending) return "This Plan Result is still running";
  if (grid.passed === grid.coverage.planned) return "All selected cases passed";
  return "This Plan Result did not finish every case";
}

export function batchResultFacts(report: ProductBatchReport): readonly BatchResultFact[] {
  const grid = summarizeProductResultGrid(report.cases);
  const facts: BatchResultFact[] = [{ label: "Passed", value: grid.passed }];
  if (grid.failed) {
    facts.push({
      label: grid.failed === 1 ? "Product issue" : "Product issues",
      value: grid.failed,
      tone: "critical",
    });
  }
  if (grid.cells["needs-review"]) {
    facts.push({
      label: grid.cells["needs-review"] === 1 ? "Needs review" : "Need review",
      value: grid.cells["needs-review"],
      tone: "warning",
    });
  }
  if (grid.cells["could-not-run"]) {
    facts.push({
      label: "Could not run",
      value: grid.cells["could-not-run"],
    });
  }
  if (grid.cells.cancelled) {
    facts.push({ label: "Cancelled", value: grid.cells.cancelled });
  }
  const waiting = grid.cells.running + grid.cells.pending;
  if (waiting) {
    facts.push({
      label: grid.cells.running ? "Running" : "Waiting",
      value: waiting,
    });
  }
  return facts;
}

export function batchResultContext(report: ProductBatchReport): string | undefined {
  const parts: string[] = [];
  const testName = report.setup?.testName.trim();
  if (testName) parts.push(testName);
  const dataSet = report.setup?.dataSet.name.trim();
  if (dataSet) parts.push(dataSet);
  const environments = [
    ...new Set(
      report.cases.flatMap((item) => {
        const label = item.identity
          ? formatBatchEnvironmentLabel(item.identity.environmentId, {
              environmentLabel: item.identity.environmentLabel,
              targetLabel: item.identity.targetLabel,
            })
          : undefined;
        return label ? [label] : [];
      }),
    ),
  ];
  if (environments.length === 1) parts.push(environments[0]!);
  else if (environments.length > 1 && environments.length <= 3) parts.push(environments.join(" · "));
  return parts.length ? parts.join(" · ") : undefined;
}

export function batchClusterGroupCount(count: number): string {
  return count === 1 ? "1 group" : `${count} groups`;
}

export function batchClusterCopy(
  cluster: ProductBatchFailureCluster,
  cases: readonly ProductBatchCase[] = [],
): BatchClusterCopy {
  const lane = batchClusterLane(cluster);
  const title = batchClusterTitle(cluster);
  const match =
    cases.find((item) => item.id === cluster.representativeCaseId) ??
    cases.find((item) => cluster.caseIds.includes(item.id));
  const environment = formatBatchEnvironmentLabel(cluster.environmentId, {
    environmentLabel: match?.identity?.environmentLabel,
    targetLabel: match?.identity?.targetLabel,
  });
  const count = cluster.caseIds.length;
  const casesLabel = count === 1 ? "1 case" : `${count} cases`;
  const metaParts = [casesLabel, environment].filter((part) => part && part !== title);
  return { lane, title, meta: metaParts.join(" · ") };
}

export function batchClusterTitle(cluster: ProductBatchFailureCluster): string {
  const summary = cluster.signature.summary.trim();
  if (summary && !ENGINE_SUMMARY.test(summary)) return summary;
  if (cluster.kind === "visual") return "Visual difference";
  if (cluster.kind === "localization") return "Localization";
  if (cluster.kind === "network") return "Network";
  if (cluster.kind === "crash") return "Crash";
  return "Product behavior";
}

export function batchClusterLane(cluster: ProductBatchFailureCluster): string {
  const category = cluster.signature.failureCategory;
  if (category && HARNESS_CATEGORIES.has(category)) return "Infra";
  if (
    category === "judge-uncertainty" ||
    category === "review-required" ||
    cluster.kind === "visual"
  ) {
    return "Needs review";
  }
  if (cluster.kind === "network" || cluster.kind === "crash") return "Infra";
  return "Product";
}

export function formatBatchEnvironmentLabel(
  environmentId: string,
  hints?: {
    environmentLabel?: string;
    targetLabel?: string;
  },
): string {
  const candidates = [environmentId, hints?.environmentLabel, hints?.targetLabel];
  for (const lane of KNOWN_LANES) {
    if (candidates.some((value) => value?.includes(lane))) return lane;
  }
  const labeled = hints?.targetLabel?.trim() || hints?.environmentLabel?.trim();
  if (labeled && !isProfileDump(labeled)) return labeled;
  const formatted = tidyProfileId(environmentId);
  return formatted || titleCaseIdentity(environmentId);
}

export function formatBatchColumnLabel(input: {
  environmentId: string;
  environmentLabel?: string;
  targetLabel?: string;
  accountLabel?: string;
}): string {
  if (input.environmentId === "selected-environment") return "Device";
  const device = formatBatchEnvironmentLabel(input.environmentId, {
    environmentLabel: devicePart(input.environmentLabel) ?? input.targetLabel,
    targetLabel: input.targetLabel,
  });
  const account = formatBatchAccountLabel(input.accountLabel, input.environmentLabel);
  if (account && account !== device) return `${account} · ${device}`;
  return device;
}

export function formatBatchTestLabel(testId: string, testName?: string): string {
  const named = testName?.trim();
  if (named && !isEngineTestDump(named)) return named;
  if (isEngineTestDump(testId) || (named && isEngineTestDump(named))) return "Test";
  return titleCaseIdentity(testId);
}

function formatBatchAccountLabel(
  accountLabel?: string,
  environmentLabel?: string,
): string | undefined {
  const explicit = accountLabel?.trim();
  if (explicit && !isOpaqueId(explicit)) return explicit;
  const left = environmentLabel?.split("·")[0]?.trim();
  if (left && /logged\s*out/iu.test(left)) return "Logged out";
  if (left && !isOpaqueId(left) && left !== devicePart(environmentLabel)) return left;
  return undefined;
}

function devicePart(environmentLabel?: string): string | undefined {
  if (!environmentLabel) return undefined;
  return environmentLabel.split("·").at(-1)?.trim() || undefined;
}

function isEngineTestDump(value: string): boolean {
  return /authoring/iu.test(value) && /[0-9a-f]{6,}/iu.test(value);
}

function isOpaqueId(value: string): boolean {
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value) ||
    /[0-9a-f]{10,}/iu.test(value.replaceAll("-", ""))
  );
}

function isProfileDump(value: string): boolean {
  return /[0-9a-f]{10,}/iu.test(value) || /\d{3,4}\s*[x×]\s*\d{3,4}/u.test(value);
}

function tidyProfileId(value: string): string {
  let next = value.trim().replace(VIEWPORT_TOKEN, "").replace(HEX_TOKEN, "");
  next = next.replaceAll(/[-_.:]+/gu, " ").replaceAll(/\s+/gu, " ").trim();
  next = next.replace(/^(browser|ios|android)\s+/iu, "");
  const compact = next.replaceAll(/\s+/gu, "-").toLowerCase();
  if (compact === "grok-com" || compact === "grokcom") return "grok-com";
  if (!next) return "";
  return titleCaseIdentity(next);
}

function titleCaseIdentity(value: string): string {
  return value
    .replaceAll(/[-_.:]+/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim()
    .replace(/^./u, (character) => character.toUpperCase());
}
