import assert from "node:assert/strict";
import test from "node:test";
import type { RunChip } from "../context/workbench";
import { checkpointReasonLabel, chipFacts, reviewedRunFacts } from "./run-panel-presentation";

const diskRun = {
  kind: "disk",
  id: "run-1",
  ts: 1_700_000_000_000,
  run: {
    id: "run-1",
    action: "login",
    status: "error" as const,
    queuedAt: 1_700_000_000_000,
    writtenAt: 1_700_000_001_000,
    durationMs: 1000,
    serial: "device-long-serial",
    error: "The target was not available",
    attempts: 1,
    dir: "",
    frames: [],
    steps: [],
    logs: [],
  },
} as unknown as RunChip;

test("run presentation uses concise user-facing status facts", () => {
  const facts = chipFacts(diskRun, 1_700_000_002_000, [
    { serial: "device-long-serial", name: "Pixel 9" },
  ]);
  assert.equal(facts.word, "Failed");
  assert.match(facts.label, /Failed/);
  assert.match(facts.detail, /Pixel 9/);
  const reviewed = reviewedRunFacts(diskRun, 1_700_000_002_000, []);
  assert.ok(reviewed);
  assert.equal(reviewed.word, "Failed");
});

test("checkpoint labels avoid internal reason values", () => {
  assert.equal(checkpointReasonLabel("consent"), "Approval needed");
  assert.equal(checkpointReasonLabel("unknown"), "Human checkpoint");
});
