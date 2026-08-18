import assert from "node:assert/strict";
import test from "node:test";
import { buildRunStory } from "./run-story.js";

test("run story narrates campaign checks and stuck beats", () => {
  const story = buildRunStory({
    id: "run-1",
    action: "relay-40",
    title: "Relay 40",
    status: "paused",
    artifacts: [
      {
        kind: "campaign-check-result",
        capturedAt: 2,
        data: { title: "Open Settings", status: "passed" },
      },
      {
        kind: "campaign-recovery-intervention",
        capturedAt: 3,
        data: { checkTitle: "Language", reason: "leaf missed" },
      },
    ],
  });
  assert.equal(story.runId, "run-1");
  assert.match(story.summary, /stuck or failed/);
  assert.equal(story.beats.length, 2);
  assert.match(story.beats[1]!.text, /Stuck/);
});
