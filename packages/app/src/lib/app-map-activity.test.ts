import assert from "node:assert/strict";
import test from "node:test";
import type { ActivityEvent } from "@relay/protocol";
import { activitySummary, collapseActivity } from "./app-map-activity";

const activity = (overrides: Partial<ActivityEvent>): ActivityEvent => ({
  id: "event",
  organizationId: "org",
  projectId: "project",
  appMapId: "map",
  actorId: "human",
  actorKind: "human",
  eventType: "app-map.committed",
  subject: { kind: "app-map", id: "map" },
  summary: "Moved Settings",
  at: 1_000,
  beforeRevision: 1,
  afterRevision: 2,
  ...overrides,
});

test("adjacent autosaves collapse without merging distinct edits", () => {
  const rows = collapseActivity([
    activity({ id: "older", at: 1_000 }),
    activity({ id: "newer", at: 2_000 }),
    activity({ id: "different", at: 3_000, summary: "Connected Settings to Wi-Fi" }),
  ]);

  assert.deepEqual(
    rows.map((row) => ({ summary: row.event.summary, count: row.count })),
    [
      { summary: "Connected Settings to Wi-Fi", count: 1 },
      { summary: "Moved Settings", count: 2 },
    ],
  );
});

test("legacy generic activity hides implementation details", () => {
  assert.equal(activitySummary(activity({ summary: "Updated map" })), "Edited map");
  assert.equal(activitySummary(activity({ summary: "Updated App Map canvas" })), "Edited map");
  assert.equal(
    activitySummary(
      activity({
        eventType: "screen.updated",
        summary: "Updated screen screen-01JQ1A2B3C",
      }),
    ),
    "Updated screen",
  );
  assert.equal(activitySummary(activity({ summary: "Moved Settings" })), "Moved Settings");
});
