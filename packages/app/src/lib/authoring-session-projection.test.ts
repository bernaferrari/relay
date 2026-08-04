import assert from "node:assert/strict";
import test from "node:test";
import type { AuthoringSession } from "@relay/protocol";
import { mergeAuthoringSessionProjections } from "./authoring-session-projection";

function session(
  id: string,
  state: AuthoringSession["state"],
  updatedAt: number,
): AuthoringSession {
  return {
    schemaVersion: 1,
    id,
    organizationId: "local",
    projectId: "default",
    actorId: "human:one",
    actorKind: "human",
    appMapId: "map-one",
    state,
    target: { kind: "device", platform: "ios", targetId: "ipad" },
    leaseId: "lease-one",
    expectedAppMapRevision: 1,
    createdAt: 1,
    updatedAt,
  };
}

test("a stale list response cannot hide an active recording", () => {
  const result = mergeAuthoringSessionProjections(
    [session("one", "recording", 20)],
    [session("one", "ready", 10)],
  );
  assert.equal(result[0]?.state, "recording");
});

test("a newer terminal state wins without losing a just-created local session", () => {
  const result = mergeAuthoringSessionProjections(
    [session("one", "recording", 20), session("two", "preparing", 30)],
    [session("one", "reviewing", 40)],
  );
  assert.deepEqual(
    result.map(({ id, state }) => ({ id, state })),
    [
      { id: "one", state: "reviewing" },
      { id: "two", state: "preparing" },
    ],
  );
});

test("the action projection wins when timestamps tie", () => {
  const result = mergeAuthoringSessionProjections(
    [session("one", "recording", 20)],
    [session("one", "ready", 20)],
  );
  assert.equal(result[0]?.state, "recording");
});
