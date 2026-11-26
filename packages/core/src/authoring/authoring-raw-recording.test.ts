import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTHORING_RAW_CAPTURE_VERSION,
  type AuthoringAction,
  type AuthoringObservation,
  type AuthoringTake,
  type AuthoringTarget,
} from "@relay/protocol";
import {
  appendAuthoringRawInteraction,
  appendAuthoringRawInteractionIntent,
  appendAuthoringRawInteractionOutcome,
  appendAuthoringRawObservation,
  pendingAuthoringRawInteractionIntents,
  proposeAuthoringRawOptimizations,
  redactAuthoringRawInteraction,
  seedAuthoringRawRecording,
} from "./authoring-raw-recording.js";

const target: AuthoringTarget = { kind: "device", platform: "ios", targetId: "device-a" };

function observation(id: string, capturedAt: number): AuthoringObservation {
  return {
    id,
    capturedAt,
    screen: {
      id,
      fingerprint: `screen-${id}`,
      capturedAt,
      source: "recording",
      deviceId: "device-a",
    },
    evidenceIds: [`evidence-${id}`],
    bounds: { width: 1_024, height: 768 },
  };
}

function action(id: string, startedAt: number, finishedAt: number): AuthoringAction {
  return {
    id,
    source: "captured",
    recordedAt: startedAt,
    startedAt,
    finishedAt,
    steps: [],
    evidenceIds: [`evidence-${id}`],
  };
}

function take(
  rawEvents: NonNullable<AuthoringTake["rawEvents"]>,
  rawCaptureVersion: AuthoringTake["rawCaptureVersion"] = AUTHORING_RAW_CAPTURE_VERSION,
): AuthoringTake {
  return {
    id: "take-a",
    state: "reviewing",
    createdAt: 1,
    updatedAt: 4,
    currentRevision: 1,
    revisions: [],
    replayAttempts: [],
    rawCaptureVersion,
    rawEvents,
  };
}

test("raw authoring intent and outcome append in order without mutating their source", () => {
  const before = observation("before", 10);
  const seed = seedAuthoringRawRecording({
    target,
    trigger: "recording",
    recordedAt: 11,
    observation: before,
  });
  const unchangedSeed = structuredClone(seed);
  assert.deepEqual(seed.rawEvents[0]?.source.captureProvenance, {
    schemaVersion: 1,
    mode: "control-and-record",
    origin: "relay-control",
  });

  const intent = appendAuthoringRawInteractionIntent(take(seed.rawEvents), {
    target,
    interaction: { kind: "tap", target: { identifier: "continue", point: { x: 11, y: 12 } } },
    startedAt: 12,
    entrance: before,
  });

  assert.ok(intent);
  assert.deepEqual(seed, unchangedSeed, "append must not rewrite the raw source object");
  assert.deepEqual(
    intent.rawEvents.map((event) => [event.sequence, event.kind]),
    [
      [1, "take-start"],
      [2, "interaction-intent"],
    ],
  );
  const interaction = intent.rawEvents[1];
  assert.ok(interaction && interaction.kind === "interaction-intent");
  assert.deepEqual(
    interaction.source.captureProvenance,
    seed.rawEvents[0]?.source.captureProvenance,
  );
  assert.deepEqual(interaction.links, {
    entranceObservationId: "before",
    evidenceIds: ["evidence-before"],
  });
  assert.equal(interaction.interaction.kind, "tap");
  assert.deepEqual(interaction.interaction.target, {
    strategies: ["identifier", "point"],
    point: { x: 11, y: 12 },
  });

  const completed = appendAuthoringRawInteractionOutcome(take(intent.rawEvents), {
    target,
    intentEventId: intent.intentEventId,
    outcome: "succeeded",
    finishedAt: 14,
    action: action("action-a", 12, 14),
    exit: observation("after", 14),
  });
  assert.ok(completed);
  const outcome = completed.rawEvents[2];
  assert.ok(outcome && outcome.kind === "interaction-outcome");
  assert.deepEqual(outcome, {
    id: outcome.id,
    sequence: 3,
    source: outcome.source,
    kind: "interaction-outcome",
    recordedAt: 14,
    intentEventId: intent.intentEventId,
    outcome: "succeeded",
    finishedAt: 14,
    links: {
      actionId: "action-a",
      exitObservationId: "after",
      evidenceIds: ["evidence-action-a"],
    },
  });
  assert.deepEqual(pendingAuthoringRawInteractionIntents(take(completed.rawEvents)), []);

  const observed = appendAuthoringRawObservation(take(completed.rawEvents), {
    target,
    recordedAt: 15,
    observation: observation("manual", 15),
  });
  assert.ok(observed);
  assert.deepEqual(
    observed.rawEvents.map((event) => event.sequence),
    [1, 2, 3, 4],
  );
  assert.equal(observed.rawEvents[3]?.kind, "observation");
});

