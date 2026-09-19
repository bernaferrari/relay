import assert from "node:assert/strict";
import test from "node:test";
import type { TargetObservation } from "@relay/protocol";
import { compactGoalObservation } from "./goal-observation.js";

function observation(): TargetObservation {
  return {
    schemaVersion: 1,
    target: { kind: "browser", platform: "browser", targetId: "browser:test" },
    capturedAt: 10,
    pixels: {
      status: "captured",
      capturedAt: 10,
      mime: "image/png",
      bytes: 100,
      artifact: {
        status: "missing",
        source: "run-frame",
        media: { kind: "image", mime: "image/png" },
      },
      presentationBase64: "must-not-leak",
    },
    semantics: {
      status: "current",
      capturedAt: 10,
      artifact: {
        status: "missing",
        source: "run-artifact",
        media: { kind: "structured-data" },
      },
      nodeCount: 2,
      controls: [
        { role: "button", label: "Save", identifier: "save", enabled: true },
        { role: "textbox", label: "Display name", text: "Ada Lovelace", enabled: true },
      ],
    },
    screenCandidate: { fingerprint: "screen-1", confidence: "observed" },
  };
}

test("compactGoalObservation creates observation-scoped candidates and omits pixels", () => {
  const result = compactGoalObservation({
    goal: "Save the profile",
    sessionId: "session-1",
    targetId: "browser:test",
    platform: "browser",
    observation: observation(),
    recentActions: [{ id: "a1", kind: "observe", outcome: "acknowledged", summary: "ok" }],
  });

  assert.deepEqual(
    result.candidates.map((item) => item.id),
    ["c1", "c2"],
  );
  assert.equal(result.candidates[1]?.text, "[REDACTED]");
  assert.equal("pixels" in result, false);
  assert.equal(result.redacted, true);
  assert.match(result.observationDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(result).includes("must-not-leak"), false);
});

test("compactGoalObservation changes its digest when the observed controls change", () => {
  const first = compactGoalObservation({
    goal: "Save the profile",
    sessionId: "session-1",
    targetId: "browser:test",
    platform: "browser",
    observation: observation(),
  });
  const changed = observation();
  changed.semantics.controls[0]!.label = "Delete";
  const second = compactGoalObservation({
    goal: "Save the profile",
    sessionId: "session-1",
    targetId: "browser:test",
    platform: "browser",
    observation: changed,
  });
  assert.notEqual(first.observationDigest, second.observationDigest);
});

test("compactGoalObservation reports truncation instead of hiding it", () => {
  const many = observation();
  many.semantics.controls = Array.from({ length: 55 }, (_, index) => ({
    role: "button",
    label: `Action ${index + 1}`,
    identifier: `action-${index + 1}`,
    enabled: true,
  }));
  const result = compactGoalObservation({
    goal: "Explore",
    sessionId: "session-1",
    targetId: "browser:test",
    platform: "browser",
    observation: many,
  });
  assert.equal(result.omissions.candidatesKept, 40);
  assert.equal(result.omissions.candidatesOmitted, 15);
  assert.equal(result.candidates.length, 40);
});

test("compactGoalObservation marks unknown-enabled controls as assumed, not proven", () => {
  const unknown = observation();
  unknown.semantics.controls = [
    { role: "button", label: "Maybe", identifier: "maybe" },
    { role: "button", label: "Surely", identifier: "surely", enabled: true },
    { role: "button", label: "Off", identifier: "off", enabled: false },
  ];
  const result = compactGoalObservation({
    goal: "Explore",
    sessionId: "session-1",
    targetId: "browser:test",
    platform: "browser",
    observation: unknown,
  });
  assert.deepEqual(
    result.candidates.map((item) => [item.enabled, item.enabledAssumed ?? false]),
    [
      [true, true],
      [true, false],
      [false, false],
    ],
  );
});

test("compactGoalObservation carries pixel status, timestamps, and runtime session identity", () => {
  const withRuntime = observation();
  const result = compactGoalObservation({
    goal: "Save the profile",
    sessionId: "session-1",
    targetId: "browser:test",
    platform: "browser",
    runtimeSessionId: "runtime-context-42",
    observation: withRuntime,
  });
  assert.equal(result.screen.pixels, "captured");
  assert.equal(result.screen.pixelsCapturedAt, 10);
  assert.equal(result.target.runtimeSessionId, "runtime-context-42");
  assert.equal(result.target.sessionId, "session-1");

  const noPixels = observation();
  noPixels.pixels = { status: "unavailable", message: "off" };
  const without = compactGoalObservation({
    goal: "Save the profile",
    sessionId: "session-1",
    targetId: "browser:test",
    platform: "browser",
    observation: noPixels,
  });
  assert.equal(without.screen.pixels, "unavailable");
  assert.equal(without.screen.pixelsCapturedAt, undefined);
  assert.equal(without.target.runtimeSessionId, undefined);
});
