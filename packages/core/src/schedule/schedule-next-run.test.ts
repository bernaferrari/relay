import assert from "node:assert/strict";
import test from "node:test";
import { computeScheduleNextRunAt } from "./schedule-next-run.js";

test("interval schedules advance from now", () => {
  assert.equal(computeScheduleNextRunAt(1_000, 60), 3_601_000);
});

test("hour schedules pick the next wall-clock hour in UTC", () => {
  const now = Date.UTC(2026, 8, 12, 7, 30, 0);
  const next = computeScheduleNextRunAt(now, 1_440, 8, "UTC");
  assert.equal(new Date(next).toISOString(), "2026-09-12T08:00:00.000Z");
});
