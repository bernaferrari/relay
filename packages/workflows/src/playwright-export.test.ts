import assert from "node:assert/strict";
import test from "node:test";
import type { GoalSessionAction, GoalSessionRecord } from "@relay/protocol";
import { GOAL_SESSION_SCHEMA_VERSION } from "@relay/protocol";
import { exportGoalSessionPlaywrightSpec } from "./playwright-export.js";

function action(
  id: string,
  interaction: GoalSessionAction["interaction"],
  status: GoalSessionAction["status"] = "acknowledged",
): GoalSessionAction {
  return {
    id,
    step: Number(id.split("-")[1] ?? 1),
    candidateId: "c1",
    label: id,
    interaction,
    status,
    observationDigestBefore: "sha256:" + "1".repeat(64),
    evidenceRefs: [],
    at: 1,
  };
}

function record(actions: GoalSessionAction[]): GoalSessionRecord {
  return {
    schemaVersion: GOAL_SESSION_SCHEMA_VERSION,
    id: "goal-export",
    goal: "Open settings and capture",
    target: {
      targetId: "goal-goal-export",
      platform: "browser",
      startUrl: "https://example.test/settings",
      authenticationFixtureReference: "authfx:00000000-0000-0000-0000-000000000007:7",
    },
    budget: { maxSteps: 10, maxDurationMs: 900_000 },
    status: "completed",
    step: actions.length,
    createdAt: 1,
    updatedAt: 2,
    observations: [],
    actions,
    findings: [],
  };
}

test("exports an acknowledged browser path with honest limitations", () => {
  const spec = exportGoalSessionPlaywrightSpec(
    record([
      action("action-1", { kind: "identifier", target: { identifier: "open-settings" } }),
      action("action-2", {
        kind: "fill",
        target: { identifier: "display-name" },
        value: "Ada",
        mode: "replace",
      }),
      action("action-3", { kind: "key", key: "back" }),
      action("action-4", { kind: "wait", ms: 1500 }),
      action("action-5", { kind: "capture", label: "capture" }),
      action("action-6", { kind: "point", target: { point: { x: 10, y: 20 } } }),
      action("action-7", { kind: "identifier", target: { identifier: "x" } }, "rejected"),
    ]),
  );
  assert.match(spec, /import \{ test \} from "@playwright\/test"/u);
  assert.match(spec, /page\.goto\("https:\/\/example\.test\/settings"\)/u);
  // rejected action is excluded
  assert.equal(spec.includes('"action-7"'), false);
  assert.match(spec, /\.fill\("Ada"\)/u);
  assert.match(spec, /page\.goBack\(\)/u);
  assert.match(spec, /waitForTimeout\(1500\)/u);
  assert.match(spec, /page\.mouse\.click\(10, 20\)/u);
  assert.match(spec, /account fixture authfx:/u);
  assert.match(spec, /identity claims do not export/u);
  assert.match(spec, /is NOT evidence/u);
  assert.match(spec, /Review manually/u);
});

test("fails closed without an acknowledged browser path", () => {
  assert.throws(() => exportGoalSessionPlaywrightSpec(record([])), /acknowledged/u);
  const native = {
    ...record([action("action-1", { kind: "identifier", target: { identifier: "s" } })]),
  };
  native.target = { ...native.target, platform: "android" as const };
  assert.throws(() => exportGoalSessionPlaywrightSpec(native), /browser/u);
  const noUrl = {
    ...record([action("action-1", { kind: "identifier", target: { identifier: "s" } })]),
  };
  noUrl.target = { targetId: "t", platform: "browser" as const };
  assert.throws(() => exportGoalSessionPlaywrightSpec(noUrl), /startUrl/u);
});
