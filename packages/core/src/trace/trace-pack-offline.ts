import {
  destIdentitySourceFrames,
  parseTracePack,
  tracePackOfflineAnalysisSchema,
  type TracePack,
  type TracePackOfflineAnalysis,
} from "@relay/protocol";
import { replayPersistedRunOffline } from "../offline/offline-run-replay.js";
import type { PersistedRun } from "../run/run-store.js";
import {
  checkBrowserProofEvidenceReferences,
  inspectBrowserProofEvidence,
} from "../browser/browser-proof-evidence.js";
import {
  assertTracePackArtifactBounds,
  type TracePackExportLimits,
} from "./trace-pack-artifact-bounds.js";
import {
  canonicalJson,
  tracePackDigest,
  tracePackObjectBytes,
  tracePackSha256,
} from "./trace-pack-identity.js";
import { androidPacketCaptureProvenance } from "./trace-pack-provenance.js";

/** Validate the schema, manifest, object hashes, and artifact closure. */
export function verifyTracePack(
  value: unknown,
  requestedLimits: TracePackExportLimits = {},
): TracePack {
  const pack = parseTracePack(value);
  assertTracePackArtifactBounds(pack.objects, requestedLimits);
  const paths = new Set<string>();
  for (const object of pack.objects) {
    if (paths.has(object.path)) {
      throw new Error(`TracePack object path is duplicated: ${object.path}`);
    }
    paths.add(object.path);
    const bytes = tracePackObjectBytes(object);
    if (bytes.byteLength !== object.bytes || tracePackSha256(bytes) !== object.digest) {
      throw new Error(`TracePack object integrity failed: ${object.path}`);
    }
  }
  const frozen = pack.objects.find((object) => object.kind === "frozen-run");
  const frozenPacketCapture =
    frozen?.content && typeof frozen.content === "object" && !Array.isArray(frozen.content)
      ? androidPacketCaptureProvenance(frozen.content as PersistedRun)
      : undefined;
  if (
    (pack.androidPacketCapture === undefined) !== (frozenPacketCapture === undefined) ||
    (pack.androidPacketCapture &&
      canonicalJson(pack.androidPacketCapture) !== canonicalJson(frozenPacketCapture))
  ) {
    throw new Error("TracePack packet capture provenance does not match the frozen run");
  }
  if (pack.browserEvidence) {
    if (
      !frozen ||
      !frozen.content ||
      typeof frozen.content !== "object" ||
      Array.isArray(frozen.content)
    ) {
      throw new Error("TracePack browser evidence has no frozen run binding");
    }
    const inspection = inspectBrowserProofEvidence(frozen.content as PersistedRun);
    const bindingMissing = inspection.missing.filter((item) =>
      item.startsWith("browser-evidence:"),
    );
    if (!inspection.evidence || bindingMissing.length) {
      throw new Error("TracePack browser evidence binding or completeness failed");
    }
    const references = pack.completeness.artifacts;
    const missingReferences = checkBrowserProofEvidenceReferences(
      pack.browserEvidence,
      new Set(
        (references ?? [])
          .filter((reference) => reference.status === "embedded")
          .map((reference) => reference.path),
      ),
    );
    if (missingReferences.missing.length) {
      throw new Error("TracePack browser evidence artifact reference is unresolved");
    }
    if (JSON.stringify(inspection.evidence) !== JSON.stringify(pack.browserEvidence)) {
      throw new Error("TracePack browser evidence does not match the frozen run");
    }
  }
  const references = pack.completeness.artifacts;
  if (references) {
    const referencedObjects = new Set<string>();
    const referencedArtifacts = new Set<string>();
    for (const reference of references) {
      if (referencedArtifacts.has(reference.path)) {
        throw new Error(`TracePack artifact reference is duplicated: ${reference.path}`);
      }
      referencedArtifacts.add(reference.path);
      if (reference.status !== "embedded") continue;
      const object = pack.objects.find((candidate) => candidate.path === reference.objectPath);
      if (
        !object ||
        object.kind === "frozen-run" ||
        object.digest !== reference.digest ||
        object.bytes !== reference.bytes ||
        object.mediaType !== reference.mediaType ||
        (reference.expectedBytes !== undefined && reference.expectedBytes !== object.bytes)
      ) {
        throw new Error(`TracePack artifact closure failed: ${reference.path}`);
      }
      referencedObjects.add(object.path);
    }
    for (const object of pack.objects) {
      if (object.kind !== "frozen-run" && !referencedObjects.has(object.path)) {
        throw new Error(`TracePack object is not in the artifact closure: ${object.path}`);
      }
    }
    if (
      pack.completeness.status === "complete" &&
      references.some((reference) => reference.status !== "embedded")
    ) {
      throw new Error("TracePack completeness cannot be complete with unembedded artifacts");
    }
  }
  const { digest: _digest, ...body } = pack;
  if (tracePackDigest(body) !== pack.digest) throw new Error("TracePack manifest integrity failed");
  return pack;
}

export function frozenRunFromTracePack(value: unknown): PersistedRun {
  const pack = verifyTracePack(value);
  const manifests = pack.objects.filter((object) => object.kind === "frozen-run");
  if (manifests.length !== 1) throw new Error("TracePack must contain exactly one frozen run");
  const frozenContent = manifests[0]!.content;
  if (!frozenContent || typeof frozenContent !== "object" || Array.isArray(frozenContent)) {
    throw new Error("TracePack frozen run is not an object");
  }
  const run = frozenContent as Omit<PersistedRun, "dir">;
  if (run.id !== pack.source.runId || run.inputDigest !== pack.source.inputDigest) {
    throw new Error("TracePack source identity does not match its frozen run");
  }
  return { ...structuredClone(run), dir: "" };
}