test("raw authoring input summaries never retain typed or clipboard secrets", () => {
  const secret = "swordfish\n秘密";
  const typed = redactAuthoringRawInteraction({
    kind: "type",
    text: secret,
    target: { label: "Private recipient", text: secret, identifier: "recipient" },
    mode: "replace",
  });
  const clipboard = redactAuthoringRawInteraction({
    kind: "clipboard",
    action: "write",
    text: secret,
    expect: secret,
    target: { label: secret },
    match: "exact",
  });
  const serialized = JSON.stringify({ typed, clipboard });

  assert.doesNotMatch(serialized, /swordfish|秘密|Private recipient|recipient/u);
  assert.doesNotMatch(serialized, /sha(?:256)?|hash|digest/iu);
  assert.deepEqual(typed, {
    kind: "type",
    target: { strategies: ["identifier", "label", "text"] },
    mode: "replace",
    value: { redacted: true, length: 12, lineCount: 2, hasNonAscii: true },
  });
  assert.deepEqual(clipboard, {
    kind: "clipboard",
    action: "write",
    target: { strategies: ["label"] },
    value: { redacted: true, length: 12, lineCount: 2, hasNonAscii: true },
    expectation: { redacted: true, length: 12, lineCount: 2, hasNonAscii: true },
    match: "exact",
  });
});

test("raw interaction outcomes close a durable intent without copying failure diagnostics", () => {
  const seed = seedAuthoringRawRecording({
    target,
    trigger: "recording",
    recordedAt: 1,
    observation: observation("before", 1),
  });
  const failedIntent = appendAuthoringRawInteractionIntent(take(seed.rawEvents), {
    target,
    interaction: {
      kind: "type",
      text: "private failure value",
      target: { label: "private selector", identifier: "private-id" },
    },
    startedAt: 2,
    entrance: observation("before", 1),
  });
  assert.ok(failedIntent);
  const failed = appendAuthoringRawInteractionOutcome(take(failedIntent.rawEvents), {
    target,
    intentEventId: failedIntent.intentEventId,
    outcome: "failed",
    finishedAt: 3,
  });
  assert.ok(failed);

  const unknownIntent = appendAuthoringRawInteractionIntent(take(failed.rawEvents), {
    target,
    interaction: { kind: "clipboard", action: "paste", text: "private failure value" },
    startedAt: 4,
    entrance: observation("before", 1),
  });
  assert.ok(unknownIntent);
  const unknown = appendAuthoringRawInteractionOutcome(take(unknownIntent.rawEvents), {
    target,
    intentEventId: unknownIntent.intentEventId,
    outcome: "unknown",
    finishedAt: 5,
  });
  assert.ok(unknown);

  const outcomes = unknown.rawEvents.filter((event) => event.kind === "interaction-outcome");
  assert.deepEqual(
    outcomes.map((event) => event.outcome),
    ["failed", "unknown"],
  );
  assert.deepEqual(pendingAuthoringRawInteractionIntents(take(unknown.rawEvents)), []);
  assert.doesNotMatch(
    JSON.stringify(unknown),
    /private failure value|private selector|private-id/u,
  );
  assert.throws(
    () =>
      appendAuthoringRawInteractionOutcome(take(unknown.rawEvents), {
        target,
        intentEventId: failedIntent.intentEventId,
        outcome: "failed",
        finishedAt: 6,
      }),
    /already has a terminal outcome/,
  );
});

