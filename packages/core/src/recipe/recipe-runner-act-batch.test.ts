import assert from "node:assert/strict";
import test from "node:test";
import type { Device } from "../device/device.js";
import { InputOutcomeUnknownError } from "../device/input-not-dispatched.js";
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

function formObservation(): ActObservation {
  return {
    candidates: actCandidates([
      { identifier: "first", type: "TextField", rect: { x: 0, y: 0, width: 50, height: 20 } },
      { identifier: "last", type: "TextField", rect: { x: 0, y: 30, width: 50, height: 20 } },
    ]),
  };
}

function formBatchDecision() {
  return {
    action: "batch" as const,
    actions: [
      { action: "type" as const, text: "Ada", candidateId: "c1" },
      { action: "type" as const, text: "Lovelace", candidateId: "c2" },
    ],
    reason: "fill the form",
  };
}

function batchFailures(artifacts: { kind: string; data: unknown }[]) {
  return artifacts.filter(
    (artifact) =>
      artifact.kind === "act-decision" &&
      (artifact.data as { action?: string }).action === "batch-failed",
  );
}

test("a failed batch ends honestly, re-observes, and re-plans to completion", async () => {
  const ran: string[] = [];
  const seenHistory: string[][] = [];
  const decisions = [formBatchDecision(), { action: "done" as const, reason: "form is filled" }];
  const unregister = registerActDecider(async (input) => {
    seenHistory.push([...input.history]);
    return decisions.shift() ?? { action: "done", reason: "fallback" };
  });
  try {
    const { ctx, artifacts } = context();
    await runActStep(
      device,
      { kind: "act", intent: "fill the form", maxActions: 3 },
      ctx as never,
      async (step) => {
        if (step.kind === "type") {
          if (step.text === "Lovelace") throw new Error("field disappeared");
          ran.push(step.text);
        }
      },
      async () => formObservation(),
    );
    assert.deepEqual(ran, ["Ada"], "the failing item and everything after it did not run");
    const failures = batchFailures(artifacts);
    assert.equal(failures.length, 1, "the partial batch is recorded exactly once");
    const data = failures[0]!.data as {
      executedSteps: number;
      totalSteps: number;
      reason: string;
    };
    assert.equal(data.executedSteps, 1);
    assert.equal(data.totalSteps, 2);
    assert.match(data.reason, /field disappeared/u);
    // The second roundtrip carries exactly what ran and why the rest did not.
    assert.equal(seenHistory.length, 2);
    const feedback = seenHistory[1]!.at(-1) ?? "";
    assert.match(feedback, /Type into identifier first/u);
    assert.match(feedback, /batch aborted after 1 of 2/u);
    assert.match(feedback, /field disappeared/u);
    assert.match(feedback, /remaining actions did not run/u);
    assert.doesNotMatch(feedback, /Lovelace/u, "the feedback never claims the failed item ran");
    // Recovery ends the step through the ordinary model finish evidence.
    const result = artifacts.find((artifact) => artifact.kind === "act-result");
    assert.ok(result, "the step finishes instead of dying with the batch");
    const finish = result!.data as { source: string; steps: { kind: string }[] };
    assert.equal(finish.source, "model");
    assert.deepEqual(
      finish.steps.map((step) => step.kind),
      ["type"],
    );
  } finally {
    unregister();
  }
});

test("a persistently failing batch is bounded by the ordinary roundtrip budget", async () => {
  const ran: string[] = [];
  let decideCalls = 0;
  const unregister = registerActDecider(async () => {
    decideCalls += 1;
    return formBatchDecision();
  });
  try {
    const { ctx, artifacts } = context();
    await assert.rejects(
      runActStep(
        device,
        { kind: "act", intent: "fill the form", maxActions: 2 },
        ctx as never,
        async (step) => {
          if (step.kind === "type") {
            if (step.text === "Lovelace") throw new Error("field disappeared");
            ran.push(step.text);
          }
        },
        async () => formObservation(),
      ),
      /within 2 actions/u,
    );
    assert.equal(decideCalls, 3, "max roundtrips plus the final verdict, never more");
    assert.deepEqual(ran, ["Ada", "Ada"], "each executing attempt ran the prefix exactly once");
    assert.equal(batchFailures(artifacts).length, 2);
  } finally {
    unregister();
  }
});

test("a cancel inside a batch never re-plans", async () => {
  let decideCalls = 0;
  const unregister = registerActDecider(async () => {
    decideCalls += 1;
    return formBatchDecision();
  });
  try {
    const { ctx } = context();
    const cancellation = new Error("cancelled");
    cancellation.name = "JobCancelledError";
    await assert.rejects(
      runActStep(
        device,
        { kind: "act", intent: "fill the form", maxActions: 4 },
        ctx as never,
        async (step) => {
          if (step.kind === "type" && step.text === "Lovelace") throw cancellation;
        },
        async () => formObservation(),
      ),
      (error: unknown) => error === cancellation,
    );
    assert.equal(decideCalls, 1, "cancellation escapes instead of consuming recovery budget");
  } finally {
    unregister();
  }
});

test("an unknown-outcome input inside a batch never re-plans", async () => {
  let decideCalls = 0;
  const unregister = registerActDecider(async () => {
    decideCalls += 1;
    return formBatchDecision();
  });
  try {
    const { ctx, artifacts } = context();
    await assert.rejects(
      runActStep(
        device,
        { kind: "act", intent: "fill the form", maxActions: 4 },
        ctx as never,
        async (step) => {
          if (step.kind === "type" && step.text === "Lovelace") {
            throw new InputOutcomeUnknownError("acknowledgement lost");
          }
        },
        async () => formObservation(),
      ),
      /Input outcome unknown/u,
    );
    assert.equal(decideCalls, 1, "the device state is not honest enough to revise a plan");
    assert.equal(
      batchFailures(artifacts).length,
      1,
      "the partial batch is still recorded before the escape",
    );
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
