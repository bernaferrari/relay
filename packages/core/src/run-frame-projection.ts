import type { TraceFrameRef } from "./trace.js";
import type { ArtifactRefProjection } from "@relay/protocol";
import { visualEvidenceAllowed } from "./redaction.js";
import {
  artifactMediaKindForMime,
  artifactRefFromBytes,
  missingArtifactRef,
  opaqueArtifactLocation,
  projectArtifactRef,
  redactedArtifactRef,
} from "./artifact-ref.js";
import { readFrameFile } from "./run-artifact-files.js";

/** Canonical, additive projection for a persisted or live run frame. The
 * supplied run directory remains inside this source adapter; the resulting
 * reference contains only a non-authoritative opaque locator. */
export async function projectRunFrameArtifact(input: {
  runId: string;
  runDir: string;
  frame: TraceFrameRef;
}): Promise<ArtifactRefProjection> {
  const mime = input.frame.mime ?? "image/png";
  const media = { kind: artifactMediaKindForMime(mime), mime };
  if (!visualEvidenceAllowed()) {
    return redactedArtifactRef({
      source: "run-frame",
      media,
      capturedAt: input.frame.capturedAt,
    });
  }
  const data = input.frame.base64
    ? Buffer.from(input.frame.base64, "base64")
    : await readFrameFile(input.runDir, input.frame.path);
  if (!data) {
    return missingArtifactRef({
      source: "run-frame",
      media,
      capturedAt: input.frame.capturedAt,
    });
  }
  return projectArtifactRef(
    artifactRefFromBytes({
      data,
      media,
      capturedAt: input.frame.capturedAt,
      provenance: { source: "run-frame", capture: "recorded" },
      retention: { scope: "run-directory", recoverability: "best-effort" },
      locations: [opaqueArtifactLocation("run", [input.runId, input.frame.path])],
    }),
  );
}
