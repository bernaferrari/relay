import assert from "node:assert/strict";
import test from "node:test";
import type { AuthoringObservation } from "@relay/protocol";
import {
  hasAuthoringBusyControl,
  inferredAuthoringCompletionWait,
} from "./authoring-completion-wait.js";

function observation(busy: boolean): AuthoringObservation {
  const capturedAt = busy ? 1 : 2;
  return {
    id: String(capturedAt),
    capturedAt,
    evidenceIds: [],
    foregroundApp: "test.app",
    screen: {
      id: String(capturedAt),
      fingerprint: String(capturedAt),
      capturedAt,
      source: "recording",
    },
    proof: {
      schemaVersion: 1,
      captureOrder: "concurrent",
      pixels: { status: "captured", capturedAt, fingerprint: String(capturedAt) },
      semantics: { status: "current", capturedAt, fingerprint: String(capturedAt) },
    },
    nodes: [
      {
        index: 1,
        label: "Explain why sailboats need a keel.",
        bundleId: "test.app",
        type: "android.widget.TextView",
        rect: { x: 20, y: 100, width: 300, height: 60 },
      },
      {
        index: 2,
        label: busy ? "Stop message" : "Copy message",
        bundleId: "test.app",
        type: "android.widget.Button",
        hittable: true,
        enabled: true,
        rect: { x: 20, y: 200, width: 60, height: 60 },
      },
    ],
  };
}

test("observed busy-to-result transition learns bounded conditions, not elapsed review time", () => {
  const before = observation(true),
    after = observation(false);
  after.capturedAt = 3_600_000;
  assert.deepEqual(inferredAuthoringCompletionWait(before, after), {
    kind: "steps",
    applied: true,
    label: "Wait for result · Copy message",
    steps: [
      {
        kind: "wait-response",
        target: { label: "Copy message" },
        busyTarget: { label: "Stop message" },
        idleTarget: { label: "Copy message" },
        timeoutMs: 120_000,
      },
    ],
  });
});

test("unchanged pixels, stalled work, and cancellation alone do not establish completion", () => {
  const before = observation(true),
    after = observation(false);
  after.nodes = after.nodes!.slice(0, 1);
  assert.equal(inferredAuthoringCompletionWait(before, after), undefined);
  after.nodes!.push(...before.nodes!.slice(1));
  assert.equal(inferredAuthoringCompletionWait(before, after), undefined);
});

test("foreign conversations, stale semantics, and ambiguous result controls teach nothing", () => {
  const before = observation(true),
    after = observation(false);
  after.nodes![0]!.label = "A different conversation with another prompt.";
  assert.equal(inferredAuthoringCompletionWait(before, after), undefined);
  after.nodes![0]!.label = before.nodes![0]!.label;
  after.foregroundApp = "another.app";
  assert.equal(inferredAuthoringCompletionWait(before, after), undefined);
  after.foregroundApp = before.foregroundApp;
  after.proof!.semantics.status = "unavailable";
  assert.equal(inferredAuthoringCompletionWait(before, after), undefined);
  after.proof!.semantics.status = "current";
  after.nodes!.push({
    ...after.nodes![1],
    index: 3,
    rect: { x: 150, y: 200, width: 60, height: 60 },
  });
  assert.equal(inferredAuthoringCompletionWait(before, after), undefined);
});

test("an old result label cannot become new through whitespace, case or decoration", () => {
  for (const label of [
    "Copy message",
    "COPY MESSAGE",
    " Copy\nmessage ",
    "Copy message, previous answer",
  ]) {
    const before = observation(true);
    before.nodes!.push({ ...observation(false).nodes![1]!, index: 3, label });
    assert.equal(inferredAuthoringCompletionWait(before, observation(false)), undefined, label);
  }
});

test("busy and result controls from another app cannot teach a completion boundary", () => {
  const before = observation(true),
    after = observation(false);
  before.nodes![1]!.bundleId = "overlay.app";
  assert.equal(hasAuthoringBusyControl(before), false);
  assert.equal(inferredAuthoringCompletionWait(before, after), undefined);
  before.nodes![1]!.bundleId = "test.app";
  after.nodes![1]!.bundleId = "overlay.app";
  assert.equal(inferredAuthoringCompletionWait(before, after), undefined);
  after.nodes![1]!.bundleId = "test.app";
  before.screen.deviceId = "device-a";
  after.screen.deviceId = "device-b";
  assert.equal(inferredAuthoringCompletionWait(before, after), undefined);
});

test("cancellation and failure evidence with a new Copy control never teaches readiness", () => {
  for (const label of [
    "Response cancelled",
    "Generation failed",
    "Error: please retry",
    "Não foi possível concluir",
  ]) {
    const after = observation(false);
    after.nodes!.push({ index: 3, label, bundleId: "test.app", role: "alert" });
    assert.equal(inferredAuthoringCompletionWait(observation(true), after), undefined, label);
    if (label !== "Não foi possível concluir") {
      after.nodes![2]!.role = "text";
      assert.equal(inferredAuthoringCompletionWait(observation(true), after), undefined, label);
    }
  }
});

test("unsupported localized controls do not invent English replay conditions", () => {
  const before = observation(true),
    after = observation(false);
  before.nodes![1]!.label = "Parar resposta";
  after.nodes![1]!.label = "Copiar resposta";
  assert.equal(hasAuthoringBusyControl(before), false);
  assert.equal(inferredAuthoringCompletionWait(before, after), undefined);
});

test("identical answer text alone teaches nothing; a new Copy control teaches only a wait", () => {
  const before = observation(true),
    after = observation(false);
  const answer = {
    index: 4,
    bundleId: "test.app",
    label: "A keel helps prevent sideways drift and keeps a sailboat stable.",
  };
  before.nodes!.push(answer);
  after.nodes!.push({ ...answer });
  after.nodes = after.nodes!.filter((node) => node.index !== 2);
  assert.equal(inferredAuthoringCompletionWait(before, after), undefined);
  after.nodes!.push(observation(false).nodes![1]!);
  const inferred = inferredAuthoringCompletionWait(before, after);
  assert.equal(inferred?.kind, "steps");
  assert.ok(inferred?.kind === "steps" && inferred.applied === true);
  assert.ok(
    inferred?.kind === "steps" &&
      inferred.steps.every((step) => step.kind === "wait-response" && step.timeoutMs === 120_000),
  );
});
