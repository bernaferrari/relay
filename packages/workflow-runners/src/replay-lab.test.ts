import assert from "node:assert/strict";
import test from "node:test";
import { exportTracePack } from "@relay/core/trace-pack";
import type { PersistedRun } from "@relay/core/runs";
import { runReplayLab } from "./replay-lab.js";

function runFixture(id: string, status: "passed" | "failed"): PersistedRun {
  return {
    schemaVersion: 5,
    id,
    action: "app-map:settings:test:language",
    status: status === "passed" ? "ok" : "error",
    attempts: 1,
    queuedAt: 1,
    startedAt: 2,
    finishedAt: 4,
    logs: [],
    steps: [],
    frames: [],
    dir: "/portable-replay-lab-never-reads-this-path",
    writtenAt: 5,
    inputDigest: "a".repeat(64),
    resolvedInputs: {},
    artifacts: [
      {
        kind: "app-map-test-plan",
        capturedAt: 1,
        data: {
          schemaVersion: 1,
          appMapId: "settings",
          appMapRevision: 3,
          test: { id: "language", name: "Language" },
          recipes: {
            root: {
              steps: [
                {
                  kind: "module",
                  recipeId: "open-language",
                  check: { id: "open-language", title: "Open Language" },
                },
              ],
            },
            "open-language": {
              steps: [{ kind: "tap", id: "tap-language", target: { label: "Language" } }],
            },
          },
        },
      },
      {
        kind: "campaign-check-evidence",
        capturedAt: 2,
        data: {
          checkId: "open-language",
          attempts: [{ kind: "selector", data: { status: "resolved", strategy: "label" } }],
          nodes: [
            {
              role: "button",
              label: status === "passed" ? "Language" : "Locale",
              hittable: true,
              rect: { x: 10, y: 20, width: 100, height: 40 },
            },
          ],
        },
      },
      ...(status === "passed"
        ? [
            {
              kind: "campaign-transition-proof" as const,
              capturedAt: 3,
              data: { checkId: "open-language", status: "verified" },
            },
          ]
        : []),
      {
        kind: "campaign-check-result",
        capturedAt: 4,
        data: {
          id: "open-language",
          title: "Open Language",
          status,
          warmSourceScreenId: "settings",
          transitionDependencies: [{ destination: { kind: "screen", screenId: "language" } }],
        },
      },
    ],
    evidence: {
      schemaVersion: 1,
      runId: id,
      target: { kind: "device", platform: "android" },
      startedAt: 2,
      finishedAt: 4,
      channels: {},
      events: [],
    } as unknown as PersistedRun["evidence"],
  };
}

test("Replay Lab ranks bounded historical hypotheses and keeps future behavior unknown", async () => {
  const first = await exportTracePack(runFixture("replay-first", "passed"));
  const latest = await exportTracePack(runFixture("replay-latest", "failed"));
  const report = await runReplayLab({
    kind: "replay-lab",
    analysis: "compare",
    tracePacks: [first, latest],
  });

  assert.equal(report.comparison?.requiredPaths[0]?.reachability.status, "regressed");
  assert.equal(report.hypotheses[0]?.kind, "reachability-change");
  assert.equal(report.hypotheses[0]?.classification, "historically-observed");
  assert.equal(report.smallestLiveExperiment.kind, "replay-check");
  assert.equal(report.futureTransitionVerdict, "unknown");
  assert.deepEqual(report.repairPolicy, { mutation: "none", requiresReview: true });

  const completeProjection = await runReplayLab({
    kind: "replay-lab",
    analysis: "all",
    tracePacks: [first, latest],
  });
  assert.ok(completeProjection.comparison);
  assert.ok(completeProjection.visualLocalization);
  assert.ok(completeProjection.hypotheses.length <= 32);
  assert.equal(completeProjection.smallestLiveExperiment.kind, "recapture-frame-evidence");
  assert.equal(completeProjection.futureTransitionVerdict, "unknown");
});
