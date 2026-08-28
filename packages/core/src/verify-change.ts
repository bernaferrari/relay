import type {
  AppMap,
  AppMapScenarioTest,
  ApprovalPolicyFinding,
  ExecutionExternalEffect,
  ExecutionRisk,
  ExecutionRiskLevel,
  SourceRevision,
  TracePack,
  VerifyChangeResult,
} from "@relay/protocol";
import { evaluateApprovalPolicy } from "./approval-policy.js";
import { compileExecutionRisk } from "./execution-risk-compiler.js";
import { replayPersistedRunOffline } from "./offline-run-replay.js";
import { analyzeTracePack, frozenRunFromTracePack, verifyTracePack } from "./trace-pack.js";

export const VERIFY_CHANGE_POLICY = { id: "relay.verify-change", version: 1 } as const;

export type FrozenVerifyChangeTest = {
  appMap: AppMap;
  test: AppMapScenarioTest;
};

export type OfflineVerifyChangeInput = {
  selectionKind: "tests" | "runs" | "trace-packs" | "source-revision";
  tests?: readonly FrozenVerifyChangeTest[];
  tracePacks?: readonly TracePack[];
  sourceRevision?: SourceRevision;
  confirmationSatisfied?: boolean;
  selectionUncertainty?: readonly string[];
};

function verifiedCompleteness(pack: TracePack): "complete" | "partial" {
  return pack.completeness.status === "complete" && pack.completeness.artifacts !== undefined
    ? "complete"
    : "partial";
}

const RISK_RANK: Record<ExecutionRiskLevel, number> = {
  safe: 0,
  guarded: 1,
  destructive: 2,
  prohibited: 3,
};
const CONFIRMATION_RANK: Record<ExecutionRisk["confirmation"], number> = {
  none: 0,
  "once-per-run": 1,
  "per-step": 2,
  "human-only": 3,
};

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function aggregateRisk(risks: readonly ExecutionRisk[]): ExecutionRisk {
  if (!risks.length) {
    return compileExecutionRisk({ kind: "recipe-graph", rootRecipeId: "missing", recipes: {} });
  }
  const level = risks.reduce((worst, risk) =>
    RISK_RANK[risk.level] > RISK_RANK[worst.level] ? risk : worst,
  ).level;
  const confirmation = risks.reduce<ExecutionRisk["confirmation"]>(
    (worst, risk) =>
      CONFIRMATION_RANK[risk.confirmation] > CONFIRMATION_RANK[worst] ? risk.confirmation : worst,
    "none",
  );
  const sum = (values: readonly (number | undefined)[]): number | undefined => {
    if (values.some((value) => value === undefined)) return undefined;
    const total = values.reduce<number>((value, item) => value + item!, 0);
    return Number.isSafeInteger(total) ? total : undefined;
  };
  const maximumActions = sum(risks.map((risk) => risk.maximumActions));
  const maximumDurationMs = sum(risks.map((risk) => risk.maximumDurationMs));
  const effects = uniqueSorted(
    risks.flatMap((risk) => risk.externalEffects),
  ) as ExecutionExternalEffect[];
  return {
    schemaVersion: 1,
    level,
    reasons: risks
      .flatMap((risk) => risk.reasons)
      .filter(
        (reason, index, all) =>
          all.findIndex(
            (candidate) => candidate.code === reason.code && candidate.stepId === reason.stepId,
          ) === index,
      )
      .sort(
        (left, right) =>
          left.code.localeCompare(right.code) ||
          (left.stepId ?? "").localeCompare(right.stepId ?? ""),
      ),
    externalEffects: effects,
    confirmation,
    expectedAppBoundaries: uniqueSorted(risks.flatMap((risk) => risk.expectedAppBoundaries)),
    ...(maximumActions === undefined ? {} : { maximumActions }),
    ...(maximumDurationMs === undefined ? {} : { maximumDurationMs }),
    cleanupRequired: risks.some((risk) => risk.cleanupRequired),
  };
}

/** Deterministically evaluate already-frozen Tests and TracePacks. This is a
 * read-only proof calculation: it cannot run targets, edit authored state, or
 * publish a provider status. */
