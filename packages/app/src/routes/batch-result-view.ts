import {
  classifyProductResultCell,
  summarizeProductResultGrid,
} from "@relay/product/plan-result-cells";
import type { ProductResultCellKind } from "@relay/product/plan-result-cells";
import type {
  ProductBatchCase,
  ProductBatchFailureCluster,
  ProductBatchReport,
} from "@relay/product/run-across";

const ENGINE_SUMMARY = /^(causal|visual|localization|network|crash)\s+failure(?:\s+in\s+\S+)?$/iu;
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

export type BatchTestNames = Readonly<Record<string, string>>;

export type BatchClusterCopy = {
  readonly lane: string;
  readonly title: string;
  readonly meta: string;
  readonly repair?: string;
  readonly repairTestId?: string;
};

export function batchResultHeadline(report: ProductBatchReport): string {
  const grid = summarizeProductResultGrid(report.cases);
  if (grid.coverage.planned === 0) return "No cases were run";
  if (grid.cells.cancelled === grid.coverage.planned) return "This plan Result was cancelled";
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
  if (grid.cells.running || grid.cells.pending) return "This plan Result is still running";
  if (grid.passed === grid.coverage.planned) return "All selected cases passed";
  return "This plan Result did not finish every case";
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
      tone: "warning",
    });
  }
  if (grid.cells.cancelled) {
    facts.push({
      label: "Cancelled",
      value: grid.cells.cancelled,
      tone: "warning",
    });
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
  else if (environments.length > 1 && environments.length <= 3)
    parts.push(environments.join(" · "));
  return parts.length ? parts.join(" · ") : undefined;
}

export function batchClusterGroupCount(count: number): string {
  return count === 1 ? "1 group" : `${count} groups`;
}

export function batchClusterCopy(
  cluster: ProductBatchFailureCluster,
  cases: readonly ProductBatchCase[] = [],
): BatchClusterCopy {
  const members = clusterMembers(cluster, cases);
  const lane = batchClusterLane(cluster, members);
  const title = batchClusterTitle(cluster, members);
  const match =
    members[0] ??
    cases.find((item) => item.id === cluster.representativeCaseId) ??
    cases.find((item) => cluster.caseIds.includes(item.id));
  const environment = formatBatchEnvironmentLabel(cluster.environmentId, {
    environmentLabel: match?.identity?.environmentLabel,
    targetLabel: match?.identity?.targetLabel,
  });
  const count = cluster.caseIds.length;
  const casesLabel = count === 1 ? "1 case" : `${count} cases`;
  const metaParts = [casesLabel, environment].filter((part) => part && part !== title);
  const repair = signInRepair(members);
  const repairTestId = members.find(
    (item) => item.findingCode === "ACCOUNT_NEEDS_RELOGIN" && item.identity?.testId,
  )?.identity?.testId;
  return {
    lane,
    title,
    meta: metaParts.join(" · "),
    ...(repair ? { repair } : {}),
    ...(repairTestId ? { repairTestId } : {}),
  };
}

function signInRepair(members: readonly ProductBatchCase[]): string | undefined {
  const expired = members.filter((item) => item.findingCode === "ACCOUNT_NEEDS_RELOGIN");
  if (!expired.length) return undefined;
  return "Sign-in expired. Completed screenshots are saved. Open the browser used for this case, sign in again, and save the updated account. Then choose that account in the Test setup and rerun the affected case.";
}

export function batchClusterTitle(
  cluster: ProductBatchFailureCluster,
  members: readonly ProductBatchCase[] = [],
): string {
  if (members.length && members.every((item) => item.status === "cancelled")) return "Cancelled";
  if (members.length && members.every((item) => harnessCase(item))) return "Could not run";
  const summary = cluster.signature.summary.trim();
  if (summary && !ENGINE_SUMMARY.test(summary)) return summary;
  if (cluster.kind === "visual") return "Visual difference";
  if (cluster.kind === "localization") return "Localization";
  if (cluster.kind === "network") return "Network";
  if (cluster.kind === "crash") return "Crash";
  return "Product behavior";
}

export function batchClusterLane(
  cluster: ProductBatchFailureCluster,
  members: readonly ProductBatchCase[] = [],
): string {
  if (members.length) {
    const lanes = [
      ...new Set(members.map((item) => resultCellLane(classifyProductResultCell(item)))),
    ];
    if (lanes.length > 1) return "Mixed";
    if (lanes[0]) return lanes[0];
  }
  const category = cluster.signature.failureCategory;
  if (category && HARNESS_CATEGORIES.has(category)) return "Infra";
  if (
    category === "judge-uncertainty" ||
    category === "review-required" ||
    cluster.kind === "visual"
  ) {
    return "Needs review";
  }
  return "Product";
}

function resultCellLane(kind: ProductResultCellKind): string {
  if (kind === "check-failed") return "Product";
  if (kind === "could-not-run") return "Infra";
  if (kind === "needs-review" || kind === "cancelled") return "Needs review";
  return "Product";
}

