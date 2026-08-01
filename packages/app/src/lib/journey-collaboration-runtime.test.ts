import assert from "node:assert/strict";
import test from "node:test";
import { createCollaborativeJourneyDoc } from "@relay/collaboration";
import {
  JourneyCollaborationRuntime,
  normalizeAppCollaborationConfig,
} from "./journey-collaboration-runtime";
import { EMPTY_JOURNEY_METADATA } from "./journey-metadata";

test("collaboration is disabled by default and performs zero I/O", async () => {
  const doc = createCollaborativeJourneyDoc(EMPTY_JOURNEY_METADATA);
  const runtime = new JourneyCollaborationRuntime({
    config: normalizeAppCollaborationConfig(undefined),
    doc,
    scope: { projectId: "default", journeyId: "journey" },
    clientId: "client",
  });

  await runtime.start();
  runtime.updateAwareness({ activity: "editing", cursor: { x: 1, y: 2 } });
  let awarenessCount = -1;
  runtime.subscribeAwareness((awareness) => (awarenessCount = awareness.length));
  runtime.destroy();
  assert.equal(runtime.enabled, false);
  assert.equal(awarenessCount, 0);
  doc.destroy();
});

test("explicit boolean flag normalizes without enabling hidden fallbacks", () => {
  assert.deepEqual(normalizeAppCollaborationConfig(true), { enabled: true });
  assert.deepEqual(normalizeAppCollaborationConfig(false), { enabled: false });
});