export function verifyChangeOffline(input: OfflineVerifyChangeInput): VerifyChangeResult {
  const explicitTests = [...(input.tests ?? [])];
  const packs = (input.tracePacks ?? []).map((value) => verifyTracePack(value));
  const packRecords = packs.map((pack) => {
    const run = frozenRunFromTracePack(pack);
    const analysis = analyzeTracePack(pack);
    const replay = replayPersistedRunOffline(run);
    const root = run.recipeSnapshot;
    const recipes = { ...run.recipeGraph, ...(root ? { [root.id]: root } : {}) };
    const risk = compileExecutionRisk({
      kind: "recipe-graph",
      rootRecipeId: root?.id ?? "missing",
      recipes,
    });
    return { pack, run, analysis, replay, risk };
  });
  const testRisks = explicitTests.map(({ appMap, test }) => ({
    appMapId: appMap.id,
    testId: test.id,
    risk: compileExecutionRisk({ kind: "scenario-test", appMap, test }),
  }));
  const packRisks = packRecords.flatMap(({ replay, risk }) =>
    replay.testId ? [{ appMapId: replay.appMapId, testId: replay.testId, risk }] : [],
  );
  const affected = [...testRisks, ...packRisks]
    .filter(
      (item, index, all) =>
        all.findIndex(
          (candidate) => candidate.testId === item.testId && candidate.appMapId === item.appMapId,
        ) === index,
    )
    .sort(
      (left, right) =>
        (left.appMapId ?? "").localeCompare(right.appMapId ?? "") ||
        left.testId.localeCompare(right.testId),
    );
  const uncertainty = [
    ...(input.selectionUncertainty ?? []),
    ...packRecords.flatMap(({ pack, replay, analysis }) => [
      ...(!replay.testId ? [`affected-test-selection-unavailable:${pack.source.runId}`] : []),
      ...analysis.unknown
        .filter(({ code }) => code !== "FUTURE_TARGET_STATE" && code !== "MISSING_EVIDENCE")
        .map(({ code }) => `${pack.source.runId}:${code.toLowerCase()}`),
    ]),
    ...(!affected.length ? ["affected-test-selection-unavailable"] : []),
  ];
  const evidenceMissing = [
    ...packs.flatMap((pack) => pack.completeness.missing),
    ...packs.flatMap((pack) =>
      pack.completeness.artifacts === undefined
        ? [`trace-pack-artifact-closure:${pack.source.runId}`]
        : [],
    ),
    ...affected.flatMap(({ appMapId, testId }) => {
      const covered = packRecords.some(
        ({ replay }) => replay.testId === testId && replay.appMapId === appMapId,
      );
      return covered ? [] : [`trace-pack:${appMapId ?? "unknown"}:${testId}`];
    }),
    ...(!packs.length ? ["trace-pack"] : []),
  ];
  const anyFailed = packRecords.some(({ analysis }) => analysis.historicalVerdict === "failed");
  const everyAffectedProved =
    affected.length > 0 &&
    affected.every(({ appMapId, testId }) => {
      const matching = packRecords.filter(
        ({ replay }) => replay.testId === testId && replay.appMapId === appMapId,
      );
      return (
        matching.length > 0 &&
        matching.every(({ analysis }) => analysis.historicalVerdict === "proved")
      );
    });
  const matcherStatuses = packRecords.flatMap(({ analysis }) => analysis.recomputed ?? []);
  const selectorResolution = matcherStatuses.some(
    ({ status }) => status === "changed" || status === "blocked",
  )
    ? "ambiguous"
    : everyAffectedProved && matcherStatuses.every(({ status }) => status === "supports-recorded")
      ? "deterministic"
      : "unproven";
  const findings: ApprovalPolicyFinding[] = packRecords.flatMap(({ pack, analysis }) =>
    (analysis.recomputed ?? [])
      .filter(({ status }) => status === "changed" || status === "blocked")
      .map((matcher) => ({
        id: `${pack.source.runId}:${matcher.checkId}:selector`,
        category: "selector" as const,
        severity: "review" as const,
        summary: matcher.statement,
        evidenceRefs: matcher.evidence,
      })),
  );
  const policy = evaluateApprovalPolicy({
    schemaVersion: 1,
    policy: VERIFY_CHANGE_POLICY,
    executionRisk: aggregateRisk(affected.map(({ risk }) => risk)),
    confirmationSatisfied: input.confirmationSatisfied === true,
    evidence: {
      status:
        packs.length > 0 && packs.every((pack) => verifiedCompleteness(pack) === "complete")
          ? "complete"
          : "partial",
      requiredChannels: ["frozen-run", "trace-pack"],
      missing: uniqueSorted(evidenceMissing),
      tracePackDigests: packs.map((pack) => pack.digest).sort(),
    },
    verification: {
      requiredPaths: anyFailed ? "failed" : everyAffectedProved ? "passed" : "unproven",
      selectorResolution,
      unresolved: uniqueSorted(uncertainty),
    },
    findings,
  });
  const causal = packRecords
    .flatMap(({ pack, replay }) =>
      replay.firstRootFailure
        ? [
            {
              writtenAt: pack.source.writtenAt,
              runId: pack.source.runId,
              testId: replay.testId,
              ...replay.firstRootFailure,
            },
          ]
        : [],
    )
    .sort(
      (left, right) => left.writtenAt - right.writtenAt || left.runId.localeCompare(right.runId),
    )[0];
  const evidence = packRecords
    .map(({ pack, analysis, replay }) => ({
      runId: pack.source.runId,
      tracePackDigest: pack.digest,
      status: verifiedCompleteness(pack),
      historicalVerdict: analysis.historicalVerdict,
      ...(replay.appMapId ? { appMapId: replay.appMapId } : {}),
      ...(replay.testId ? { testId: replay.testId } : {}),
    }))
    .sort((left, right) => left.runId.localeCompare(right.runId));
  return {
    schemaVersion: 1,
    kind: "verify-change",
    mode: "offline",
    selection: {
      kind: input.selectionKind,
      ...(input.sourceRevision ? { sourceRevision: structuredClone(input.sourceRevision) } : {}),
    },
    affectedTests: affected.map(({ risk, ...identity }) => ({ ...identity, executionRisk: risk })),
    evidence,
    ...(causal
      ? {
          firstCausalFailure: {
            runId: causal.runId,
            ...(causal.testId ? { testId: causal.testId } : {}),
            checkId: causal.checkId,
            title: causal.title,
            kind: causal.kind,
            ...(causal.error ? { error: causal.error } : {}),
            evidence: causal.evidence,
          },
        }
      : {}),
    policy: policy.policy,
    decision: policy.decision,
    execution: policy.execution,
    ruleIds: policy.ruleIds,
    reasons: policy.reasons,
    evidenceRefs: policy.evidenceRefs,
    unresolvedUncertainty: policy.unresolvedVerification,
    mutation: "none",
    checkPosting: "none",
  };
}
