/** How an Authoring Session obtained the interactions it proposes as a Test.
 * This is provenance, not a claim that the resulting transition was proved. */
export const AUTHORING_CAPTURE_MODES = [
  "control-and-record",
  "watch-and-infer",
  "instrumented",
] as const;

export type AuthoringCaptureMode = (typeof AUTHORING_CAPTURE_MODES)[number];

/** A discriminated provenance record prevents clients from pairing a capture
 * mode with a stronger origin claim than that mode can establish. */
export type AuthoringCaptureProvenance =
  | {
      schemaVersion: 1;
      mode: "control-and-record";
      origin: "relay-control";
    }
  | {
      schemaVersion: 1;
      mode: "watch-and-infer";
      origin: "observed-transition";
    }
  | {
      schemaVersion: 1;
      mode: "instrumented";
      origin: "app-instrumentation";
    };

export type AuthoringCaptureProof =
  | "relay-controlled"
  | "inferred-unproved"
  | "instrumented-unproved"
  | "replay-proved";

/** Reviewed origin/proof metadata. This is descriptive evidence provenance,
 * never executable Test intent or authority to approve a recording. */
export type AuthoringCaptureReview = {
  schemaVersion: 1;
  provenance: AuthoringCaptureProvenance;
  proof: AuthoringCaptureProof;
};

/** Durable, bounded references attached to one committed App Map connection. */
export type AuthoringRecordingSource = {
  schemaVersion: 1;
  takeId: string;
  takeRevision: number;
  capture: AuthoringCaptureReview;
  evidenceIds: string[];
};

export const CONTROL_AND_RECORD_PROVENANCE: AuthoringCaptureProvenance = Object.freeze({
  schemaVersion: 1,
  mode: "control-and-record",
  origin: "relay-control",
});

/** Sessions written before capture provenance shipped were all produced by
 * Relay's existing control path. Normalizing that historical shape is exact,
 * and ensures every current projection states a mode. */
export function authoringCaptureProvenance(
  value?: AuthoringCaptureProvenance,
): AuthoringCaptureProvenance {
  return value ? structuredClone(value) : { ...CONTROL_AND_RECORD_PROVENANCE };
}

export function parseAuthoringCaptureProvenance(value: unknown): AuthoringCaptureProvenance {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("authoring capture provenance must be an object");
  }
  const input = value as Record<string, unknown>;
  if (input.schemaVersion !== 1) {
    throw new TypeError("authoring capture provenance schemaVersion must be 1");
  }
  if (input.mode === "control-and-record" && input.origin === "relay-control") {
    return { schemaVersion: 1, mode: input.mode, origin: input.origin };
  }
  if (input.mode === "watch-and-infer" && input.origin === "observed-transition") {
    return { schemaVersion: 1, mode: input.mode, origin: input.origin };
  }
  if (input.mode === "instrumented" && input.origin === "app-instrumentation") {
    return { schemaVersion: 1, mode: input.mode, origin: input.origin };
  }
  throw new TypeError("authoring capture provenance mode and origin do not agree");
}

export function captureProofForAuthoring(
  provenance: AuthoringCaptureProvenance,
  replayPassed: boolean,
): AuthoringCaptureProof {
  if (replayPassed) return "replay-proved";
  if (provenance.mode === "watch-and-infer") return "inferred-unproved";
  if (provenance.mode === "instrumented") return "instrumented-unproved";
  return "relay-controlled";
}

export function authoringCaptureNeedsReplay(provenance: AuthoringCaptureProvenance): boolean {
  return provenance.mode !== "control-and-record";
}

export function parseAuthoringCaptureReview(value: unknown): AuthoringCaptureReview {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("authoring capture review must be an object");
  }
  const input = value as Record<string, unknown>;
  if (input.schemaVersion !== 1) {
    throw new TypeError("authoring capture review schemaVersion must be 1");
  }
  const provenance = parseAuthoringCaptureProvenance(input.provenance);
  const proof = input.proof;
  const expectedUnproved = captureProofForAuthoring(provenance, false);
  if (typeof proof !== "string" || (proof !== expectedUnproved && proof !== "replay-proved")) {
    throw new TypeError("authoring capture review proof is incompatible with its provenance");
  }
  return { schemaVersion: 1, provenance, proof };
}
