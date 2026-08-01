import assert from "node:assert/strict";
import test from "node:test";
import type { CollaborationAwareness, CollaborationAwarenessPublishInput } from "@relay/protocol";
import { CollaborationAwarenessController, collaborationActivity } from "./collaboration-awareness";
import type { RelayAwarenessTransport } from "./relay-collaboration-transport";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function awareness(
  actorId: string,
  actorKind: CollaborationAwareness["actorKind"],
  now: number,
): CollaborationAwareness {
  return {
    actorId,
    actorKind,
    activity: actorKind === "agent" ? "running" : "editing",
    cursor: { x: actorKind === "agent" ? 80 : 20, y: 40 },
    updatedAt: now,
    expiresAt: now + 10_000,
  };
}

test("awareness publishes throttled local state and lists human and agent peers", async () => {
  const now = Date.now();
  const published: CollaborationAwarenessPublishInput[] = [];
  const removed: string[] = [];
  const peers = [awareness("human:two", "human", now), awareness("agent:map", "agent", now)];
  const transport: RelayAwarenessTransport = {
    actorId: "human:one",
    async publish(input) {
      published.push(input);
      return { journeyId: input.journeyId, awareness: awareness("human:one", "human", now) };
    },
    async list(journeyId) {
      return { journeyId, awareness: peers, serverTime: now };
    },
    async remove(journeyId) {
      removed.push(journeyId);
      return { journeyId, removed: true };
    },
  };
  const controller = new CollaborationAwarenessController({
    journeyId: "journey",
    transport,
    publishThrottleMs: 50,
    pollMs: 1_000,
    heartbeatMs: 1_000,
  });
  let remote: readonly CollaborationAwareness[] = [];
  controller.subscribe((next) => (remote = next));
  controller.start();
  controller.update({ activity: "editing", cursor: { x: 1, y: 2 } });
  controller.update({ activity: "editing", cursor: { x: 3, y: 4 } });
  await wait(100);

  assert.deepEqual(
    remote.map((entry) => entry.actorKind),
    ["agent", "human"],
  );
  assert.ok(published.length <= 2, "rapid pointer updates remain throttled");
  assert.deepEqual(published.at(-1)?.cursor, { x: 3, y: 4 });
  controller.stop();
  await wait(0);
  assert.deepEqual(removed, ["journey"]);
  assert.deepEqual(remote, []);
  controller.destroy();
});

test("expired and local entries are never exposed", async () => {
  const now = Date.now();
  const transport: RelayAwarenessTransport = {
    actorId: "human:one",
    async publish(input) {
      return { journeyId: input.journeyId, awareness: awareness("human:one", "human", now) };
    },
    async list(journeyId) {
      return {
        journeyId,
        awareness: [
          awareness("human:one", "human", now),
          { ...awareness("agent:old", "agent", now), expiresAt: now - 1 },
        ],
        serverTime: now,
      };
    },
    async remove(journeyId) {
      return { journeyId, removed: true };
    },
  };
  const controller = new CollaborationAwarenessController({
    journeyId: "journey",
    transport,
    pollMs: 1_000,
    heartbeatMs: 1_000,
  });
  controller.start();
  await wait(0);
  assert.deepEqual(controller.snapshot, []);
  controller.destroy();
});

test("remote presence expires locally between polls", async () => {
  const now = Date.now();
  const transport: RelayAwarenessTransport = {
    actorId: "human:one",
    async publish(input) {
      return { journeyId: input.journeyId, awareness: awareness("human:one", "human", now) };
    },
    async list(journeyId) {
      return {
        journeyId,
        awareness: [{ ...awareness("agent:brief", "agent", now), expiresAt: now + 25 }],
        serverTime: now,
      };
    },
    async remove(journeyId) {
      return { journeyId, removed: true };
    },
  };
  const controller = new CollaborationAwarenessController({
    journeyId: "journey",
    transport,
    pollMs: 1_000,
    heartbeatMs: 1_000,
  });
  controller.start();
  await wait(5);
  assert.equal(controller.snapshot.length, 1);
  await wait(35);
  assert.equal(controller.snapshot.length, 0);
  controller.destroy();
});

test("activity precedence is obvious and deterministic", () => {
  assert.equal(
    collaborationActivity({ recording: true, running: true, editing: true }),
    "recording",
  );
  assert.equal(
    collaborationActivity({ recording: false, running: true, editing: true }),
    "running",
  );
  assert.equal(
    collaborationActivity({ recording: false, running: false, editing: true }),
    "editing",
  );
  assert.equal(collaborationActivity({ recording: false, running: false, editing: false }), "idle");
});
