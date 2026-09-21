import { createHash } from "node:crypto";
import {
  authoringCaptureProvenance,
  captureProofForAuthoring,
  parseAndroidPacketCaptureProvenance,
  parseTracePack,
  tracePackOfflineAnalysisSchema,
  type EvidenceChannelStatus,
  type AndroidPacketCaptureProvenance,
  type TracePack,
  type TracePackObject,
  type TracePackOfflineAnalysis,
} from "@relay/protocol";
import { destIdentitySourceFrames } from "@relay/protocol";
import { replayPersistedRunOffline } from "./offline-run-replay.js";
import { readFrameFile } from "./run-artifact-files.js";
import type { PersistedRun } from "./runs.js";
import {
  checkBrowserProofEvidenceReferences,
  inspectBrowserProofEvidence,
} from "./browser-proof-evidence.js";
import { readAuthoringSession } from "./authoring-session-storage.js";
import {
  assertTracePackArtifactBounds,
  closeTracePackArtifacts,
  type TracePackExportLimits,
} from "./trace-pack-artifact-closure.js";

export type { TracePackExportLimits } from "./trace-pack-artifact-closure.js";

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => [key, canonicalValue(item)]),
  );
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function sha256(bytes: string | Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function jsonObject(path: string, kind: "frozen-run", content: unknown): TracePackObject {
  const serialized = canonicalJson(content);
  return {
    path,
    kind,
    mediaType: "application/json",
    encoding: "json",
    digest: sha256(serialized),
    bytes: Buffer.byteLength(serialized),
    content: canonicalValue(content),
  };
}

function frozenRun(run: PersistedRun): Omit<PersistedRun, "dir"> {
  const { dir: _localPath, ...portable } = structuredClone(run);
  return portable;
}

function channels(run: PersistedRun): Record<string, EvidenceChannelStatus | "missing"> {
  if (!run.evidence) return {};
  return Object.fromEntries(
    Object.entries(run.evidence.channels)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([channel, record]) => [channel, record.status]),
  );
}

function packDigest(pack: Omit<TracePack, "digest">): `sha256:${string}` {
  return sha256(canonicalJson(pack));
}

/** Compare embedded frame bytes against the image digests recorded by the
 * capture-review artifacts. A frame whose bytes changed after the run is
 * tampering; a reviewable frame absent from the closure is missing. */
function captureIntegrityFailures(run: PersistedRun): Promise<string[]> {
  const failures: string[] = [];
  const reviews = run.artifacts.filter((artifact) => artifact.kind === "capture-review");
  return (async () => {
    for (const artifact of reviews) {
      const data = artifact.data;
      if (data === null || typeof data !== "object" || Array.isArray(data)) continue;
      const framePath = (data as { framePath?: unknown }).framePath;
      const imageSha256 = (data as { imageSha256?: unknown }).imageSha256;
      if (typeof framePath !== "string" || typeof imageSha256 !== "string") continue;
      const bytes = await readFrameFile(run.dir, framePath);
      if (!bytes) {
        failures.push(`missing frame ${framePath}`);
        continue;
      }
      const observed = createHash("sha256").update(bytes).digest("hex");
      if (observed !== imageSha256) failures.push(`tampered frame ${framePath}`);
    }
    return failures;
  })();
}
function frozenRunAppMapId(run: PersistedRun): string | undefined {
  for (const artifact of run.artifacts) {
    if (artifact.data && typeof artifact.data === "object" && !Array.isArray(artifact.data)) {
      const appMapId = (artifact.data as { appMapId?: unknown }).appMapId;
      if (typeof appMapId === "string" && appMapId.trim()) return appMapId;
    }
  }
  return undefined;
}

function androidPacketCaptureProvenance(
  run: PersistedRun,
): AndroidPacketCaptureProvenance | undefined {
  for (let index = run.artifacts.length - 1; index >= 0; index -= 1) {
    const artifact = run.artifacts[index]!;
    if (
      artifact.kind !== "network" ||
      !artifact.data ||
      typeof artifact.data !== "object" ||
      Array.isArray(artifact.data)
    ) {
      continue;
    }
    const candidate = (artifact.data as { androidPacketCapture?: unknown }).androidPacketCapture;
    if (candidate === undefined) continue;
    try {
      return parseAndroidPacketCaptureProvenance(candidate);
    } catch {
      // The frozen artifact remains available for forensic inspection, but a
      // malformed value cannot be promoted into the typed TracePack manifest.
    }
  }
  return undefined;
}

