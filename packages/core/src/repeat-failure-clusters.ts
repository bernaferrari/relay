import { createHash } from "node:crypto";
import {
  compareUtf8Bytewise,
  destIdentityCheckpointFramePaths,
  isCaptureReviewLeftoverCaption,
} from "@relay/protocol";
import type {
  CombineCampaign,
  FailureCategory,
  RepeatFailureCluster,
  RepeatFailureClusterCase,
  RepeatFailureClusterReport,
  RepeatFailureDecision,
  RepeatFailureKind,
  RepeatFailureSignature,
} from "@relay/protocol";
import type { PersistedRun } from "./runs.js";

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** JSON canonicalization used for signatures. Object insertion order, run
 * timestamps, and provider artifact order must never change a digest. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as RecordValue)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => compareUtf8Bytewise(left, right))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex")}`;
}

/** Remove values that make otherwise equivalent locale failures differ while
 * retaining enough wording to distinguish timeout, locator, and assertion
 * causes. This is only used as a digest basis; raw error evidence stays in the
 * immutable Run. */
function normalizedMessage(value: unknown): string | undefined {
  const input = text(value);
  if (!input) return undefined;
  return (
    input
      .toLowerCase()
      .replace(/https?:\/\/[^\s]+/gu, "<url>")
      .replace(/sha256:[a-f0-9]{16,}/gu, "<digest>")
      .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gu, "<id>")
      // Locale tags are dimensions, not failure causes. Keep ordinary words
      // such as "tap" and "run" intact for the causal classifier.
      .replace(/\b[a-z]{2,3}[-_][a-z]{2,4}\b/giu, "<value>")
      .replace(/\b\d+(?:\.\d+)?\b/gu, "<n>")
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 512)
  );
}

function errorClass(value: unknown): string | undefined {
  const message = normalizedMessage(value);
  if (!message) return undefined;
  const classes: Array<[RegExp, string]> = [
    [/timeout|timed out|deadline/u, "timeout"],
    [/device|adb|session|connection|target/u, "target-unavailable"],
    [/tap failed|locator|selector|no match|not found/u, "locator"],
    [/network|request|http|status/u, "network"],
    [/locale|localization|translation|translated|language/u, "localization"],
    [/visual|screenshot|pixel/u, "visual"],
    [/crash|exception|fatal|signal/u, "crash"],
    [/assert|expected|content/u, "assertion"],
  ];
  return classes.find(([pattern]) => pattern.test(message))?.[1] ?? message;
}

type CheckFailure = {
  id: string;
  status: string;
  error?: string;
  dependencyReason?: string;
  dependencyTransitionId?: string;
  errorCode?: string;
  failureCategory?: FailureCategory;
};

function checkFailures(run: PersistedRun): CheckFailure[] {
  const byId = new Map<string, { check: CheckFailure; capturedAt: number; index: number }>();
  run.artifacts.forEach((artifact, index) => {
    if (artifact.kind !== "campaign-check-result") return;
    const data = record(artifact.data);
    const id = text(data?.id);
    const status = text(data?.status);
    if (!id || !status || !["failed", "blocked", "interrupted"].includes(status)) return;
    const check: CheckFailure = {
      id,
      status,
      ...(text(data?.error) ? { error: text(data?.error) } : {}),
      ...(text(data?.dependencyReason) ? { dependencyReason: text(data?.dependencyReason) } : {}),
      ...(text(data?.dependencyTransitionId)
        ? { dependencyTransitionId: text(data?.dependencyTransitionId) }
        : {}),
      ...(text(data?.errorCode) ? { errorCode: text(data?.errorCode) } : {}),
      ...(text(data?.failureCategory)
        ? { failureCategory: text(data?.failureCategory) as FailureCategory }
        : {}),
    };
    const previous = byId.get(id);
    if (
      !previous ||
      artifact.capturedAt > previous.capturedAt ||
      (artifact.capturedAt === previous.capturedAt && index > previous.index)
    ) {
      byId.set(id, { check, capturedAt: artifact.capturedAt, index });
    }
  });
  return [...byId.values()]
    .sort((left, right) => compareUtf8Bytewise(left.check.id, right.check.id))
    .map(({ check }) => check);
}

function artifactRecords(
  run: PersistedRun,
  kind: string,
): Array<{ data: RecordValue; index: number }> {
  return run.artifacts.flatMap((artifact, index) => {
    if (artifact.kind !== kind) return [];
    const data = record(artifact.data);
    return data ? [{ data, index }] : [];
  });
}

function array(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const input = record(value);
  for (const key of ["entries", "requests", "items", "findings", "events"]) {
    if (Array.isArray(input?.[key])) return input[key] as unknown[];
  }
  return [];
}

