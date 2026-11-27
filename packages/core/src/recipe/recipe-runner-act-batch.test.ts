import assert from "node:assert/strict";
import test from "node:test";
import type { Device } from "../device/device.js";
import {
  actCandidates,
  registerActDecider,
  runActStep,
  type ActObservation,
} from "./recipe-runner-act.js";
import type { ActObservationGeometry } from "./recipe-runner-act-decision.js";

const device = {} as Device;

function context() {
  const lines: string[] = [];
  const artifacts: { kind: string; capturedAt: number; data: unknown }[] = [];
  return { ctx: { log: (line: string) => lines.push(line), artifacts }, lines, artifacts };
}

const geometry: ActObservationGeometry = {
  scale: 2,
  imageWidth: 1_600,
  imageHeight: 1_200,
  viewportWidth: 800,
  viewportHeight: 600,
};

function screenWithGeometry(): ActObservation {
  return {
    candidates: actCandidates(
      [{ role: "button", label: "Save", rect: { x: 0, y: 0, width: 50, height: 20 } }],
      geometry,
    ),
    geometry,
  };
}

test("coordinate actuation without a proven mapping fails closed and tells the model why", async () => {
  const feedback: string[] = [];
  const unregister = registerActDecider(async (input) => {
    feedback.push(input.intent);
    return { action: "tap", point: { x: 10, y: 10 }, reason: "visual only" };
  });
  try {
    const { ctx, artifacts } = context();
    // No geometry on the observation: the target cannot prove the mapping.
    const observation: ActObservation = {
      candidates: actCandidates([
        { role: "button", label: "Save", rect: { x: 0, y: 0, width: 50, height: 20 } },
      ]),
    };
    await assert.rejects(
      runActStep(
        device,
        { kind: "act", intent: "tap the share icon", maxActions: 1 },
        ctx as never,
        async () => undefined,
        async () => observation,
      ),
      /within 1 action/u,
    );
    const refusal = artifacts.find(
      (artifact) =>
        artifact.kind === "act-decision" &&
        (artifact.data as { action?: string }).action === "coordinate-unavailable",
    );
    assert.ok(refusal, "the refusal is recorded rather than silently guessed");
  } finally {
    unregister();
  }
});

test("coordinate taps execute when the mapping is proven", async () => {
  const ran: { kind: string; target?: unknown }[] = [];
  const unregister = registerActDecider(async () => ({
    action: "tap",
    point: { x: 300, y: 200 },
    reason: "icon-only share button",
    finishesIntent: true,
  }));
  try {
    const { ctx } = context();
    await runActStep(
      device,
      { kind: "act", intent: "tap the share icon", maxActions: 2 },
      ctx as never,
      async (step) => {
        ran.push(step as { kind: string; target?: unknown });
      },
      async () => screenWithGeometry(),
    );
    assert.equal(ran.length, 1);
    assert.equal(ran[0]!.kind, "tap");
    assert.deepEqual((ran[0]!.target as { point: unknown }).point, {
      x: 150,
      y: 100,
      referenceBounds: { width: 800, height: 600 },
    });
  } finally {
    unregister();
  }
});

test("a batch aborts at the first failure and the evidence says exactly what ran", async () => {
  const ran: string[] = [];
  const unregister = registerActDecider(async () => ({
    action: "batch",
    actions: [
      { action: "type", text: "Ada", candidateId: "c1" },
      { action: "type", text: "Lovelace", candidateId: "c2" },
    ],
    reason: "fill the form",
  }));
  try {
    const { ctx, artifacts } = context();
    const observation: ActObservation = {
      candidates: actCandidates([
        { identifier: "first", type: "TextField", rect: { x: 0, y: 0, width: 50, height: 20 } },
        { identifier: "last", type: "TextField", rect: { x: 0, y: 30, width: 50, height: 20 } },
      ]),
    };
    await assert.rejects(
      runActStep(
        device,
        { kind: "act", intent: "fill the form", maxActions: 3 },
        ctx as never,
        async (step) => {
          if (step.kind === "type") {
            if (step.text === "Lovelace") throw new Error("field disappeared");
            ran.push(step.text);
          }
        },
        async () => observation,
      ),
      /field disappeared/u,
    );
    assert.deepEqual(ran, ["Ada"], "the failing item and everything after it did not run");
    const failure = artifacts.find(
      (artifact) =>
        artifact.kind === "act-decision" &&
        (artifact.data as { action?: string }).action === "batch-failed",
    );
    assert.ok(failure, "the partial batch is recorded");
    const data = failure!.data as { executedSteps: number; totalSteps: number };
    assert.equal(data.executedSteps, 1);
    assert.equal(data.totalSteps, 2);
  } finally {
    unregister();
  }
});

test("a finished batch replays as one ordered history entry", async () => {
  const ran: string[] = [];
  const unregister = registerActDecider(async () => ({
    action: "batch",
    actions: [
      { action: "type", text: "Ada", candidateId: "c1" },
      { action: "type", text: "Lovelace", candidateId: "c2", submit: true },
    ],
    finishesIntent: true,
    reason: "fill the form",
  }));
  try {
    const { ctx } = context();
    const observation: ActObservation = {
      candidates: actCandidates([
        { identifier: "first", type: "TextField", rect: { x: 0, y: 0, width: 50, height: 20 } },
        { identifier: "last", type: "TextField", rect: { x: 0, y: 30, width: 50, height: 20 } },
      ]),
    };
    await runActStep(
      device,
      { kind: "act", intent: "fill the form", maxActions: 3 },
      ctx as never,
      async (step) => {
        ran.push(step.kind);
      },
      async () => observation,
    );
    assert.deepEqual(ran, ["type", "type", "device"]);
  } finally {
    unregister();
  }
});
