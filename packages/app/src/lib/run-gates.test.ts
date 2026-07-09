import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canRunRecipe,
  runBlocker,
  plannedStepsFromMeta,
  resolvePlannedTitles,
  isPackagedFlowSteps,
  summarizeRunHistory,
  stepStatusFromRun,
  clamp,
} from "./run-gates";

const base = {
  hasRecipe: true,
  health: "online",
  emptyDevices: false,
  source: "custom" as const,
  stepCount: 2,
  saveState: "saved" as const,
};

describe("canRunRecipe / runBlocker", () => {
  it("allows custom with steps when online + device", () => {
    assert.equal(canRunRecipe(base), true);
    assert.equal(runBlocker(base), "");
  });
  it("blocks empty custom", () => {
    const g = { ...base, stepCount: 0 };
    assert.equal(canRunRecipe(g), false);
    assert.equal(runBlocker(g), "Add a step");
  });
  it("blocks no device", () => {
    const g = { ...base, emptyDevices: true };
    assert.equal(canRunRecipe(g), false);
    assert.equal(runBlocker(g), "Connect a device");
  });
  it("blocks offline", () => {
    const g = { ...base, health: "offline" };
    assert.equal(canRunRecipe(g), false);
    assert.equal(runBlocker(g), "Server offline");
  });
  it("blocks invalid save", () => {
    const g = { ...base, saveState: "invalid" as const };
    assert.equal(canRunRecipe(g), false);
    assert.equal(runBlocker(g), "Fix incomplete steps");
  });
  it("allows builtin without local steps", () => {
    const g = { ...base, source: "builtin" as const, stepCount: 0, plannedCount: 5 };
    assert.equal(canRunRecipe(g), true);
    assert.equal(runBlocker(g), "");
  });
  it("no recipe is not runnable", () => {
    assert.equal(canRunRecipe({ ...base, hasRecipe: false }), false);
    assert.equal(runBlocker({ ...base, hasRecipe: false }), "");
  });
});

describe("plannedStepsFromMeta", () => {
  it("maps titles", () => {
    assert.deepEqual(plannedStepsFromMeta([{ title: "Open app" }, { title: "Tap X" }]), [
      { title: "Open app" },
      { title: "Tap X" },
    ]);
  });
  it("empty on missing", () => {
    assert.deepEqual(plannedStepsFromMeta(undefined), []);
    assert.deepEqual(plannedStepsFromMeta([]), []);
  });
});

describe("resolvePlannedTitles / isPackagedFlowSteps", () => {
  const actions = [
    {
      id: "reinstall-last-alpha",
      planned: [
        { title: "Ensure teachx Play account" },
        { title: "Reinstall Grok" },
        { title: "Restore home account" },
      ],
    },
  ];
  it("expands forked thin flow to planned titles", () => {
    const titles = resolvePlannedTitles({
      source: "custom",
      recipeId: "custom-1",
      steps: [{ kind: "flow", flow: "reinstall-last-alpha" }],
      actions,
    });
    assert.equal(titles.length, 3);
    assert.equal(titles[0]!.title, "Ensure teachx Play account");
  });
  it("does not expand free custom multi-step", () => {
    const titles = resolvePlannedTitles({
      source: "custom",
      recipeId: "custom-1",
      steps: [{ kind: "tap" }, { kind: "flow", flow: "reinstall-last-alpha" }],
      actions,
    });
    assert.equal(titles.length, 0);
  });
  it("detects packaged flow", () => {
    assert.equal(isPackagedFlowSteps([{ kind: "flow", flow: "x" }]), true);
    assert.equal(isPackagedFlowSteps([{ kind: "tap" }]), false);
  });
});

describe("summarizeRunHistory", () => {
  it("returns null when empty", () => {
    assert.equal(summarizeRunHistory([], "now"), null);
  });
  it("counts pass and fail", () => {
    const s = summarizeRunHistory([{ status: "error" }, { status: "ok" }, { status: "ok" }], "2m");
    assert.ok(s);
    assert.equal(s!.passed, 2);
    assert.equal(s!.failed, 1);
    assert.equal(s!.latestTone, "fail");
    assert.match(s!.summary, /2 passed · 1 failed · 2m/);
  });
  it("pass only", () => {
    const s = summarizeRunHistory([{ status: "ok" }, { status: "healed" }], "now");
    assert.equal(s!.summary, "2 passed · now");
    assert.equal(s!.latestTone, "pass");
  });
});

describe("stepStatusFromRun", () => {
  it("maps ok/healed/error", () => {
    const steps = [{ status: "ok" }, { status: "error" }, { status: "healed" }, {}];
    assert.equal(stepStatusFromRun(steps, 0), "pass");
    assert.equal(stepStatusFromRun(steps, 1), "fail");
    assert.equal(stepStatusFromRun(steps, 2), "pass");
    assert.equal(stepStatusFromRun(steps, 3), "idle");
  });
});

describe("clamp", () => {
  it("clamps", () => {
    assert.equal(clamp(5, 0, 10), 5);
    assert.equal(clamp(-1, 0, 10), 0);
    assert.equal(clamp(99, 0, 10), 10);
  });
});
