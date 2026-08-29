import type {
  AppMap,
  AppMapScenarioTest,
  ApprovalPolicyFinding,
  ExecutionExternalEffect,
  ExecutionRisk,
  ExecutionRiskLevel,
  SourceRevision,
  TracePack,
  VerifyChangeAffectedTest,
  VerifyChangeLiveVerification,
  VerifyChangeResult,
  VerifyChangeVerdict,
} from "@relay/protocol";
import { VERIFY_CHANGE_MAX_REPORT_ITEMS } from "@relay/protocol";
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

function boundedUniqueSorted(values: readonly string[], label: string): string[] {
  const unique = uniqueSorted(values);
  if (unique.length <= VERIFY_CHANGE_MAX_REPORT_ITEMS) return unique;
  return [
    ...unique.slice(0, VERIFY_CHANGE_MAX_REPORT_ITEMS - 1),
    `report-items-truncated:${label}:${unique.length - VERIFY_CHANGE_MAX_REPORT_ITEMS + 1}`,
  ];
}

function revisionMatches(candidate: SourceRevision | undefined, expected: SourceRevision): boolean {
  return (
    candidate?.vcs === expected.vcs &&
    candidate.sha === expected.sha &&
    (expected.prNumber === undefined || candidate.prNumber === expected.prNumber) &&
    (expected.branch === undefined || candidate.branch === expected.branch) &&
    (expected.artifactDigest === undefined || candidate.artifactDigest === expected.artifactDigest)
  );
}