function networkBasis(run: PersistedRun): unknown[] {
  const entries = artifactRecords(run, "network").flatMap(({ data }) =>
    array(data.entries ?? data),
  );
  return entries
    .map((entry) => {
      const value = record(entry) ?? {};
      const status = finite(value.status ?? value.statusCode);
      const failed =
        Boolean(value.error ?? value.failure) || (status !== undefined && status >= 400);
      if (!failed) return undefined;
      let path: string | undefined;
      const url = text(value.url ?? value.requestUrl ?? value.href);
      if (url) {
        try {
          path = new URL(url).pathname;
        } catch {
          path = url.split(/[?#]/u)[0];
        }
      }
      return {
        method: text(value.method ?? value.httpMethod)?.toUpperCase(),
        path: path?.replace(/\b\d+\b/gu, "<n>").replace(/[a-f0-9]{8,}/giu, "<id>"),
        status: status === undefined ? undefined : Math.trunc(status),
        error: errorClass(value.error ?? value.failure ?? value.message),
      };
    })
    .filter(Boolean)
    .sort((left, right) => compareUtf8Bytewise(JSON.stringify(left), JSON.stringify(right)));
}

function crashBasis(run: PersistedRun): unknown[] {
  return artifactRecords(run, "crash")
    .map(({ data }) => ({
      type: text(data.type ?? data.name ?? data.kind),
      code: text(data.code ?? data.errorCode ?? data.signal),
      error: errorClass(data.error ?? data.message ?? data.reason),
    }))
    .sort((left, right) => compareUtf8Bytewise(JSON.stringify(left), JSON.stringify(right)));
}

function localizationBasis(run: PersistedRun): unknown[] {
  const findings: Array<RecordValue> = [];
  const visit = (value: unknown, depth = 0): void => {
    if (depth > 7 || findings.length >= 128) return;
    if (Array.isArray(value)) {
      value.forEach((entry) => visit(entry, depth + 1));
      return;
    }
    const input = record(value);
    if (!input) return;
    const code = text(input.code);
    if (code && /^POSSIBLE_(?:LOCALE|UNTRANSLATED|TEXT_CLIPPED)/u.test(code)) {
      findings.push({
        code,
        canonicalKey: text(input.canonicalKey),
        stableKey: text(input.stableKey),
        expected: normalizedMessage(input.expected),
      });
    }
    Object.values(input).forEach((entry) => visit(entry, depth + 1));
  };
  for (const artifact of run.artifacts) visit(artifact.data);
  return findings
    .map((finding) => canonical(finding))
    .sort((left, right) => compareUtf8Bytewise(JSON.stringify(left), JSON.stringify(right)));
}

function visualBasis(run: PersistedRun, checks: CheckFailure[]): unknown {
  const visualArtifacts = run.artifacts
    .filter((artifact) => /visual|screenshot|baseline/u.test(artifact.kind))
    .map((artifact) => {
      const data = record(artifact.data);
      return {
        kind: artifact.kind,
        code: text(data?.code ?? data?.status ?? data?.action),
        error: errorClass(data?.error ?? data?.message),
      };
    });
  return {
    checks: checks.map((check) => ({ id: check.id, category: check.failureCategory })),
    artifacts: visualArtifacts.sort((left, right) =>
      compareUtf8Bytewise(JSON.stringify(left), JSON.stringify(right)),
    ),
  };
}

function primaryFailureKind(
  run: PersistedRun,
  checks: CheckFailure[],
  network: unknown[],
  crash: unknown[],
  localization: unknown[],
): RepeatFailureKind {
  const root =
    `${run.error ?? ""} ${run.errorCode ?? ""} ${run.failureCategory ?? ""}`.toLowerCase();
  if (crash.length || /crash|fatal exception|signal/u.test(root)) return "crash";
  if (network.length || /network|request|http [45]\d\d/u.test(root)) return "network";
  if (localization.length || /locale|localization|translation|translated/u.test(root)) {
    return "localization";
  }
  if (
    run.failureCategory === "visual-assertion" ||
    checks.some((check) => check.failureCategory === "visual-assertion") ||
    /visual|screenshot|pixel/u.test(root)
  ) {
    return "visual";
  }
  return "causal";
}

function checkBasis(checks: CheckFailure[], run: PersistedRun): unknown[] {
  const values = checks.map((check) => ({
    id: check.id,
    status: check.status,
    category: check.failureCategory,
    errorCode: check.errorCode,
    error: errorClass(check.error),
    dependencyTransitionId: check.dependencyTransitionId,
    dependencyReason: errorClass(check.dependencyReason),
  }));
  if (values.length) return values;
  return [
    {
      id: "run",
      status: run.status,
      category: run.failureCategory,
      errorCode: run.errorCode,
      error: errorClass(run.error),
    },
  ];
}

function signatureFor(run: PersistedRun): RepeatFailureSignature | undefined {
  const checks = checkFailures(run);
  const network = networkBasis(run);
  const crash = crashBasis(run);
  const localization = localizationBasis(run);
  const kind = primaryFailureKind(run, checks, network, crash, localization);
  const basis =
    kind === "crash"
      ? { kind, crashes: crash, checks: checkBasis(checks, run) }
      : kind === "network"
        ? { kind, network, checks: checkBasis(checks, run) }
        : kind === "localization"
          ? { kind, localization, checks: checkBasis(checks, run) }
          : kind === "visual"
            ? { kind, visual: visualBasis(run, checks) }
            : { kind, checks: checkBasis(checks, run) };
  const failureCategory =
    run.failureCategory ?? checks.find((check) => check.failureCategory)?.failureCategory;
  const checkIds = checks.map((check) => check.id);
  const key = JSON.stringify(canonical(basis));
  const summary = `${kind} failure${checkIds.length ? ` in ${checkIds.join(", ")}` : ""}`;
  return {
    schemaVersion: 1,
    kind,
    digest: digest(basis),
    key,
    summary,
    ...(failureCategory ? { failureCategory } : {}),
    checkIds,
  };
}

function evidenceRefs(run: PersistedRun): string[] {
  const refs = [`run:${run.id}`];
  run.artifacts.forEach((_artifact, index) => refs.push(`run:${run.id}#artifact:${index}`));
  const frames = run.frames.map((frame) => ({
    path: frame.path,
    ...(frame.caption ? { caption: frame.caption } : {}),
  }));
  /** Dest wait-for only. Leftover Close / Transition executed and opener before ·
   * Tap beside those leftovers cannot fill dest evidence refs. */
  const checkpoint = new Set(destIdentityCheckpointFramePaths(frames, run.artifacts));
  run.frames.forEach((frame, index) => {
    if (checkpoint.size) {
      if (!checkpoint.has(frame.path)) return;
    } else if (isCaptureReviewLeftoverCaption(frame.caption)) {
      return;
    }
    refs.push(`run:${run.id}#frame:${index}`);
  });
  return refs.slice(0, 128);
}

function decision(run: PersistedRun): RepeatFailureDecision | undefined {
  if (!run.review) return undefined;
  return {
    status: run.review.status,
    reason: run.review.reason,
    ...(run.review.decidedAt === undefined ? {} : { decidedAt: run.review.decidedAt }),
  };
}

export function repeatFailureSignature(run: PersistedRun): RepeatFailureSignature | undefined {
  if (
    run.outcome !== "product-failure" &&
    run.outcome !== "harness-failure" &&
    run.outcome !== "uncertain" &&
    run.status !== "error" &&
    run.status !== "cancelled"
  ) {
    return undefined;
  }
  return signatureFor(run);
}

export type RepeatFailureClusterFilters = {
  failureKind?: RepeatFailureKind;
  cohort?: string;
};

/** Group only failed immutable Run evidence. The campaign row supplies the
 * cell tuple and target affinity; no value, locale, timestamp, or run id is
 * included in the signature, so one representative is enough to review a
 * cluster while every member still links to its own evidence and decision. */
export function buildRepeatFailureClusters(
  campaign: CombineCampaign,
  runs: readonly PersistedRun[],
  filters: RepeatFailureClusterFilters = {},
): RepeatFailureClusterReport {
  const byRunId = new Map(runs.map((run) => [run.id, run]));
  const groups = new Map<
    string,
    { signature: RepeatFailureSignature; cohort: string; cases: RepeatFailureClusterCase[] }
  >();
  for (const item of campaign.cases) {
    if (item.status !== "failed" && item.status !== "blocked" && item.status !== "cancelled")
      continue;
    if (!item.runId) continue;
    const run = byRunId.get(item.runId);
    if (!run) continue;
    const signature = repeatFailureSignature(run);
    if (!signature || (filters.failureKind && signature.kind !== filters.failureKind)) continue;
    const cohort = item.targetProfileId;
    if (filters.cohort && cohort !== filters.cohort) continue;
    const member: RepeatFailureClusterCase = {
      cellId: item.cellId,
      runId: item.runId,
      priorRunIds: [...(item.priorRunIds ?? [])],
      values: { ...item.values },
      world: item.world,
      targetProfileId: item.targetProfileId,
      status: item.status,
      signature,
      evidenceRefs: evidenceRefs(run),
      ...(decision(run) ? { decision: decision(run) } : {}),
    };
    const key = `${signature.digest}\u0000${cohort}`;
    const group = groups.get(key);
    if (group) group.cases.push(member);
    else groups.set(key, { signature, cohort, cases: [member] });
  }
  const clusters: RepeatFailureCluster[] = [...groups.values()]
    .map(({ signature, cohort, cases }) => {
      cases.sort((left, right) => compareUtf8Bytewise(left.cellId, right.cellId));
      const representative = cases[0]!;
      return {
        schemaVersion: 1 as const,
        id: `repeat-cluster:${signature.digest}:${cohort}`,
        kind: signature.kind,
        signature,
        cohort,
        representativeCellId: representative.cellId,
        representativeRunId: representative.runId,
        cases,
      };
    })
    .sort((left, right) => compareUtf8Bytewise(left.id, right.id));
  return { schemaVersion: 1, campaignId: campaign.id, clusters };
}

export function repeatFailureClusterCellIds(
  report: RepeatFailureClusterReport,
  clusterIds: readonly string[],
): string[] {
  const requested = new Set(clusterIds);
  const cells = report.clusters
    .filter((cluster) => requested.has(cluster.id))
    .flatMap((cluster) => cluster.cases.map((item) => item.cellId));
  return [...new Set(cells)].sort(compareUtf8Bytewise);
}
