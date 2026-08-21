/**
 * Provider-neutral, content-addressed artifact contract.
 *
 * `integrity` is the authority for an artifact's identity. `locations` are
 * deliberately opaque hints for a source-specific adapter; consumers must
 * never execute, open, or otherwise trust them as filesystem paths or URLs.
 */
export const ARTIFACT_REF_SCHEMA_VERSION = 1 as const;

export type ArtifactMediaKind =
  | "image"
  | "video"
  | "structured-data"
  | "log"
  | "network"
  | "performance"
  | "crash"
  | "audio"
  | "binary"
  | "unknown";

export type ArtifactSource =
  | "authoring-evidence"
  | "recipe-evidence"
  | "run-frame"
  | "run-artifact"
  | "external";

export type ArtifactLocationStore = "authoring-evidence" | "recipe-evidence" | "run" | "external";

/** This is not a URL and cannot be used as a read instruction. A host must
 * choose a source-specific adapter and validate its own scope before loading
 * a byte stream. */
export type ArtifactOpaqueLocation = {
  store: ArtifactLocationStore;
  opaque: string;
};

export type ArtifactRetention = {
  /** Who is responsible for retaining this byte stream. */
  scope: "workspace-content-addressed" | "recipe-content-addressed" | "run-directory" | "external";
  /** What a later host can reasonably do without a live device. */
  recoverability: "content-addressed" | "best-effort" | "external";
};

export type ArtifactProvenance = {
  source: ArtifactSource;
  /** The current local adapters preserve directly recorded bytes. Future
   * providers may report imported/derived artifacts without changing identity. */
  capture: "recorded" | "derived" | "imported" | "unknown";
};

export type ArtifactRef = {
  schemaVersion: typeof ARTIFACT_REF_SCHEMA_VERSION;
  /** Canonical identity: `sha256:<lowercase hex digest>`. */
  id: string;
  integrity: {
    algorithm: "sha256";
    sha256: string;
    bytes: number;
  };
  media: {
    kind: ArtifactMediaKind;
    mime?: string;
  };
  /** The source capture time when the store has one. It is intentionally
   * absent rather than fabricated for older recipe evidence. */
  capturedAt?: number;
  provenance: ArtifactProvenance;
  retention: ArtifactRetention;
  /** Opaque discovery hints only; integrity is the authority. */
  locations: ArtifactOpaqueLocation[];
};

/** A caller can distinguish a usable content address from data intentionally
 * withheld by evidence policy or no longer present in the source store. */
export type ArtifactRefProjection =
  | { status: "available"; artifact: ArtifactRef }
  | {
      status: "redacted";
      source: ArtifactSource;
      media: ArtifactRef["media"];
      capturedAt?: number;
      reason: "visual-evidence-policy";
    }
  | {
      status: "missing";
      source: ArtifactSource;
      media: ArtifactRef["media"];
      capturedAt?: number;
    };