function aggregateRisk(
  risks: readonly ExecutionRisk[],
  relationship: "sequential" | "alternatives" = "sequential",
): ExecutionRisk {
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
    const total =
      relationship === "alternatives"
        ? Math.max(...(values as number[]))
        : values.reduce<number>((value, item) => value + item!, 0);
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
  const allPackRecords = packs.map((pack) => {
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
  const provenanceUncertainty = input.sourceRevision
    ? allPackRecords.flatMap(({ pack, run }) =>
        revisionMatches(run.sourceRevision, input.sourceRevision!)
          ? []
          : [`source-revision-provenance-unproved:${pack.source.runId}`],
      )
    : [];
  const packRecords = input.sourceRevision
    ? allPackRecords.filter(({ run }) => revisionMatches(run.sourceRevision, input.sourceRevision!))
    : allPackRecords;
  const selectedPacks = packRecords.map(({ pack }) => pack);
  const testRisks = explicitTests.map(({ appMap, test }) => ({
    appMapId: appMap.id,
    testId: test.id,
    risk: compileExecutionRisk({ kind: "scenario-test", appMap, test }),
  }));
  const packRisks = packRecords.flatMap(({ replay, risk }) =>
    replay.testId ? [{ appMapId: replay.appMapId, testId: replay.testId, risk }] : [],
  );
  const affectedByTest = new Map<
    string,
    { appMapId?: string; testId: string; risks: ExecutionRisk[] }
  >();
  for (const item of [...testRisks, ...packRisks]) {
    const key = JSON.stringify([item.appMapId ?? null, item.testId]);
    const existing = affectedByTest.get(key);
    if (existing) existing.risks.push(item.risk);
    else {
      affectedByTest.set(key, {
        ...(item.appMapId ? { appMapId: item.appMapId } : {}),
        testId: item.testId,
        risks: [item.risk],
      });
    }
  }
  const affected = [...affectedByTest.values()]
    .map(({ risks, ...identity }) => ({ ...identity, risk: aggregateRisk(risks, "alternatives") }))
    .sort(
      (left, right) =>
        (left.appMapId ?? "").localeCompare(right.appMapId ?? "") ||
        left.testId.localeCompare(right.testId),
    );
  const uncertainty = [
    ...(input.selectionUncertainty ?? []),
    ...provenanceUncertainty,
    ...packRecords.flatMap(({ pack, replay, analysis }) => [
      ...(!replay.testId ? [`affected-test-selection-unavailable:${pack.source.runId}`] : []),
      ...analysis.unknown
        .filter(({ code }) => code !== "FUTURE_TARGET_STATE" && code !== "MISSING_EVIDENCE")
        .map(({ code }) => `${pack.source.runId}:${code.toLowerCase()}`),
    ]),
    ...(!affected.length ? ["affected-test-selection-unavailable"] : []),
  ];
  const evidenceMissing = [
    ...selectedPacks.flatMap((pack) => pack.completeness.missing),
    ...selectedPacks.flatMap((pack) =>
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
    ...(!selectedPacks.length ? ["trace-pack"] : []),
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
        runId: pack.source.runId,
        category: "selector" as const,
        severity: "review" as const,
        summary: matcher.statement,
        evidenceRefs: [...new Set([pack.digest, ...matcher.evidence])],
      })),
  );
  const currentEvidenceRefs = [
    ...new Set(
      selectedPacks
        .flatMap((pack) => [pack.digest, ...pack.objects.map((object) => object.digest)])
        .concat(findings.flatMap((finding) => finding.evidenceRefs)),
    ),
  ];
  const policy = evaluateApprovalPolicy({
    schemaVersion: 1,
    policy: VERIFY_CHANGE_POLICY,
    executionRisk: aggregateRisk(affected.map(({ risk }) => risk)),
    confirmationSatisfied: input.confirmationSatisfied === true,
    evidence: {
      status:
        selectedPacks.length > 0 &&
        selectedPacks.every((pack) => verifiedCompleteness(pack) === "complete")
          ? "complete"
          : "partial",
      requiredChannels: ["frozen-run", "trace-pack"],
      missing: boundedUniqueSorted(evidenceMissing, "evidence-missing"),
      tracePackDigests: selectedPacks.map((pack) => pack.digest).sort(),
      runIds: selectedPacks.map((pack) => pack.source.runId).sort(),
      evidenceRefs: currentEvidenceRefs,
    },
    verification: {
      requiredPaths: anyFailed ? "failed" : everyAffectedProved ? "passed" : "unproven",
      selectorResolution,
      unresolved: boundedUniqueSorted(uncertainty, "selection-uncertainty"),
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
  const affectedTests: VerifyChangeAffectedTest[] = affected.map(({ appMapId, testId, risk }) => {
    const matching = packRecords.filter(
      ({ replay }) => replay.testId === testId && replay.appMapId === appMapId,
    );
    const matcherNeedsReview = matching.some(({ analysis }) =>
      (analysis.recomputed ?? []).some(
        ({ status }) => status === "changed" || status === "blocked",
      ),
    );
    let verdict: VerifyChangeVerdict;
    if (
      risk.level === "prohibited" ||
      matching.some(({ analysis }) => analysis.historicalVerdict === "failed")
    ) {
      verdict = "regressions";
    } else if (risk.confirmation !== "none" && input.confirmationSatisfied !== true) {
      verdict = "review";
    } else if (matcherNeedsReview) {
      verdict = "review";
    } else if (
      matching.length === 0 ||
      matching.some(
        ({ pack, analysis }) =>
          verifiedCompleteness(pack) !== "complete" || analysis.historicalVerdict !== "proved",
      )
    ) {
      verdict = "insufficient";
    } else {
      verdict = "passed";
    }
    return {
      ...(appMapId ? { appMapId } : {}),
      testId,
      executionRisk: risk,
      verdict,
      evidenceRunIds: matching.map(({ pack }) => pack.source.runId).sort(),
    };
  });
  const counts = {
    passed: affectedTests.filter(({ verdict }) => verdict === "passed").length,
    regressions: affectedTests.filter(({ verdict }) => verdict === "regressions").length,
    review: affectedTests.filter(({ verdict }) => verdict === "review").length,
    insufficient: affectedTests.filter(({ verdict }) => verdict === "insufficient").length,
  };
  const verdict: VerifyChangeVerdict = !affectedTests.length
    ? "insufficient"
    : counts.regressions > 0 || policy.decision === "reject"
      ? "regressions"
      : counts.review > 0 || policy.decision === "ask-human"
        ? "review"
        : counts.insufficient > 0 || policy.decision === "insufficient-evidence"
          ? "insufficient"
          : "passed";
  const completeEvidence = evidence.filter(({ status }) => status === "complete").length;
  const partialEvidence = evidence.length - completeEvidence;
  const boundedMissing = boundedUniqueSorted(evidenceMissing, "evidence-missing");
  const firstAffected = affectedTests[0];
  const needsSelectorPreview = policy.ruleIds.includes("verification.selector-ambiguous");
  let liveVerification: VerifyChangeLiveVerification;
  if (verdict === "passed" || verdict === "regressions") {
    liveVerification = {
      required: false,
      action: "none",
      reason:
        verdict === "passed"
          ? "Frozen evidence proves the selected change under deterministic policy."
          : "Frozen evidence or policy already proves a regression; live execution is not required to classify it.",
      evidenceNeeded: [],
    };
  } else if (!firstAffected) {
    liveVerification = {
      required: true,
      action: "select-and-run-one-test",
      reason: "No affected Test is proven by the frozen selection.",
      evidenceNeeded: boundedMissing,
    };
  } else if (needsSelectorPreview) {
    liveVerification = {
      required: true,
      action: "capture-and-preview-selector",
      reason:
        "One current snapshot and preview can resolve the first ambiguous selector without mutation.",
      ...(firstAffected.appMapId ? { appMapId: firstAffected.appMapId } : {}),
      testId: firstAffected.testId,
      evidenceNeeded: boundedMissing,
    };
  } else if (policy.execution === "confirmation-required") {
    liveVerification = {
      required: true,
      action: "review-and-confirm",
      reason:
        "The frozen Test declares reviewed external effects that require explicit confirmation.",
      ...(firstAffected.appMapId ? { appMapId: firstAffected.appMapId } : {}),
      testId: firstAffected.testId,
      evidenceNeeded: boundedMissing,
    };
  } else {
    liveVerification = {
      required: true,
      action: "run-one-affected-test",
      reason: "One affected Test needs complete fresh evidence before policy can decide.",
      ...(firstAffected.appMapId ? { appMapId: firstAffected.appMapId } : {}),
      testId: firstAffected.testId,
      evidenceNeeded: boundedMissing,
    };
  }
  return {
    schemaVersion: 1,
    kind: "verify-change",
    mode: "offline",
    selection: {
      kind: input.selectionKind,
      ...(input.sourceRevision ? { sourceRevision: structuredClone(input.sourceRevision) } : {}),
    },
    summary: { verdict, affectedTests: affectedTests.length, ...counts },
    affectedTests,
    evidence,
    evidenceCompleteness: {
      status:
        evidence.length > 0 && partialEvidence === 0 && boundedMissing.length === 0
          ? "complete"
          : "partial",
      complete: completeEvidence,
      partial: partialEvidence,
      missing: boundedMissing,
    },
    ...(causal
      ? {
          firstCausalFailure: {
            runId: causal.runId,
            ...(causal.testId ? { testId: causal.testId } : {}),
            checkId: causal.checkId,
            title: causal.title,
            kind: causal.kind,
            ...(causal.error ? { error: causal.error } : {}),
            evidence: boundedUniqueSorted(causal.evidence, "causal-evidence"),
          },
        }
      : {}),
    policy: policy.policy,
    confidence: policy.confidence ?? { value: 1, basis: "deterministic-policy" },
    decision: policy.decision,
    execution: policy.execution,
    ruleIds: boundedUniqueSorted(policy.ruleIds, "policy-rules"),
    reasons: boundedUniqueSorted(policy.reasons, "policy-reasons"),
    evidenceRefs: boundedUniqueSorted(policy.evidenceRefs, "policy-evidence"),
    unresolvedUncertainty: boundedUniqueSorted(
      policy.unresolvedVerification,
      "unresolved-uncertainty",
    ),
    smallestRequiredLiveVerification: liveVerification,
    mutation: "none",
    checkPosting: "none",
  };
}
