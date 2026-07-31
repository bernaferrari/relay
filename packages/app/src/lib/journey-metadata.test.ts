import assert from "node:assert/strict";
import test from "node:test";
import type { RecordingTake } from "../context/recorder";
import { EMPTY_JOURNEY_METADATA, metadataWithTake } from "./journey-metadata";

test("a paused take preserves its explicit graph source across review persistence", () => {
  const take: RecordingTake = {
    id: "take-1",
    recipeId: "journey-1",
    sourceScreenId: "screen-settings",
    startedAt: 10,
    group: "Settings",
    state: "review",
    steps: [{ id: "open-notifications", kind: "tap", target: { label: "Notifications" } }],
  };

  const metadata = metadataWithTake(EMPTY_JOURNEY_METADATA, take, "review");

  assert.equal(metadata.takes?.[0]?.sourceScreenId, "screen-settings");
  assert.equal(metadata.takes?.[0]?.steps[0]?.id, "open-notifications");
  assert.equal(EMPTY_JOURNEY_METADATA.takes?.length, 0);
});
