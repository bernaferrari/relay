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