/** Dest wait-for identity from a frozen TracePack. Leftover Close last-frame cannot fill dest. */
export function destIdentityFramesFromTracePack(value: unknown): string[] {
  const run = frozenRunFromTracePack(value);
  return destIdentitySourceFrames(run.frames ?? [], run.artifacts).map((frame) => frame.path);
}

/** Analyze frozen evidence without claiming a future-device pass. */
export function analyzeTracePack(value: unknown): TracePackOfflineAnalysis {
  const pack = verifyTracePack(value);
  const run = frozenRunFromTracePack(pack);
  const replay = replayPersistedRunOffline(run);
  const runObject = pack.objects.find((object) => object.kind === "frozen-run")!;
  const proved: TracePackOfflineAnalysis["proved"] = [
    {
      code: "TRACE_PACK_INTEGRITY",
      statement: "Every exported object matches its recorded SHA-256 content address.",
      evidence: pack.objects.map((object) => object.digest),
    },
    ...replay.checks
      .filter((check) => check.replayStatus === "proved")
      .map((check) => ({
        code: "RECORDED_TRANSITION_PROOF",
        statement: `${check.title} was backed by a verified transition proof when this run was captured.`,
        evidence: [runObject.digest],
      })),
  ];
  const unknown: TracePackOfflineAnalysis["unknown"] = [
    {
      code: "FUTURE_TARGET_STATE",
      statement:
        "Frozen evidence cannot prove that the same transition will succeed on a future target state or build.",
      resolution: "Replay the frozen Test or focused failed check on a controlled live target.",
    },
    ...pack.completeness.missing.map((missing) => ({
      code: "MISSING_EVIDENCE",
      statement: `${missing} is absent from this TracePack.`,
      resolution: "Recapture the frozen plan with that evidence channel enabled and permitted.",
    })),
    ...replay.blockers.map((blocker) => ({
      code: blocker.kind.toUpperCase().replaceAll("-", "_"),
      statement: blocker.message,
      resolution:
        blocker.kind === "missing-frozen-plan"
          ? "Recapture a run with its frozen plan."
          : "Replay the first causal failure before trusting dependent checks.",
    })),
  ];
  const firstRoot = replay.firstRootFailure;
  const missingPlan = replay.blockers.some((blocker) => blocker.kind === "missing-frozen-plan");
  const historicalVerdict: TracePackOfflineAnalysis["historicalVerdict"] = firstRoot
    ? "failed"
    : replay.summary.checks > 0 && replay.summary.proved === replay.summary.checks
      ? "proved"
      : "insufficient-evidence";
  const recomputed: NonNullable<TracePackOfflineAnalysis["recomputed"]> = replay.checks.flatMap(
    (check) => {
      const matcher = check.currentMatcher;
      if (!matcher) return [];
      const comparable = matcher.selectors.filter((selector) => selector.status !== "unavailable");
      const resolved = comparable.filter((selector) => selector.status === "resolved").length;
      const robustness = comparable.length === 0 ? 0 : resolved / comparable.length;
      const status =
        matcher.comparison === "changed"
          ? ("changed" as const)
          : matcher.status === "resolved"
            ? ("supports-recorded" as const)
            : matcher.status === "blocked"
              ? ("blocked" as const)
              : ("unavailable" as const);
      return [
        {
          code: "CURRENT_SELECTOR_MATCHER" as const,
          algorithm: "semantic-activation-v1" as const,
          checkId: check.id,
          status,
          robustness,
          statement:
            status === "supports-recorded"
              ? `The current pure matcher resolves ${resolved}/${comparable.length} frozen semantic selectors for ${check.title}.`
              : status === "changed"
                ? `The current pure matcher disagrees with the recorded selector result for ${check.title}.`
                : status === "blocked"
                  ? `The current pure matcher cannot resolve every comparable frozen selector for ${check.title}.`
                  : `The TracePack does not contain enough comparable semantic evidence for ${check.title}.`,
          evidence: [runObject.digest],
          requiresLiveVerification: true as const,
        },
      ];
    },
  );
  return tracePackOfflineAnalysisSchema.parse({
    schemaVersion: 1,
    mode: "trace-pack-offline-analysis",
    tracePackDigest: pack.digest,
    sourceRunId: run.id,
    historicalVerdict,
    futureTransitionVerdict: "unknown",
    proved,
    recomputed,
    unknown,
    smallestLiveVerification: missingPlan
      ? {
          kind: "recapture-frozen-plan",
          reason: "Offline analysis has no frozen execution plan to evaluate.",
          requiresTarget: true,
        }
      : firstRoot
        ? {
            kind: "replay-check",
            checkId: firstRoot.checkId,
            reason: `${firstRoot.title} is the first causal failure; replay only this check first.`,
            requiresTarget: true,
          }
        : {
            kind: "replay-frozen-test",
            reason:
              "Historical evidence is exhausted; a live replay is the smallest way to learn whether current behavior still agrees.",
            requiresTarget: true,
          },
  });
}
