import {
  tracePackComparisonSchema,
  type TracePack,
  type TracePackComparison,
  type TracePackOfflineAnalysis,
} from "@relay/protocol";
import {
  replayPersistedRunOffline,
  type OfflineReplayCheck,
  type OfflineRunReplayReport,
} from "./offline-run-replay.js";
import type { PersistedRun } from "./runs.js";
import { analyzeTracePack, verifyTracePack } from "./trace-pack.js";

type UnknownRecord = Record<string, unknown>;
type ComparisonFact = TracePackComparison["testIdentity"]["fact"];
type RequiredPathComparison = TracePackComparison["requiredPaths"][number];
type MatcherDelta = TracePackComparison["matcherDeltas"][number];

type PackProjection = {
  pack: TracePack;
  analysis: TracePackOfflineAnalysis;
  replay: OfflineRunReplayReport;
  runObjectDigest: string;
  testName?: string;
};

function record(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function projection(value: unknown): PackProjection {
  const pack = verifyTracePack(value);
  const analysis = analyzeTracePack(pack);
  const runObjects = pack.objects.filter((object) => object.kind === "frozen-run");
  if (runObjects.length !== 1) throw new Error("TracePack must contain exactly one frozen run");
  const runObject = runObjects[0]!;
  const rawRun = record(runObject.content);
  if (
    !rawRun ||
    rawRun.id !== pack.source.runId ||
    rawRun.inputDigest !== pack.source.inputDigest
  ) {
    throw new Error("TracePack source identity does not match its frozen run");
  }
  const run = { ...structuredClone(rawRun), dir: "" } as PersistedRun;
  const replay = replayPersistedRunOffline(run);
  const planArtifact = run.artifacts.find(
    (artifact) => artifact.kind === "app-map-test-plan" || artifact.kind === "app-map-flow-plan",
  );
  const plan = record(planArtifact?.data);
  return {
    pack,
    analysis,
    replay,
    runObjectDigest: runObject.digest,
    ...(text(record(plan?.test)?.name) ? { testName: text(record(plan?.test)?.name) } : {}),
  };
}

function fact(
  classification: ComparisonFact["classification"],
  statement: string,
  evidence: readonly string[],
): ComparisonFact {
  return { classification, statement, evidence: [...new Set(evidence)].sort() };
}

function historicalState(check: OfflineReplayCheck | undefined) {
  if (!check) return "absent" as const;
  if (check.replayStatus === "proved") return "proved" as const;
  if (check.replayStatus === "root-failure" || check.replayStatus === "independent-failure") {
    return "failed" as const;
  }
  return "unproved" as const;
}

function compareTestIdentity(projections: readonly PackProjection[]) {
  const entries: TracePackComparison["testIdentity"]["entries"] = projections.map(
    ({ pack, replay, testName }) => ({
      tracePackDigest: pack.digest,
      planDigest: replay.planDigest,
      ...(replay.appMapId ? { appMapId: replay.appMapId } : {}),
      ...(replay.appMapRevision !== undefined ? { appMapRevision: replay.appMapRevision } : {}),
      ...(replay.testId ? { testId: replay.testId } : {}),
      ...(testName ? { testName } : {}),
    }),
  );
  const identities = entries.map((entry) =>
    entry.appMapId && entry.testId ? `${entry.appMapId}\u0000${entry.testId}` : undefined,
  );
  const evidence = projections.map((item) => item.runObjectDigest);
  if (identities.some((identity) => identity === undefined)) {
    return {
      status: "unavailable" as const,
      fact: fact(
        "unknowable",
        "At least one frozen plan lacks a canonical App Map and Test identity, so identity continuity is unknowable.",
        evidence,
      ),
      entries,
    };
  }
  if (new Set(identities).size === 1) {
    return {
      status: "common" as const,
      fact: fact(
        "recomputable",
        "Every frozen plan names the same canonical App Map and Test identity.",
        evidence,
      ),
      entries,
    };
  }
  return {
    status: "changed" as const,
    fact: fact(
      "recomputable",
      "The ordered TracePacks name different canonical App Map or Test identities.",
      evidence,
    ),
    entries,
  };
}

function compareRequiredPaths(projections: readonly PackProjection[]): RequiredPathComparison[] {
  const checkIds = [
    ...new Set(projections.flatMap(({ replay }) => replay.checks.map((check) => check.id))),
  ].sort();
  const evidence = projections.map(({ pack }) => pack.digest);
  return checkIds.map((checkId) => {
    const checks = projections.map(({ replay }) =>
      replay.checks.find((check) => check.id === checkId),
    );
    const title = [...checks].reverse().find(Boolean)?.title ?? checkId;
    const observations: RequiredPathComparison["observations"] = projections.map(
      ({ pack }, index) => {
        const check = checks[index];
        const originScreenId = check?.warmSourceScreenId;
        const destinationScreenId = check?.expectedDestinationScreenId;
        return {
          tracePackDigest: pack.digest,
          historicalState: historicalState(check),
          ...(originScreenId && destinationScreenId
            ? { path: { originScreenId, destinationScreenId } }
            : {}),
        };
      },
    );
    const paths = observations.map((observation) => observation.path);
    const path = paths.some((item) => !item)
      ? {
          status: "not-provable" as const,
          fact: fact(
            "unknowable",
            `${title} lacks a complete frozen origin-to-destination path in at least one pack; absence is not proof that the Test removed it.`,
            evidence,
          ),
        }
      : new Set(paths.map((item) => `${item!.originScreenId}\u0000${item!.destinationScreenId}`))
            .size === 1
        ? {
            status: "unchanged" as const,
            fact: fact(
              "recomputable",
              `${title} has the same required origin-to-destination path in every frozen run.`,
              evidence,
            ),
          }
        : {
            status: "changed" as const,
            fact: fact(
              "recomputable",
              `${title} has different required origin-to-destination paths across the frozen runs.`,
              evidence,
            ),
          };
    const first = observations[0]!.historicalState;
    const latest = observations.at(-1)!.historicalState;
    const definitive = (state: typeof first): state is "proved" | "failed" =>
      state === "proved" || state === "failed";
    const allStates = observations.map((observation) => observation.historicalState);
    const reachability = allStates.some((state) => !definitive(state))
      ? {
          status: "not-provable" as const,
          fact: fact(
            "unknowable",
            `${title} has no independently proved historical reachability result at one or both comparison endpoints.`,
            evidence,
          ),
        }
      : allStates.every((state) => state === "proved")
        ? {
            status: "unchanged-proved" as const,
            fact: fact(
              "historically-proved",
              `${title} was backed by verified transition proof at both comparison endpoints.`,
              evidence,
            ),
          }
        : allStates.every((state) => state === "failed")
          ? {
              status: "unchanged-failed" as const,
              fact: fact(
                "historically-failed",
                `${title} was a causal historical failure at both comparison endpoints.`,
                evidence,
              ),
            }
          : first === latest
            ? {
                status: "changed" as const,
                fact: fact(
                  "recomputable",
                  `${title} changed within the ordered history even though its endpoint states agree.`,
                  evidence,
                ),
              }
            : latest === "failed"
              ? {
                  status: "regressed" as const,
                  fact: fact(
                    "historically-failed",
                    `${title} changed from historically proved to a causal historical failure.`,
                    evidence,
                  ),
                }
              : {
                  status: "improved" as const,
                  fact: fact(
                    "historically-proved",
                    `${title} changed from a causal historical failure to verified historical proof.`,
                    evidence,
                  ),
                };
    return { checkId, title, observations, path, reachability };
  });
}

function compareMatchers(projections: readonly PackProjection[]): MatcherDelta[] {
  const checkIds = [
    ...new Set(
      projections.flatMap(({ analysis }) =>
        (analysis.recomputed ?? []).map((matcher) => matcher.checkId),
      ),
    ),
  ].sort();
  return checkIds.map((checkId) => {
    const observations: MatcherDelta["observations"] = projections.flatMap(({ pack, analysis }) => {
      const matcher = (analysis.recomputed ?? []).find((item) => item.checkId === checkId);
      return matcher
        ? [
            {
              tracePackDigest: pack.digest,
              status: matcher.status,
              robustness: matcher.robustness,
              evidence: matcher.evidence,
            },
          ]
        : [];
    });
    const comparable = observations.length === projections.length;
    const signatures = observations.map(
      (item) => `${item.status}\u0000${item.robustness.toFixed(12)}`,
    );
    const status = !comparable
      ? ("not-comparable" as const)
      : new Set(signatures).size === 1
        ? ("unchanged" as const)
        : ("changed" as const);
    return {
      algorithm: "semantic-activation-v1" as const,
      checkId,
      status,
      fact:
        status === "not-comparable"
          ? fact(
              "unknowable",
              `The semantic matcher result for ${checkId} is absent from at least one pack and cannot be compared.`,
              projections.map(({ pack }) => pack.digest),
            )
          : fact(
              "recomputable",
              status === "unchanged"
                ? `The semantic-activation-v1 status and robustness for ${checkId} are unchanged across frozen evidence.`
                : `The semantic-activation-v1 status or robustness for ${checkId} changed across frozen evidence.`,
              observations.flatMap((item) => item.evidence),
            ),
      observations,
      requiresLiveVerification: true as const,
    };
  });
}

function smallestLiveVerification(
  projections: readonly PackProjection[],
  requiredPaths: readonly RequiredPathComparison[],
  matcherDeltas: readonly MatcherDelta[],
): TracePackComparison["smallestLiveVerification"] {
  const latest = projections.at(-1)!;
  const missingPlan = [...projections]
    .reverse()
    .find(({ analysis }) => analysis.smallestLiveVerification.kind === "recapture-frozen-plan");
  if (missingPlan) {
    return {
      classification: "live-verification-required",
      kind: "recapture-frozen-plan",
      tracePackDigest: missingPlan.pack.digest,
      reason: "A comparison endpoint has no frozen execution plan; recapture that plan first.",
      requiresTarget: true,
    };
  }
  if (latest.analysis.smallestLiveVerification.kind === "replay-check") {
    return {
      classification: "live-verification-required",
      kind: "replay-check",
      tracePackDigest: latest.pack.digest,
      ...(latest.analysis.smallestLiveVerification.checkId
        ? { checkId: latest.analysis.smallestLiveVerification.checkId }
        : {}),
      reason: latest.analysis.smallestLiveVerification.reason,
      requiresTarget: true,
    };
  }
  if (latest.pack.completeness.missing.length) {
    return {
      classification: "live-verification-required",
      kind: "recapture-required-evidence",
      tracePackDigest: latest.pack.digest,
      reason:
        "Recapture the latest frozen plan with its required missing evidence before comparing behavior.",
      requiresTarget: true,
    };
  }
  const changedCheck =
    requiredPaths.find(
      (item) => item.reachability.status === "regressed" || item.reachability.status === "changed",
    )?.checkId ?? matcherDeltas.find((item) => item.status === "changed")?.checkId;
  if (changedCheck) {
    return {
      classification: "live-verification-required",
      kind: "replay-check",
      tracePackDigest: latest.pack.digest,
      checkId: changedCheck,
      reason: `Replay ${changedCheck} on the latest controlled target to distinguish historical evidence change from current behavior.`,
      requiresTarget: true,
    };
  }
  return {
    classification: "live-verification-required",
    kind: "replay-frozen-test",
    tracePackDigest: latest.pack.digest,
    reason:
      "The frozen comparison is exhausted; replay the latest frozen Test to establish current behavior.",
    requiresTarget: true,
  };
}

/**
 * Compare an oldest-to-newest TracePack history using only content-addressed
 * frozen evidence. The module never reads a workspace, opens a target, or
 * applies a repair, and therefore can never claim a future transition passed.
 */
export function compareTracePacks(values: readonly unknown[]): TracePackComparison {
  if (values.length < 2 || values.length > 64) {
    throw new Error("TracePack comparison requires between 2 and 64 ordered packs");
  }
  const projections = values.map(projection);
  if (new Set(projections.map(({ pack }) => pack.digest)).size !== projections.length) {
    throw new Error("TracePack comparison requires unique content-addressed packs");
  }
  const requiredPaths = compareRequiredPaths(projections);
  const matcherDeltas = compareMatchers(projections);
  return tracePackComparisonSchema.parse({
    schemaVersion: 1,
    mode: "trace-pack-offline-comparison",
    orderedTracePacks: projections.map(({ pack, analysis }, ordinal) => ({
      ordinal,
      tracePackDigest: pack.digest,
      sourceRunId: pack.source.runId,
      historicalVerdict: analysis.historicalVerdict,
      classification:
        analysis.historicalVerdict === "proved"
          ? "historically-proved"
          : analysis.historicalVerdict === "failed"
            ? "historically-failed"
            : "unknowable",
      completeness: pack.completeness.status,
    })),
    testIdentity: compareTestIdentity(projections),
    requiredPaths,
    matcherDeltas,
    completenessGaps: projections.flatMap(({ pack }) =>
      pack.completeness.missing.length
        ? [
            {
              tracePackDigest: pack.digest,
              missing: pack.completeness.missing,
              fact: fact(
                "unknowable",
                `${pack.completeness.missing.length} required evidence item(s) are absent from this pack.`,
                [pack.digest],
              ),
            },
          ]
        : [],
    ),
    futureTransitionVerdict: "unknown",
    smallestLiveVerification: smallestLiveVerification(projections, requiredPaths, matcherDeltas),
    repairPolicy: { mutation: "none", requiresReview: true },
  });
}