export function formatBatchEnvironmentLabel(
  environmentId: string,
  hints?: {
    environmentLabel?: string;
    targetLabel?: string;
  },
): string {
  // A saved session ("<browser>#signed-out:<session>") is named by the
  // session itself; otherwise a human label beats a "browser:<id>" handle.
  const session = /#[^:#]+:([A-Za-z0-9][\w-]*)$/u.exec(environmentId)?.[1];
  if (session && !isProfileDump(session)) return session;
  const target = hints?.targetLabel?.trim();
  if (target && !isProfileDump(target)) return target;
  const handle = /^browser:([A-Za-z][\w-]*)$/u.exec(environmentId)?.[1];
  if (handle && !isProfileDump(handle)) return handle;
  const labeled = hints?.environmentLabel?.trim();
  if (labeled && !isProfileDump(labeled)) return labeled;
  const formatted = tidyProfileId(environmentId);
  return formatted || titleCaseIdentity(environmentId);
}

export function formatBatchColumnLabel(input: {
  environmentId: string;
  environmentLabel?: string;
  targetLabel?: string;
  accountLabel?: string;
  locale?: string;
}): string {
  if (input.environmentId === "selected-environment") return "Device";
  const device = formatBatchEnvironmentLabel(input.environmentId, {
    environmentLabel: devicePart(input.environmentLabel) ?? input.targetLabel,
    targetLabel: input.targetLabel,
  });
  const account = formatBatchAccountLabel(input.accountLabel, input.environmentLabel);
  const viewport = formatBatchViewport(input.environmentId, input.environmentLabel);
  const locale = formatBatchLocaleLabel(input.locale);
  const parts = [account, device, viewport, locale].filter(
    (part, index, all): part is string =>
      Boolean(part) &&
      all.indexOf(part) === index &&
      (part !== viewport || !deviceHasViewport(device, viewport)),
  );
  return parts.join(" · ") || device;
}

export function formatBatchTestLabel(testId: string, testName?: string): string {
  const named = testName?.trim();
  if (named && !isEngineTestDump(named)) return named;
  if (isEngineTestDump(testId) || (named && isEngineTestDump(named))) return "Test";
  return titleCaseIdentity(tidyTestId(testId));
}

export function formatBatchWorldLabel(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (/logged[\s_-]*out/iu.test(trimmed)) return "Logged out";
  return titleCaseIdentity(trimmed);
}

export function formatBatchFindingCode(code: string): string {
  if (code === "HARNESS_FAILURE") return "Harness";
  if (code === "PRODUCT_ASSERTION") return "Product check";
  if (code === "ACCOUNT_NEEDS_RELOGIN") return "Sign-in";
  if (code === "BLOCKED") return "Blocked";
  if (code === "USER_CANCELLED") return "Cancelled";
  if (code === "JUDGE_UNCERTAIN") return "Judge";
  if (code === "VISUAL_CHANGED") return "Changed";
  if (code.startsWith("POSSIBLE_")) return "Needs review";
  return titleCaseIdentity(code);
}

export function formatBatchCaseError(error: string): string {
  return error
    .replace(ENGINE_SUMMARY, "This check failed")
    .replace(/\b(?:step[-:][0-9a-f]{6,}|check[-:]\d+)\b/giu, "")
    .replace(/\s{2,}/gu, "")
    .replace(/[·,;:\s]+$/u, "")
    .trim();
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

function clusterMembers(
  cluster: ProductBatchFailureCluster,
  cases: readonly ProductBatchCase[],
): readonly ProductBatchCase[] {
  const ids = new Set(cluster.caseIds);
  return cases.filter((item) => ids.has(item.id) || item.id === cluster.representativeCaseId);
}

function deviceHasViewport(device: string, viewport?: string): boolean {
  if (!viewport) return false;
  const compact = viewport.replaceAll(/\s+/gu, "").replace("×", "x");
  return device.replaceAll(/\s+/gu, "").replace("×", "x").includes(compact);
}

function formatBatchViewport(environmentId: string, environmentLabel?: string): string | undefined {
  const match = `${environmentId} ${environmentLabel ?? ""}`.match(
    /(\d{3,4})\s*[x×]\s*(\d{3,4})/iu,
  );
  return match ? `${match[1]} × ${match[2]}` : undefined;
}

function formatBatchLocaleLabel(locale?: string): string | undefined {
  const trimmed = locale?.trim();
  if (!trimmed) return undefined;
  if (/logged[\s_-]*out/iu.test(trimmed)) return "Logged out";
  try {
    const named = new Intl.DisplayNames(["en"], { type: "language" }).of(
      trimmed.replaceAll("_", "-"),
    );
    if (named && named !== trimmed) return named;
  } catch {
    /* keep title-case fallback */
  }
  return titleCaseIdentity(trimmed);
}

function harnessCase(item: ProductBatchCase): boolean {
  return (
    item.findingCode === "HARNESS_FAILURE" ||
    item.findingCode === "ACCOUNT_NEEDS_RELOGIN" ||
    item.findingCode === "BLOCKED" ||
    item.outcome === "harness-failure"
  );
}

function tidyTestId(value: string): string {
  return value.trim().replace(/^test-/u, "");
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
  next = next
    .replaceAll(/[-_.:]+/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();
  next = next.replace(/^(browser|ios|android)\s+/iu, "");
  const compact = next.replaceAll(/\s+/gu, "-").toLowerCase();
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
