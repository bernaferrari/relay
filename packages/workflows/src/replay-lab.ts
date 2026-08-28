import { compareTracePacks } from "@relay/core/trace-pack-comparison";
import { recomputeTracePackVisualLocalization } from "@relay/core/trace-pack-visual-localization";
import {
  replayLabAnalysisSchema,
  replayLabReportSchema,
  measureTracePackJson,
  TRACE_PACK_OFFLINE_TRANSPORT_LIMITS,
  type ReplayLabReport,
} from "@relay/protocol";
import type { ReplayLabOutcomeIntent } from "./types.js";

const maxHypotheses = 32;
const maxTracePacks = 64;
const maxObjectsPerPack = 2_000;
const maxTotalBytes = 128 * 1024 * 1024;

function assertBoundedTracePacks(tracePacks: ReplayLabOutcomeIntent["tracePacks"]): void {
  if (tracePacks.length < 2 || tracePacks.length > maxTracePacks) {
    throw new TypeError(`Replay Lab requires between 2 and ${maxTracePacks} TracePacks.`);
  }
  let totalBytes = 0;
  for (const pack of tracePacks) {
    if (pack.objects.length > maxObjectsPerPack) {
      throw new TypeError(`Replay Lab TracePack exceeds ${maxObjectsPerPack} objects.`);
    }
    totalBytes += measureTracePackJson(pack, TRACE_PACK_OFFLINE_TRANSPORT_LIMITS).serializedBytes;
    if (totalBytes > maxTotalBytes) {
      throw new TypeError("Replay Lab TracePacks exceed 128 MiB in aggregate.");
    }
  }
}

type RankedHypothesis = Omit<ReplayLabReport["hypotheses"][number], "rank">;

function hypotheses(input: {
  comparison?: ReplayLabReport["comparison"];
  visualLocalization?: ReplayLabReport["visualLocalization"];
}): ReplayLabReport["hypotheses"] {
  const candidates: RankedHypothesis[] = [];
  const add = (candidate: RankedHypothesis): void => {
    if (candidates.length < maxHypotheses * 5) candidates.push(candidate);
  };
  for (const gap of input.comparison?.completenessGaps ?? []) {
    add({
      priority: 100,
      kind: "evidence-gap",
      classification: "unknowable",
      statement: `Missing evidence in ${gap.tracePackDigest} may explain an apparent historical change.`,
      evidence: [gap.tracePackDigest],
      requiresLiveVerification: true,
    });
  }
  const visual = input.visualLocalization;
  if (visual?.sufficiency.visual === "insufficient") {
    add({
      priority: 98,
      kind: "evidence-gap",
      classification: "unknowable",
      statement: "Incomplete embedded frame evidence prevents a complete visual comparison.",
      evidence: visual.orderedTracePacks.map((pack) => pack.tracePackDigest),
      requiresLiveVerification: true,
    });
  }
  if (
    visual &&
    (visual.sufficiency.localization === "partial" ||
      visual.sufficiency.localization === "insufficient")
  ) {
    add({
      priority: 97,
      kind: "evidence-gap",
      classification: "unknowable",
      statement:
        "Incomplete embedded semantic evidence prevents a complete localization recomputation.",
      evidence: visual.orderedTracePacks.map((pack) => pack.tracePackDigest),
      requiresLiveVerification: true,
    });
  }
  for (const path of input.comparison?.requiredPaths ?? []) {
    if (path.reachability.status !== "regressed" && path.reachability.status !== "changed")
      continue;
    add({
      priority: path.reachability.status === "regressed" ? 92 : 84,
      kind: "reachability-change",
      classification:
        path.reachability.fact.classification === "historically-failed"
          ? "historically-observed"
          : "recomputed-signal",
      statement: `Frozen evidence shows ${path.reachability.status} reachability for ${path.title}.`,
      evidence: path.reachability.fact.evidence,
      requiresLiveVerification: true,
    });
  }
  for (const finding of visual?.localization.findings ?? []) {
    add({
      priority: finding.severity === "critical" ? 90 : 75,
      kind: "localization-finding",
      classification: "recomputed-signal",
      statement: `${finding.code} was recomputed for ${finding.screenLabel} in ${finding.locale}.`,
      evidence: visual!.orderedTracePacks.map((pack) => pack.tracePackDigest),
      requiresLiveVerification: true,
    });
  }
  for (const matcher of input.comparison?.matcherDeltas ?? []) {
    if (matcher.status !== "changed") continue;
    add({
      priority: 72,
      kind: "matcher-change",
      classification: "recomputed-signal",
      statement: `The current selector matcher changed its historical result for ${matcher.checkId}.`,
      evidence: matcher.fact.evidence,
      requiresLiveVerification: true,
    });
  }
  for (const frame of visual?.historicalBaseline.frames ?? []) {
    if (frame.status === "exact-match" || frame.status === "not-comparable") continue;
    add({
      priority:
        frame.status === "dimensions-changed" || frame.status === "presence-changed" ? 70 : 60,
      kind: "visual-change",
      classification: "recomputed-signal",
      statement: `Embedded frame ${frame.canonicalKey} has a ${frame.status} historical delta.`,
      evidence: frame.fact.evidence.length
        ? frame.fact.evidence
        : frame.observations.map((item) => item.tracePackDigest),
      requiresLiveVerification: true,
    });
  }
  return candidates
    .sort(
      (left, right) =>
        right.priority - left.priority || left.statement.localeCompare(right.statement),
    )
    .slice(0, maxHypotheses)
    .map((candidate, index) => ({ rank: index + 1, ...candidate }));
}

