import { describe, expect, it } from "vitest";
import type { ProductRunSummary } from "@relay/product/catalog";
import { checkState, latestRunPerTest } from "./plan-checklist";

const scope = { appMapId: "grok", combineId: "prompts" };

const run = (patch: Partial<ProductRunSummary>): ProductRunSummary =>
  ({
    id: "run",
    title: "t",
    action: "a",
    status: "ok",
    phase: "completed",
    queuedAt: 1,
    ...scope,
    identity: { runId: "run" },
    links: { self: "/runs/run" },
    ...patch,
  }) as ProductRunSummary;

const summary = (patch: Record<string, number>) => ({
  captured: 1,
  missing: 0,
  pending: 0,
  accepted: 0,
  issue: 0,
  needMoreEvidence: 0,
  ...patch,
});

describe("plan checklist", () => {
  it("turns a run into the one state a person acts on", () => {
    expect(checkState(undefined)).toBe("not-run");
    expect(checkState(run({ phase: "running" }))).toBe("running");
    expect(checkState(run({ outcome: "passed" }))).toBe("passed");
    expect(checkState(run({ captureSummary: summary({ pending: 2, changed: 1 }) }))).toBe("review");
    expect(checkState(run({ phase: "failed" }))).toBe("failed");
    // A reported issue is a failure even when the run itself completed.
    expect(checkState(run({ captureSummary: summary({ issue: 1 }) }))).toBe("failed");
  });

  it("keeps only the newest run of each Test in the plan", () => {
    const latest = latestRunPerTest(
      [
        run({ id: "old", testId: "login", queuedAt: 1 }),
        run({ id: "new", testId: "login", queuedAt: 5 }),
        run({ id: "other", testId: "not-in-plan", queuedAt: 9 }),
      ],
      ["login", "checkout"],
      scope,
    );
    expect([...latest.entries()].map(([test, value]) => [test, value.id])).toEqual([
      ["login", "new"],
    ]);
  });

  it("excludes standalone, other Plan, other App and unattributed legacy results", () => {
    const latest = latestRunPerTest(
      [
        run({ id: "own", testId: "speed", queuedAt: 1 }),
        run({
          id: "standalone",
          testId: "speed",
          combineId: undefined,
          phase: "failed",
          queuedAt: 9,
        }),
        run({
          id: "other-plan",
          testId: "speed",
          combineId: "navigation",
          phase: "failed",
          queuedAt: 10,
        }),
        run({ id: "other-app", testId: "speed", appMapId: "other", phase: "failed", queuedAt: 11 }),
        run({
          id: "legacy",
          testId: "fast",
          combineId: undefined,
          title: "prompts",
          phase: "failed",
          queuedAt: 12,
        }),
      ],
      ["speed", "fast"],
      scope,
    );
    expect([...latest.values()].map((item) => item.id)).toEqual(["own"]);
  });
});
