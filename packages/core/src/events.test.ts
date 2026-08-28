import assert from "node:assert/strict";
import test from "node:test";
import { eventsAfter } from "./events.js";

test("an event cursor ahead of this server epoch is a stream gap", () => {
  const replay = eventsAfter(Number.MAX_SAFE_INTEGER);
  assert.equal(replay.gap, true);
  assert.ok(replay.latestAvailable < Number.MAX_SAFE_INTEGER);
});
