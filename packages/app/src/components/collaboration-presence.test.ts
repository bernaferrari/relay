import assert from "node:assert/strict";
import test from "node:test";
import type { CollaborationAwareness } from "@relay/protocol";
import { collaborationPresenceVisuals } from "./collaboration-presence";

test("human and agent presence projects to passive geometry without stealing local state", () => {
  const local = { selection: "local-screen", viewport: { x: 4, y: 8, scale: 0.8 }, focused: true };
  const before = structuredClone(local);
  const awareness: CollaborationAwareness[] = [
    {
      actorId: "human:two",
      actorKind: "human",
      displayName: "Mia",
      activity: "editing",
      cursor: { x: 12, y: 24 },
      selection: { screenId: "home" },
      updatedAt: 1,
      expiresAt: 2,
    },
    {
      actorId: "agent:map",
      actorKind: "agent",
      activity: "running",
      selection: { connectionId: "open-settings" },
      updatedAt: 1,
      expiresAt: 2,
    },
  ];
  const visuals = collaborationPresenceVisuals(awareness, {
    screenPositions: { home: { x: 40, y: 60 } },
    connectionPaths: { "open-settings": "M 0 0 L 10 10" },
  });

  assert.equal(visuals[0]?.label, "Mia");
  assert.deepEqual(visuals[0]?.screen?.position, { x: 40, y: 60 });
  assert.equal(visuals[1]?.label, "Agent");
  assert.equal(visuals[1]?.connection?.path, "M 0 0 L 10 10");
  assert.deepEqual(
    local,
    before,
    "render projection has no local focus/selection/viewport channel",
  );
});