test("raw optimization proposals are deterministic, review-only, and leave Take data intact", () => {
  const seed = seedAuthoringRawRecording({
    target,
    trigger: "recording",
    recordedAt: 1,
    observation: observation("before", 1),
  });
  const observedIntent = appendAuthoringRawInteractionIntent(take(seed.rawEvents), {
    target,
    interaction: { kind: "observe", label: "Sensitive generated copy" },
    startedAt: 2,
    entrance: observation("before", 1),
  });
  assert.ok(observedIntent);
  const observed = appendAuthoringRawInteractionOutcome(take(observedIntent.rawEvents), {
    target,
    intentEventId: observedIntent.intentEventId,
    outcome: "succeeded",
    finishedAt: 2,
    action: action("observe-a", 2, 2),
    exit: observation("after-observe", 2),
  });
  assert.ok(observed);
  const waitIntent = appendAuthoringRawInteractionIntent(take(observed.rawEvents), {
    target,
    interaction: { kind: "wait", ms: 500 },
    startedAt: 3,
    entrance: observation("after-observe", 2),
  });
  assert.ok(waitIntent);
  const waited = appendAuthoringRawInteractionOutcome(take(waitIntent.rawEvents), {
    target,
    intentEventId: waitIntent.intentEventId,
    outcome: "succeeded",
    finishedAt: 503,
    action: action("wait-a", 3, 503),
    exit: observation("after-wait", 503),
  });
  assert.ok(waited);
  const recorded = take(waited.rawEvents);
  const beforeProposal = structuredClone(recorded);

  const first = proposeAuthoringRawOptimizations(recorded);
  const second = proposeAuthoringRawOptimizations(recorded);

  assert.deepEqual(first, second);
  assert.deepEqual(
    recorded,
    beforeProposal,
    "proposal generation must not alter source or revision",
  );
  assert.deepEqual(
    first?.suggestions.map((item) => [item.kind, item.actionId]),
    [
      ["review-observe-only", "observe-a"],
      ["review-wait", "wait-a"],
    ],
  );
  assert.equal(first?.reviewOnly, true);
  assert.doesNotMatch(JSON.stringify(first), /Sensitive generated copy/u);
});

test("older Takes without a raw stream remain valid and are never backfilled", () => {
  const legacy: Pick<AuthoringTake, "id" | "currentRevision" | "rawCaptureVersion" | "rawEvents"> =
    {
      id: "legacy-take",
      currentRevision: 3,
    };
  const appended = appendAuthoringRawObservation(legacy, {
    target,
    recordedAt: 5,
    observation: observation("old", 5),
  });

  assert.equal(appended, undefined);
  assert.equal(proposeAuthoringRawOptimizations(legacy), undefined);
  assert.deepEqual(legacy, { id: "legacy-take", currentRevision: 3 });
});

test("version 1 raw Takes retain their completed-event representation", () => {
  const seed = seedAuthoringRawRecording({
    target,
    trigger: "recording",
    recordedAt: 1,
    observation: observation("before", 1),
  });
  const legacy = appendAuthoringRawInteraction(take(seed.rawEvents, 1), {
    target,
    interaction: { kind: "wait", ms: 250 },
    action: action("legacy-action", 2, 252),
    entrance: observation("before", 1),
    exit: observation("after", 252),
  });

  assert.ok(legacy);
  assert.equal(legacy.rawCaptureVersion, 1);
  assert.equal(legacy.rawEvents.at(-1)?.kind, "interaction");
  assert.equal(
    appendAuthoringRawInteractionIntent(take(legacy.rawEvents, 1), {
      target,
      interaction: { kind: "wait", ms: 1 },
      startedAt: 253,
    }),
    undefined,
  );
  assert.deepEqual(
    proposeAuthoringRawOptimizations(take(legacy.rawEvents, 1))?.suggestions.map(
      (item) => item.actionId,
    ),
    ["legacy-action"],
  );
});
