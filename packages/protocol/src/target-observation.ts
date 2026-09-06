import type { ArtifactRefProjection } from "./artifact-ref.js";
import type { AuthoringTarget } from "./authoring.js";
import type { TargetRuntimeReadiness } from "./target-contract.js";

export const TARGET_OBSERVATION_MAX_CONTROLS = 40;
export const TARGET_OBSERVATION_MAX_PRESENTATION_BYTES = 8 * 1024 * 1024;

export type TargetObservationControl = {
  identifier?: string;
  label?: string;
  text?: string;
  role?: string;
  enabled?: boolean;
  selected?: boolean;
  rect?: { x: number; y: number; width: number; height: number };
};

export type TargetObservation = {
  schemaVersion: 1;
  target: AuthoringTarget;
  capturedAt: number;
  pixels:
    | {
        status: "captured";
        capturedAt: number;
        mime: "image/png" | "image/jpeg";
        bytes: number;
        artifact: ArtifactRefProjection;
        /** Bounded, transient presentation bytes. Persisted proof is `artifact`. */
        presentationBase64?: string;
        width?: number;
        height?: number;
        fingerprint?: string;
      }
    | { status: "unavailable"; message: string };
  semantics: {
    status: "current" | "stale" | "unavailable";
    capturedAt?: number;
    artifact: ArtifactRefProjection;
    source?: "sdk" | "android-system" | "pixels-only";
    inspectionState?: "active" | "keyguard" | "asleep" | "unavailable" | "unknown";
    fingerprint?: string;
    nodeCount: number;
    controls: readonly TargetObservationControl[];
    message?: string;
  };
  foregroundApp?: string;
  screenCandidate?: {
    id?: string;
    fingerprint: string;
    confidence: "matched" | "observed";
  };
  readiness?: TargetRuntimeReadiness;
};
