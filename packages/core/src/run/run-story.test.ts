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

test("run story dest identity is dest wait-for, not leftover Close last-frame", () => {
  const story = buildRunStory({
    id: "run-dest",
    action: "observe",
    title: "Observe",
    status: "ok",
    frames: [
      { path: "frames/003.png", caption: "Observe" },
      { path: "frames/004.png", caption: "after · Run saved Test" },
    ],
    artifacts: [
      {
        kind: "campaign-check-result",
        capturedAt: 2,
        data: { title: "Wait for dest", status: "passed" },
      },
      {
        kind: "capture-review",
        capturedAt: 3,
        data: {
          caption: "Observe",
          framePath: "frames/003.png",
          phase: "dest",
          policy: "fast",
        },
      },
      {
        kind: "capture-review",
        capturedAt: 4,
        data: {
          caption: "Close",
          framePath: "frames/004.png",
          phase: "leftover",
        },
      },
    ],
  });
  const dest = story.beats.find((beat) => beat.kind === "dest-identity");
  assert.equal(dest?.evidence, "frames/003.png");
  assert.notEqual(dest?.evidence, "frames/004.png");
  assert.equal(
    story.beats.some((beat) => beat.evidence === "frames/004.png"),
    false,
  );
});
