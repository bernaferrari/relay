import type { ArtifactRefProjection } from "./artifact-ref.js";
import type { OperationDefinition, RuntimeParser } from "./operation-contract.js";
import { operationInputContract } from "./operation-builders.js";
import { fail, number, objectParser, record, string } from "./operation-parser-primitives.js";
import {
  TARGET_OBSERVATION_MAX_CONTROLS,
  TARGET_OBSERVATION_MAX_PRESENTATION_BYTES,
  type TargetObservation,
} from "./target-observation.js";

function assertArtifactProjection(
  value: unknown,
  label: string,
): asserts value is ArtifactRefProjection {
  const projection = record(value, label);
  if (!new Set(["available", "missing", "redacted"]).has(String(projection.status))) {
    fail(`${label} status`, "is unsupported");
  }
  if (projection.status !== "available") {
    if (projection.source !== "authoring-evidence") {
      fail(`${label} source`, "must be authoring-evidence");
    }
    record(projection.media, `${label} media`);
    return;
  }
  const artifact = record(projection.artifact, `${label} artifact`);
  if (artifact.schemaVersion !== 1) fail(`${label} schemaVersion`, "must be 1");
  string(artifact.id, `${label} id`);
  const integrity = record(artifact.integrity, `${label} integrity`);
  if (integrity.algorithm !== "sha256") fail(`${label} algorithm`, "must be sha256");
  const digest = string(integrity.sha256, `${label} sha256`);
  if (!/^[a-f0-9]{64}$/.test(digest) || artifact.id !== `sha256:${digest}`) {
    fail(`${label} integrity`, "must have a canonical SHA-256 identity");
  }
  number(integrity.bytes, `${label} bytes`);
  record(artifact.media, `${label} media`);
  record(artifact.provenance, `${label} provenance`);
  record(artifact.retention, `${label} retention`);
  if (!Array.isArray(artifact.locations)) fail(`${label} locations`, "must be an array");
  for (const [index, locationValue] of artifact.locations.entries()) {
    const location = record(locationValue, `${label} location ${index}`);
    if (location.store !== "authoring-evidence") {
      fail(`${label} location ${index} store`, "must be authoring-evidence");
    }
    const opaque = string(location.opaque, `${label} location ${index} opaque`);
    if (opaque.startsWith("/") || /^file:/i.test(opaque)) {
      fail(`${label} location ${index} opaque`, "must not expose a host path");
    }
  }
}

function boundedMessage(value: unknown, label: string): void {
  if (value === undefined) return;
  if (string(value, label).length > 480) fail(label, "must be at most 480 characters");
}

export function createTargetObservationOperationDefinition(input: {
  assertTargetRuntimeReadiness(value: unknown, label: string): void;
}): OperationDefinition<"target.observation.capture", { serial: string }, TargetObservation> {
  const operationInput = objectParser<{ serial: string }>("target observation input", (value) => {
    if (!string(value.serial, "target observation serial").trim()) {
      fail("target observation serial", "must be non-empty");
    }
  });
  const output: RuntimeParser<TargetObservation> = objectParser<TargetObservation>(
    "durable target observation response",
    (value) => {
      if (value.schemaVersion !== 1) fail("target observation schemaVersion", "must be 1");
      const target = record(value.target, "target observation target");
      const isDevice =
        target.kind === "device" && ["android", "ios"].includes(String(target.platform));
      const isBrowser = target.kind === "browser" && target.platform === "browser";
      if (!isDevice && !isBrowser) {
        fail("target observation target", "must be an Android, iOS, or browser target");
      }
      string(target.targetId, "target observation targetId");
      number(value.capturedAt, "target observation capturedAt");

      const pixels = record(value.pixels, "target observation pixels");
      if (pixels.status === "captured") {
        number(pixels.capturedAt, "target observation pixels capturedAt");
        if (pixels.mime !== "image/png" && pixels.mime !== "image/jpeg") {
          fail("target observation pixels mime", "must be image/png or image/jpeg");
        }
        number(pixels.bytes, "target observation pixels bytes");
        assertArtifactProjection(pixels.artifact, "target observation pixels artifact");
        if (pixels.presentationBase64 !== undefined) {
          const base64 = string(pixels.presentationBase64, "target observation presentation");
          const maximumLength = Math.ceil(TARGET_OBSERVATION_MAX_PRESENTATION_BYTES / 3) * 4 + 4;
          if (base64.length > maximumLength || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
            fail("target observation presentation", "must be bounded base64");
          }
        }
      } else if (pixels.status === "unavailable") {
        boundedMessage(pixels.message, "target observation pixels message");
      } else {
        fail("target observation pixels status", "is unsupported");
      }

      const semantics = record(value.semantics, "target observation semantics");
      if (!["current", "stale", "unavailable"].includes(String(semantics.status))) {
        fail("target observation semantics status", "is unsupported");
      }
      assertArtifactProjection(semantics.artifact, "target observation semantics artifact");
      number(semantics.nodeCount, "target observation semantics nodeCount");
      if (!Array.isArray(semantics.controls)) {
        fail("target observation semantics controls", "must be an array");
      }
      if (semantics.controls.length > TARGET_OBSERVATION_MAX_CONTROLS) {
        fail("target observation semantics controls", "exceeds the public bound");
      }
      for (const [index, controlValue] of semantics.controls.entries()) {
        const control = record(controlValue, `target observation control ${index}`);
        if (control.rect !== undefined)
          record(control.rect, `target observation control ${index} rect`);
      }
      boundedMessage(semantics.message, "target observation semantics message");
      if (value.screenCandidate !== undefined) {
        const candidate = record(value.screenCandidate, "target observation screen candidate");
        string(candidate.fingerprint, "target observation screen candidate fingerprint");
        if (!["matched", "observed"].includes(String(candidate.confidence))) {
          fail("target observation screen candidate confidence", "is unsupported");
        }
      }
      if (value.readiness !== undefined) {
        input.assertTargetRuntimeReadiness(value.readiness, "target observation readiness");
      }
    },
  );
  return {
    id: "target.observation.capture",
    version: 1,
    label: "Capture durable target observation",
    category: "evidence",
    mode: "query",
    input: operationInputContract("target.observation.capture", operationInput),
    output,
    idempotency: "inherent",
    targetCapabilities: ["screenshot", "snapshot"],
    lease: "none",
    confirmation: "none",
    minimumRole: "viewer",
    progress: false,
    cancellable: false,
    transport: { method: "GET", path: "/observation" },
  };
}