/** Freeze one immutable run into a portable, artifact-closed JSON document. */
export async function exportTracePack(
  run: PersistedRun,
  requestedLimits: TracePackExportLimits = {},
): Promise<TracePack> {
  if (!/^[a-f0-9]{64}$/u.test(run.inputDigest)) {
    throw new Error(`run ${run.id} has no valid frozen input digest`);
  }
  const referencedAuthoringSession = run.executionProvenance?.authoringSessionId
    ? await readAuthoringSession(run.executionProvenance.authoringSessionId)
    : null;
  const provenance = run.executionProvenance;
  const runAppMapId = frozenRunAppMapId(run);
  const authoringSession =
    referencedAuthoringSession &&
    provenance &&
    runAppMapId &&
    referencedAuthoringSession.organizationId === provenance.organizationId &&
    referencedAuthoringSession.projectId === provenance.projectId &&
    referencedAuthoringSession.appMapId === runAppMapId
      ? referencedAuthoringSession
      : null;
  const closure = await closeTracePackArtifacts(run, requestedLimits);
  // FIN-14: a pinned export must not ship evidence whose bytes contradict
  // the digests recorded when the captures were taken. Missing frames are
  // already listed in the pack's missing set; tampering is a hard failure.
  const integrityFailures = await captureIntegrityFailures(run);
  if (integrityFailures.length > 0) {
    throw new Error(
      `TracePack export refused: capture evidence fails integrity — ${integrityFailures.join("; ")}`,
    );
  }
  const objects = [jsonObject("run.json", "frozen-run", frozenRun(run)), ...closure.objects].sort(
    (left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0),
  );
  const artifactReferences = closure.references;
  const androidPacketCapture = androidPacketCaptureProvenance(run);
  const browserEvidence = inspectBrowserProofEvidence(run);
  const browserReferenceCheck = browserEvidence.evidence
    ? checkBrowserProofEvidenceReferences(
        browserEvidence.evidence,
        new Set(
          artifactReferences
            .filter((reference) => reference.status === "embedded")
            .map((reference) => reference.path),
        ),
      )
    : { missing: [] };
  const browserEvidenceForPack =
    browserEvidence.evidence &&
    browserEvidence.missing.every((item) => item.startsWith("browser:")) &&
    browserReferenceCheck.missing.length === 0
      ? browserEvidence.evidence
      : undefined;
  const unreferencedCapturedFileChannels = ["screenshot", "video"].filter((channel) => {
    const record = (
      run.evidence?.channels as
        | Record<string, { status: EvidenceChannelStatus; entries: number; bytes: number }>
        | undefined
    )?.[channel];
    return (
      record?.status === "captured" &&
      (record.entries > 0 || record.bytes > 0) &&
      !artifactReferences.some((reference) => reference.channels.includes(channel))
    );
  });
  const missing = [
    ...(!run.evidence ? ["evidence-manifest"] : []),
    ...unreferencedCapturedFileChannels.map(
      (channel) => `channel:${channel}:artifact-reference-missing`,
    ),
    ...artifactReferences
      .filter((reference) => reference.status !== "embedded")
      .map(
        (reference) =>
          `artifact:${reference.path}:${reference.status}:${reference.reason ?? "unknown"}`,
      ),
    ...Object.entries(run.evidence?.channels ?? {})
      // Unsupported collectors and consent-denied sensitive collectors are
      // complete statements about what this Run was allowed and able to
      // collect. Preserve them in the channel manifest, but do not conflate
      // them with evidence that was requested and then lost, failed, or
      // redacted. A Change Proof may still require a specific channel through
      // its versioned policy; TracePack completeness only closes the evidence
      // contract the Run actually attempted.
      .filter(([, record]) => ["partial", "failed", "redacted"].includes(record.status))
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([channel, record]) => `channel:${channel}:${record.status}`),
    ...browserEvidence.missing,
    ...browserReferenceCheck.missing,
  ];
  const redactedChannels = Object.entries(run.evidence?.channels ?? {})
    .filter(([, record]) => record.status === "redacted")
    .map(([channel]) => channel)
    .sort();
  const body = {
    schemaVersion: 1 as const,
    kind: "relay-trace-pack" as const,
    createdAt: run.writtenAt,
    source: {
      runId: run.id,
      runSchemaVersion: run.schemaVersion,
      status: run.status,
      action: run.action,
      inputDigest: run.inputDigest,
      writtenAt: run.writtenAt,
      ...(authoringSession
        ? {
            authoringCapture: authoringCaptureProvenance(authoringSession.captureProvenance),
            authoringCaptureProof: captureProofForAuthoring(
              authoringCaptureProvenance(authoringSession.captureProvenance),
              authoringSession.take?.replayAttempts.some(
                (attempt) =>
                  attempt.takeRevision === authoringSession.take?.currentRevision &&
                  attempt.outcome === "passed",
              ) === true,
            ),
          }
        : {}),
    },
    redaction: {
      status: run.schemaVersion >= 5 ? ("applied-at-persistence" as const) : ("unknown" as const),
      redactedChannels,
    },
    completeness: {
      status: missing.length ? ("partial" as const) : ("complete" as const),
      channels: channels(run),
      missing,
      artifacts: artifactReferences,
    },
    ...(browserEvidenceForPack ? { browserEvidence: browserEvidenceForPack } : {}),
    ...(androidPacketCapture ? { androidPacketCapture } : {}),
    objects,
  };
  return parseTracePack({ ...body, digest: packDigest(body) });
}

function objectBytes(object: TracePackObject): Buffer {
  if (object.encoding === "base64") return Buffer.from(object.content as string, "base64");
  return Buffer.from(canonicalJson(object.content));
}

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
    const bytes = objectBytes(object);
    if (bytes.byteLength !== object.bytes || sha256(bytes) !== object.digest) {
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
  if (packDigest(body) !== pack.digest) throw new Error("TracePack manifest integrity failed");
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
