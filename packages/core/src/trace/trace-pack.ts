import { createHash } from "node:crypto";
import {
  authoringCaptureProvenance,
  captureProofForAuthoring,
  parseTracePack,
  type EvidenceChannelStatus,
  type TracePack,
  type TracePackObject,
} from "@relay/protocol";
import { readFrameFile } from "../run/run-artifact-files.js";
import type { PersistedRun } from "../run/run-store.js";
import {
  checkBrowserProofEvidenceReferences,
  inspectBrowserProofEvidence,
} from "../browser/browser-proof-evidence.js";
import { readAuthoringSession } from "../authoring/authoring-session-storage.js";
import { closeTracePackArtifacts } from "./trace-pack-artifact-closure.js";
import type { TracePackExportLimits } from "./trace-pack-artifact-bounds.js";
import {
  canonicalJson,
  canonicalValue,
  tracePackDigest,
  tracePackSha256,
} from "./trace-pack-identity.js";
import { androidPacketCaptureProvenance } from "./trace-pack-provenance.js";

export {
  analyzeTracePack,
  destIdentityFramesFromTracePack,
  frozenRunFromTracePack,
  verifyTracePack,
} from "./trace-pack-offline.js";
export type { TracePackExportLimits } from "./trace-pack-artifact-bounds.js";

function jsonObject(path: string, kind: "frozen-run", content: unknown): TracePackObject {
  const serialized = canonicalJson(content);
  return {
    path,
    kind,
    mediaType: "application/json",
    encoding: "json",
    digest: tracePackSha256(serialized),
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
  return parseTracePack({ ...body, digest: tracePackDigest(body) });
}
