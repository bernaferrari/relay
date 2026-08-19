import assert from "node:assert/strict";
import test from "node:test";
import type { DiscoveryExploreRun, DiscoveryJourney, DiscoveryJourneyStep } from "@relay/protocol";
import {
  journeyHeadline,
  journeyCursorSummary,
  journeyOutcomeSummary,
  journeyRows,
} from "./discovery-journey-presentation.js";

const step = (patch: Partial<DiscoveryJourneyStep> & { index: number }): DiscoveryJourneyStep => ({
  transitionId: `t${patch.index}`,
  kind: "tap",
  fromScreenId: "s0",
  changedScreen: true,
  capturedAt: 1_000 + patch.index,
  ...patch,
});

const journey = (steps: DiscoveryJourneyStep[]): DiscoveryJourney => ({
  sessionId: "session-1",
  mapName: "Grok",
  generatedAt: 2_000,
  status: "complete",
  stepCount: steps.length,
  steps,
});

const run = (patch: Partial<DiscoveryExploreRun> = {}): DiscoveryExploreRun => ({
  strategy: "surface",
  maxDepth: 2,
  startedAt: 1,
  updatedAt: 2,
  ...patch,
});

test("a step that opened a screen names the control and the destination", () => {
  const rows = journeyRows(
    journey([step({ index: 0, label: "Appearance", toScreenId: "s1", toTitle: "Appearance" })]),
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.action, "Tapped Appearance");
  assert.equal(rows[0]!.destination, "Appearance");
  assert.equal(rows[0]!.tone, "opened");
});

test("a step that changed nothing is kept and points at the screen it stayed on", () => {
  const rows = journeyRows(
    journey([
      step({
        index: 0,
        label: "Dead cell",
        changedScreen: false,
        fromScreenId: "s0",
        fromTitle: "Settings",
      }),
    ]),
  );
  assert.equal(rows[0]!.tone, "stayed");
  assert.equal(rows[0]!.destination, "Settings");
});

test("back navigation is labelled without inventing a control name", () => {
  const rows = journeyRows(
    journey([step({ index: 0, kind: "back", toScreenId: "s0", toTitle: "Settings" })]),
  );
  assert.equal(rows[0]!.action, "Went back");
  assert.equal(rows[0]!.tone, "back");
});

test("an untitled destination falls back to the screen id", () => {
  const rows = journeyRows(journey([step({ index: 0, toScreenId: "s7" })]));
  assert.equal(rows[0]!.destination, "s7");
});

test("a missing journey has no rows", () => {
  assert.deepEqual(journeyRows(undefined), []);
});

test("the headline counts distinct screens and steps", () => {
  const headline = journeyHeadline(
    journey([
      step({ index: 0, fromScreenId: "s0", toScreenId: "s1" }),
      step({ index: 1, fromScreenId: "s1", toScreenId: "s2" }),
      step({ index: 2, fromScreenId: "s2", toScreenId: "s0" }),
    ]),
  );
  assert.equal(headline, "3 screens over 3 steps");
});

test("the headline uses the singular form for one step", () => {
  assert.equal(
    journeyHeadline(journey([step({ index: 0, toScreenId: "s1" })])),
    "2 screens over 1 step",
  );
});

test("an empty journey says nothing has been walked yet", () => {
  assert.equal(journeyHeadline(journey([])), "No steps yet");
});

test("a running crawl has no outcome sentence", () => {
  assert.equal(journeyOutcomeSummary(run()), undefined);
  assert.equal(journeyOutcomeSummary(undefined), undefined);
});

test("the cursor exposes proven, unknown, and handoff truth without inference", () => {
  assert.deepEqual(
    journeyCursorSummary(
      run({
        navigationCursor: {
          schemaVersion: 1,
          status: "proven",
          screenId: "screen-settings",
          proofToken: "proof-1",
          source: "transition",
          updatedAt: 4,
        },
      }),
    ),
    { label: "Position proven", detail: "screen-settings", tone: "proven" },
  );
  assert.deepEqual(
    journeyCursorSummary(
      run({
        navigationCursor: {
          schemaVersion: 1,
          status: "unknown",
          reason: "Tap did not settle",
          updatedAt: 5,
        },
      }),
    ),
    { label: "Position unknown", detail: "Tap did not settle", tone: "unknown" },
  );
  assert.deepEqual(
    journeyCursorSummary(
      run({
        navigationCursor: {
          schemaVersion: 1,
          status: "external-handoff",
          foregroundApp: "com.android.settings",
          reason: "Opened app languages",
          updatedAt: 6,
        },
      }),
    ),
    { label: "External handoff", detail: "com.android.settings", tone: "handoff" },
  );
});

test("a completed crawl reports the depth it finished within", () => {
  assert.equal(
    journeyOutcomeSummary(run({ stopReason: { code: "complete", message: "done", at: 3 } })),
    "Explored every safe row within depth 2.",
  );
});

test("an external handoff is preserved for review instead of auto-recovered", () => {
  const summary = journeyOutcomeSummary(
    run({ stopReason: { code: "left_app", message: "gone", at: 3 } }),
  );
  assert.equal(summary, "Stopped at an external app handoff for review.");
});

test("an error stop surfaces the message verbatim", () => {
  assert.equal(
    journeyOutcomeSummary(run({ stopReason: { code: "error", message: "runner died", at: 3 } })),
    "Stopped on an error: runner died",
  );
});
