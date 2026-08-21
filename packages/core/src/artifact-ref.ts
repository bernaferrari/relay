import { createHash } from "node:crypto";
import type {
  ArtifactLocationStore,
  ArtifactMediaKind,
  ArtifactOpaqueLocation,
  ArtifactProvenance,
  ArtifactRef,
  ArtifactRefProjection,
  ArtifactRetention,
} from "@relay/protocol";
import { visualEvidenceAllowed } from "./redaction.js";

const SHA256 = /^[a-f0-9]{64}$/u;

export type ArtifactRefInput = {
  sha256: string;
  bytes: number;
  media: ArtifactRef["media"];
  capturedAt?: number;
  provenance: ArtifactProvenance;
  retention: ArtifactRetention;
  locations?: ArtifactOpaqueLocation[];
};

function assertIntegrity(sha256: string, bytes: number): void {
  if (!SHA256.test(sha256)) throw new Error("ArtifactRef sha256 must be lowercase hexadecimal");
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new Error("ArtifactRef byte size must be a non-negative safe integer");
  }
}

function assertCapturedAt(capturedAt: number | undefined): void {
  if (capturedAt !== undefined && (!Number.isFinite(capturedAt) || capturedAt < 0)) {
    throw new Error("ArtifactRef capture time must be a non-negative finite timestamp");
  }
}

/** Make a non-authoritative source hint. It deliberately encodes rather than
 * exposes filesystem path components, and no helper accepts the result as a
 * path to read. The source adapter receives its validated scope separately. */
export function opaqueArtifactLocation(
  store: ArtifactLocationStore,
  parts: readonly string[],
): ArtifactOpaqueLocation {
  return {
    store,
    opaque: Buffer.from(JSON.stringify([...parts]), "utf8").toString("base64url"),
  };
}

/** Build a canonical reference from already verified integrity metadata. */
export function artifactRefFromIntegrity(input: ArtifactRefInput): ArtifactRef {
  assertIntegrity(input.sha256, input.bytes);
  assertCapturedAt(input.capturedAt);
  return {
    schemaVersion: 1,
    id: `sha256:${input.sha256}`,
    integrity: { algorithm: "sha256", sha256: input.sha256, bytes: input.bytes },
    media: structuredClone(input.media),
    ...(input.capturedAt !== undefined ? { capturedAt: input.capturedAt } : {}),
    provenance: structuredClone(input.provenance),
    retention: structuredClone(input.retention),
    locations: structuredClone(input.locations ?? []),
  };
}

/** Build the same reference directly from bytes when an older store did not
 * persist integrity alongside its frame or evidence record. */
export function artifactRefFromBytes(
  input: Omit<ArtifactRefInput, "sha256" | "bytes"> & { data: Uint8Array | string },
): ArtifactRef {
  const bytes = typeof input.data === "string" ? Buffer.from(input.data, "utf8") : input.data;
  return artifactRefFromIntegrity({
    ...input,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.byteLength,
  });
}

/** Two provider references name the same immutable content only when both the
 * algorithm digest and byte count agree. Their locations and retention may
 * still differ, which is why they are never compared as storage authority. */
export function hasEquivalentArtifactContent(left: ArtifactRef, right: ArtifactRef): boolean {
  return (
    left.integrity.algorithm === "sha256" &&
    right.integrity.algorithm === "sha256" &&
    left.integrity.sha256 === right.integrity.sha256 &&
    left.integrity.bytes === right.integrity.bytes
  );
}

export function artifactMediaKindForMime(mime: string | undefined): ArtifactMediaKind {
  if (!mime) return "unknown";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/json" || mime.endsWith("+json") || mime.startsWith("text/")) {
    return "structured-data";
  }
  return "binary";
}

export function isVisualArtifact(artifact: Pick<ArtifactRef, "media">): boolean {
  return artifact.media.kind === "image" || artifact.media.kind === "video";
}

/** Preserve the workspace visual-redaction boundary in projections. Nonvisual
 * artifacts remain available so diagnostics still work while pixels are held
 * back; visual callers receive no content address to fetch. */
export function projectArtifactRef(
  artifact: ArtifactRef,
  allowVisual = visualEvidenceAllowed(),
): ArtifactRefProjection {
  if (isVisualArtifact(artifact) && !allowVisual) {
    return {
      status: "redacted",
      source: artifact.provenance.source,
      media: structuredClone(artifact.media),
      ...(artifact.capturedAt !== undefined ? { capturedAt: artifact.capturedAt } : {}),
      reason: "visual-evidence-policy",
    };
  }
  return { status: "available", artifact: structuredClone(artifact) };
}

/** A source-specific adapter reports absence explicitly instead of creating a
 * guessed digest or a path-shaped authority for an unavailable artifact. */
export function missingArtifactRef(input: {
  source: ArtifactRef["provenance"]["source"];
  media: ArtifactRef["media"];
  capturedAt?: number;
}): ArtifactRefProjection {
  return {
    status: "missing",
    source: input.source,
    media: structuredClone(input.media),
    ...(input.capturedAt !== undefined ? { capturedAt: input.capturedAt } : {}),
  };
}

/** Report a policy-held visual source without opening it to calculate a
 * digest. This keeps redaction from becoming an accidental local read path. */
export function redactedArtifactRef(input: {
  source: ArtifactRef["provenance"]["source"];
  media: ArtifactRef["media"];
  capturedAt?: number;
}): ArtifactRefProjection {
  return {
    status: "redacted",
    source: input.source,
    media: structuredClone(input.media),
    ...(input.capturedAt !== undefined ? { capturedAt: input.capturedAt } : {}),
    reason: "visual-evidence-policy",
  };
}
