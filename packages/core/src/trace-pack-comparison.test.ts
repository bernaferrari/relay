import assert from "node:assert/strict";
import test from "node:test";
import { compareTracePacks } from "./trace-pack-comparison.js";
import { exportTracePack } from "./trace-pack.js";
import type { PersistedRun } from "./runs.js";

type FixtureOptions = {
  id: string;
  status?: "passed" | "failed";
  nodeLabel?: string;
  testId?: string;
  testName?: string;
  omitPath?: boolean;
  partialScreenshot?: boolean;
};

function runFixture(options: FixtureOptions): PersistedRun {
  const status = options.status ?? "passed";
  const testId = options.testId ?? "settings-localization";
  const testName = options.testName ?? "Settings localization";
  const artifacts: PersistedRun["artifacts"] = [
    {
      kind: "app-map-test-plan",
      capturedAt: 1,
      data: {
        schemaVersion: 1,
        appMapId: "settings",
        appMapRevision: 7,
        test: { id: testId, name: testName },
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
            label: options.nodeLabel ?? "Language",
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
        ...(options.omitPath
          ? {}
          : {
              warmSourceScreenId: "settings",
              transitionDependencies: [{ destination: { kind: "screen", screenId: "language" } }],
            }),
        ...(status === "failed" ? { error: "tap had no effect" } : {}),
      },
    },
  ];
  return {
    schemaVersion: 5,
    id: options.id,
    action: `app-map:settings:test:${testId}`,
    status: status === "passed" ? "ok" : "error",
    attempts: 1,
    queuedAt: 1,
    startedAt: 2,
    finishedAt: 4,
    logs: [],
    steps: [],
    frames: [],
    dir: "/portable-comparison-never-reads-this-path",
    writtenAt: 5,
    artifacts,
    inputDigest: "a".repeat(64),
    resolvedInputs: {},
    evidence: {
      schemaVersion: 1,
      runId: options.id,
      target: { kind: "device", platform: "android" },
      startedAt: 2,
      finishedAt: 4,
      channels: options.partialScreenshot
        ? {
            screenshot: {
              channel: "screenshot",
              status: "captured",
              entries: 1,
              bytes: 12,
              dropped: 0,
              redactions: 0,
            },
          }
        : {},
      events: [],
    } as unknown as PersistedRun["evidence"],
  };
}

test("compares historical reachability and matcher deltas without claiming a future pass", async () => {
  const proved = await exportTracePack(runFixture({ id: "run-proved" }));
  const failed = await exportTracePack(
    runFixture({ id: "run-failed", status: "failed", nodeLabel: "Locale" }),
  );

  const comparison = compareTracePacks([proved, failed]);

  assert.equal(comparison.testIdentity.status, "common");
  assert.equal(comparison.testIdentity.fact.classification, "recomputable");
  assert.equal(comparison.requiredPaths[0]?.path.status, "unchanged");
  assert.equal(comparison.requiredPaths[0]?.reachability.status, "regressed");
  assert.equal(
    comparison.requiredPaths[0]?.reachability.fact.classification,
    "historically-failed",
  );
  assert.deepEqual(
    comparison.matcherDeltas.map((delta) => ({
      checkId: delta.checkId,
      status: delta.status,
      classification: delta.fact.classification,
    })),
    [{ checkId: "open-language", status: "changed", classification: "recomputable" }],
  );
  assert.equal(comparison.futureTransitionVerdict, "unknown");
  assert.deepEqual(comparison.repairPolicy, { mutation: "none", requiresReview: true });
  assert.equal(comparison.smallestLiveVerification.kind, "replay-check");
  assert.equal(comparison.smallestLiveVerification.checkId, "open-language");
});

test("reports changed Test identity and explicit artifact-closure gaps", async () => {
  const first = await exportTracePack(runFixture({ id: "run-first" }));
  const changed = await exportTracePack(
    runFixture({
      id: "run-changed",
      testId: "settings-v2",
      testName: "Settings v2",
      partialScreenshot: true,
    }),
  );

  const comparison = compareTracePacks([first, changed]);

  assert.equal(comparison.testIdentity.status, "changed");
  assert.equal(comparison.completenessGaps.length, 1);
  assert.equal(comparison.completenessGaps[0]?.fact.classification, "unknowable");
  assert.match(comparison.completenessGaps[0]?.missing[0] ?? "", /artifact-reference-missing/u);
  assert.equal(comparison.smallestLiveVerification.kind, "recapture-required-evidence");
  assert.equal(comparison.smallestLiveVerification.tracePackDigest, changed.digest);
});

test("fails closed for unproved paths, duplicate packs, and altered manifests", async () => {
  const first = await exportTracePack(runFixture({ id: "run-one", omitPath: true }));
  const second = await exportTracePack(runFixture({ id: "run-two" }));

  const comparison = compareTracePacks([first, second]);
  assert.equal(comparison.requiredPaths[0]?.path.status, "not-provable");
  assert.equal(comparison.requiredPaths[0]?.path.fact.classification, "unknowable");
  assert.throws(() => compareTracePacks([first, first]), /unique content-addressed packs/u);

  const altered = structuredClone(second);
  altered.source.status = "error";
  assert.throws(() => compareTracePacks([first, altered]), /manifest integrity failed/u);
  assert.throws(() => compareTracePacks([first]), /between 2 and 64/u);
});

test("does not hide a middle-pack reachability change when history has three packs", async () => {
  const first = await exportTracePack(runFixture({ id: "run-three-first" }));
  const middle = await exportTracePack(runFixture({ id: "run-three-middle", status: "failed" }));
  const latest = await exportTracePack(runFixture({ id: "run-three-latest" }));

  const comparison = compareTracePacks([first, middle, latest]);

  assert.equal(comparison.requiredPaths[0]?.reachability.status, "changed");
  assert.equal(comparison.requiredPaths[0]?.reachability.fact.classification, "recomputable");
  assert.equal(comparison.smallestLiveVerification.checkId, "open-language");
});
