import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTHORING_SESSION_STATES,
  parseAuthoringSession,
  serializeAuthoringSession,
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
