import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTHORING_SESSION_STATES,
  parseAuthoringSession,
  serializeAuthoringSession,
  summarizeAuthoringOperationResult,
  type AuthoringSession,
} from "./authoring.js";

function session(state: AuthoringSession["state"]): AuthoringSession {
  return {
    schemaVersion: 1,
    id: "session-a",
    organizationId: "local",
    projectId: "project-a",
    actorId: "agent:a",
    actorKind: "agent",
    appMapId: "map-a",
    state,
    target: { kind: "device", platform: "android", targetId: "device-a" },
    leaseId: "lease-a",
    expectedAppMapRevision: 3,
    createdAt: 10,
    updatedAt: 11,
  };
}

test("every Authoring Session state has a stable deterministic representation", () => {
  for (const state of AUTHORING_SESSION_STATES) {
    const value = session(state);
    const reversed = Object.fromEntries(Object.entries(value).reverse()) as AuthoringSession;
    const encoded = serializeAuthoringSession(value);
    assert.equal(serializeAuthoringSession(reversed), encoded);
    assert.deepEqual(parseAuthoringSession(JSON.parse(encoded)), value);
  }
});

test("Authoring Session parsing rejects unknown lifecycle states", () => {
  assert.throws(
    () => parseAuthoringSession({ ...session("ready"), state: "paused" }),
    /unsupported authoring session state/,
  );
});

test("legacy Takes without raw capture remain wire-compatible", () => {
  const legacy: AuthoringSession = {
    ...session("reviewing"),
    take: {
      id: "take-before-raw-capture",
      state: "reviewing",
      createdAt: 10,
      updatedAt: 11,
      currentRevision: 1,
      revisions: [
        {
          id: "take-before-raw-capture:revision:1",
          takeId: "take-before-raw-capture",
          revision: 1,
          createdAt: 10,
          createdBy: "agent:a",
          reason: "recording",
          actions: [],
          evidence: [],
        },
      ],
      replayAttempts: [],
    },
  };

  const parsed = parseAuthoringSession(JSON.parse(serializeAuthoringSession(legacy)));
  assert.deepEqual(parsed, legacy);
  assert.equal(parsed.take?.rawCaptureVersion, undefined);
  assert.equal(parsed.take?.rawEvents, undefined);
});

test("agent mutation output summarizes a take without repeating evidence or semantic nodes", () => {
  const value: AuthoringSession = {
    ...session("reviewing"),
    sourceScreenId: "screen-start",
    take: {
      id: "take-a",
      state: "reviewing",
      createdAt: 10,
      updatedAt: 30,
      currentRevision: 2,
      revisions: [
        {
          id: "revision-a",
          takeId: "take-a",
          revision: 2,
          createdAt: 20,
          createdBy: "agent:a",
          reason: "manual",
          actions: [
            {
              id: "action-a",
              source: "manual",
              recordedAt: 20,
              startedAt: 20,
              finishedAt: 21,
              steps: [{ kind: "sleep", ms: 1_000 }],
              evidenceIds: ["evidence-a"],
              proofStatus: "pixels-only",
            },
          ],
          evidence: [
            {
              id: "evidence-a",
              kind: "snapshot",
              capturedAt: 20,
              uri: "relay-evidence://evidence-a",
            },
          ],
          before: {
            id: "observation-a",
            capturedAt: 20,
            screen: {
              id: "screen-a",
              fingerprint: "fingerprint-a",
              capturedAt: 20,
              source: "recording",
            },
            evidenceIds: ["evidence-a"],
            nodes: [{ label: "large semantic payload" }],
          },
        },
      ],
      replayAttempts: [
        {
          id: "replay-old",
          takeId: "take-a",
          takeRevision: 1,
          startedAt: 30,
          finishedAt: 35,
          outcome: "failed",
          evidence: [],
          error: "An older revision failed",
        },
        {
          id: "replay-a",
          takeId: "take-a",
          takeRevision: 2,
          startedAt: 40,
          finishedAt: 65,
          outcome: "passed",
          evidence: [],
          captureMode: "per-action",
          actionProofs: {
            "action-a": {
              actionId: "action-a",
              outcome: "passed",
              proofStatus: "pixels-only",
              transition: "unproven",
              entranceObservationId: "replay-before",
              exitObservationId: "replay-after",
              evidenceIds: ["evidence-a"],
            },
          },
        },
      ],
    },
  };

  const summarized = summarizeAuthoringOperationResult("authoring.session.stop", {
    session: value,
  });
  assert.deepEqual(summarized, {
    session: {
      id: "session-a",
      actorId: "agent:a",
      actorKind: "agent",
      appMapId: "map-a",
      state: "reviewing",
      target: { kind: "device", platform: "android", targetId: "device-a" },
      sourceScreenId: "screen-start",
      take: {
        id: "take-a",
        state: "reviewing",
        revision: 2,
        actionCount: 1,
        evidenceCount: 1,
        actions: [{ id: "action-a", stepCount: 1, proofStatus: "pixels-only" }],
        latestReplay: {
          id: "replay-a",
          outcome: "passed",
          takeRevision: 2,
          durationMs: 25,
          actionProofs: {
            "action-a": {
              outcome: "passed",
              proofStatus: "pixels-only",
              transition: "unproven",
            },
          },
        },
      },
    },
  });
  assert.doesNotMatch(JSON.stringify(summarized), /large semantic payload/);
  assert.deepEqual(summarizeAuthoringOperationResult("authoring.session.get", { session: value }), {
    session: value,
  });
});
