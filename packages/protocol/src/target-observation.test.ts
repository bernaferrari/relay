import assert from "node:assert/strict";
import test from "node:test";
import { operationDefinition } from "./operations.js";
import { TARGET_OBSERVATION_MAX_CONTROLS } from "./target-observation.js";

function artifact(digit: string, kind: "image" | "structured-data", mime: string) {
  const sha256 = digit.repeat(64);
  return {
    status: "available" as const,
    artifact: {
      schemaVersion: 1 as const,
      id: `sha256:${sha256}`,
      integrity: { algorithm: "sha256" as const, sha256, bytes: 3 },
      media: { kind, mime },
      capturedAt: 10,
      provenance: { source: "authoring-evidence" as const, capture: "recorded" as const },
      retention: {
        scope: "workspace-content-addressed" as const,
        recoverability: "content-addressed" as const,
      },
      locations: [{ store: "authoring-evidence" as const, opaque: `evidence-${digit}` }],
    },
  };
}

function observation() {
  return {
    schemaVersion: 1 as const,
    target: { kind: "device" as const, platform: "android" as const, targetId: "pixel-9" },
    capturedAt: 11,
    pixels: {
      status: "captured" as const,
      capturedAt: 10,
      mime: "image/png" as const,
      bytes: 3,
      artifact: artifact("a", "image", "image/png"),
      presentationBase64: "cG5n",
    },
    semantics: {
      status: "current" as const,
      capturedAt: 11,
      artifact: artifact("b", "structured-data", "application/json"),
      nodeCount: 1,
      controls: [{ label: "Settings", role: "button" }],
    },
  };
}

test("target observation is one lease-free read-only operation with durable artifact refs", () => {
  const definition = operationDefinition("target.observation.capture");
  assert.equal(definition.transport.method, "GET");
  assert.equal(definition.transport.path, "/observation");
  assert.equal(definition.lease, "none");
  assert.deepEqual(definition.output.parse(observation()), observation());
});

test("target observation rejects host paths and unbounded semantic summaries", () => {
  const definition = operationDefinition("target.observation.capture");
  const pathLeak = observation();
  pathLeak.pixels.artifact.artifact.locations[0]!.opaque = "/private/tmp/capture.png";
  assert.throws(() => definition.output.parse(pathLeak), /must not expose a host path/u);

  const tooManyControls = observation();
  tooManyControls.semantics.controls = Array.from(
    { length: TARGET_OBSERVATION_MAX_CONTROLS + 1 },
    (_, index) => ({ label: `Control ${index}`, role: "button" }),
  );
  assert.throws(() => definition.output.parse(tooManyControls), /exceeds the public bound/u);
});