function smallestLiveExperiment(
  comparison: ReplayLabReport["comparison"],
  visual: ReplayLabReport["visualLocalization"],
): ReplayLabReport["smallestLiveExperiment"] {
  const choices = [
    ...(comparison
      ? [{ source: "comparison" as const, value: comparison.smallestLiveVerification }]
      : []),
    ...(visual
      ? [{ source: "visual-localization" as const, value: visual.smallestLiveVerification }]
      : []),
  ];
  const priority: Record<(typeof choices)[number]["value"]["kind"], number> = {
    "recapture-required-evidence": 100,
    "recapture-frame-evidence": 95,
    "recapture-semantic-evidence": 90,
    "recapture-frozen-plan": 85,
    "replay-check": 80,
    "replay-frozen-test": 70,
  };
  const selected = choices.sort(
    (left, right) => priority[right.value.kind] - priority[left.value.kind],
  )[0]!;
  return { source: selected.source, ...selected.value };
}

/** Run the product-facing Replay Lab solely over explicit immutable inputs.
 * This is intentionally an outcome façade method with no operation-port use. */
export async function runReplayLab(intent: ReplayLabOutcomeIntent): Promise<ReplayLabReport> {
  const analysis = replayLabAnalysisSchema.parse(intent.analysis);
  const tracePacks = intent.tracePacks;
  assertBoundedTracePacks(tracePacks);
  const comparison = analysis === "visual-localization" ? undefined : compareTracePacks(tracePacks);
  const visualLocalization =
    analysis === "compare" ? undefined : recomputeTracePackVisualLocalization(tracePacks);
  return replayLabReportSchema.parse({
    schemaVersion: 1,
    mode: "relay-replay-lab",
    analysis,
    tracePackCount: tracePacks.length,
    ...(comparison ? { comparison } : {}),
    ...(visualLocalization ? { visualLocalization } : {}),
    hypotheses: hypotheses({ comparison, visualLocalization }),
    smallestLiveExperiment: smallestLiveExperiment(comparison, visualLocalization),
    futureTransitionVerdict: "unknown",
    repairPolicy: { mutation: "none", requiresReview: true },
  });
}
