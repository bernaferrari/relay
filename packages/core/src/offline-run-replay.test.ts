import assert from "node:assert/strict";
import test from "node:test";
import type { PersistedRun } from "./runs.js";
import { replayPersistedRunOffline } from "./offline-run-replay.js";

const at = 1_787_175_782_645;

function relay40FailureFixture(): PersistedRun {
  const artifacts: PersistedRun["artifacts"] = [
    {
      kind: "app-map-test-plan",
      capturedAt: at,
      data: {
        schemaVersion: 1,
        appMapId: "grok-android-manual-v2",
        appMapRevision: 173,
        test: { id: "relay-40-fresh-v2", name: "Relay 40" },
        recipes: { birth: { steps: ["tap birth year", "expect Birth Year"] } },
      },
    },
    {
      kind: "campaign-transition-proof",
      capturedAt: at + 1,
      data: { checkId: "visit-settings", status: "verified" },
    },
    {
      kind: "campaign-check-result",
      capturedAt: at + 2,
      data: {
        id: "visit-settings",
        title: "Visit Settings",
        status: "passed",
        startedAt: at,
        finishedAt: at + 2,
        transitionDependencies: [{ destination: { kind: "screen", screenId: "settings" } }],
      },
    },
    {
      kind: "navigation-proof-cursor",
      capturedAt: at + 3,
      data: { schemaVersion: 1, status: "proven", screenId: "edit-profile", source: "transition" },
    },
    {
      kind: "campaign-transition-proof",
      capturedAt: at + 4,
      data: { checkId: "visit-edit-profile", status: "verified" },
    },
    {
      kind: "campaign-check-result",
      capturedAt: at + 5,
      data: {
        id: "visit-edit-profile",
        title: "Visit Edit profile",
        status: "passed",
        warmSourceScreenId: "settings",
        startedAt: at + 2,
        finishedAt: at + 5,
        transitionDependencies: [{ destination: { kind: "screen", screenId: "edit-profile" } }],
      },
    },
    {
      kind: "navigation-proof-cursor",
      capturedAt: at + 6,
      data: {
        schemaVersion: 1,
        status: "unknown",
        reason: "A device mutation invalidated the last proven screen.",
        previous: { screenId: "edit-profile" },
      },
    },
    {
      kind: "campaign-check-evidence",
      capturedAt: at + 7,
      data: {
        checkId: "visit-18-birth-year",
        error: "expect-screen: on unknown, not Birth Year",
        attempts: [
          {
            kind: "target-resolution",
            capturedAt: at + 6,
            data: { method: "label", strategy: "label", target: { label: "birth year" } },
          },
        ],
      },
    },
    {
      kind: "campaign-check-result",
      capturedAt: at + 8,
      data: {
        id: "visit-18-birth-year",
        title: "Visit Birth Year",
        status: "failed",
        warmSourceScreenId: "edit-profile",
        error: "expect-screen: on unknown, not Birth Year",
        startedAt: at + 5,
        finishedAt: at + 8,
        transitionDependencies: [{ destination: { kind: "screen", screenId: "birth-year" } }],
      },
    },
  ];

  for (let index = 0; index < 33; index += 1) {
    artifacts.push({
      kind: "campaign-check-result",
      capturedAt: at + 9 + index,
      data: {
        id: `later-${index + 1}`,
        title: `Later check ${index + 1}`,
        status: "failed",
        warmSourceScreenId: index === 0 ? "birth-year" : `unproved-${index}`,
        error: "expect-screen: on unknown",
        startedAt: at + 8 + index,
        finishedAt: at + 9 + index,
        transitionDependencies: [
          { destination: { kind: "screen", screenId: `unproved-${index + 1}` } },
        ],
      },
    });
  }

  return {
    schemaVersion: 5,
    id: "90560436-ae4b-4544-ae9d-86580b2aa766",
    action: "app-map:grok-android-manual-v2:test:relay-40-fresh-v2",
    status: "error",
    attempts: 1,
    queuedAt: at,
    logs: [],
    steps: [],
    frames: [{ path: "frames/003.png", caption: "Birth Year", capturedAt: at + 7 }],
    dir: "/ignored/offline-fixture",
    writtenAt: at + 100,
    artifacts,
    inputDigest: "fixture",
    resolvedInputs: {},
  };
}

test("offline replay finds the Birth Year no-op root and rejects its 33 cascades", () => {
  const report = replayPersistedRunOffline(relay40FailureFixture());

  assert.deepEqual(report.summary, {
    checks: 36,
    proved: 2,
    rootFailures: 1,
    invalidCascades: 33,
    independentFailures: 0,
  });
  assert.deepEqual(
    {
      id: report.firstRootFailure?.checkId,
      title: report.firstRootFailure?.title,
      kind: report.firstRootFailure?.kind,
    },
    {
      id: "visit-18-birth-year",
      title: "Visit Birth Year",
      kind: "action-no-op",
    },
  );
  assert.equal(report.checks[2]?.selectorAttempts[0]?.status, "resolved");
  assert.deepEqual(
    report.checks.slice(3).map((check) => check.replayStatus),
    Array.from({ length: 33 }, () => "invalid-cascade"),
  );
  assert.match(report.blockers[1]?.message ?? "", /33 later checks.*warm origins/i);
  assert.match(report.planDigest, /^[a-f0-9]{64}$/u);
  assert.equal(report.appMapRevision, 173);
});

test("offline replay is deterministic and never consults current authoring state", () => {
  const run = relay40FailureFixture();
  const first = replayPersistedRunOffline(run);
  const second = replayPersistedRunOffline(structuredClone(run));
  assert.deepEqual(second, first);

  const reorderedPlan = structuredClone(run);
  const plan = reorderedPlan.artifacts[0]!;
  plan.data = {
    recipes: { birth: { steps: ["tap birth year", "expect Birth Year"] } },
    test: { name: "Relay 40", id: "relay-40-fresh-v2" },
    appMapRevision: 173,
    appMapId: "grok-android-manual-v2",
    schemaVersion: 1,
  };
  assert.equal(replayPersistedRunOffline(reorderedPlan).planDigest, first.planDigest);
});

test("offline replay re-evaluates the Kids cleanup matcher from exact frozen inputs without faking a pass", () => {
  const run = structuredClone(relay40FailureFixture());
  const plan = run.artifacts.find((artifact) => artifact.kind === "app-map-test-plan")!;
  plan.data = {
    schemaVersion: 1,
    appMapId: "grok-android-manual-v2",
    appMapRevision: 173,
    test: { id: "relay-40-fresh-v2", name: "Relay 40" },
    rootRecipeId: "root",
    recipes: {
      root: {
        id: "root",
        steps: [
          {
            kind: "module",
            recipeId: "kids-cleanup",
            check: { id: "kids-cleanup", title: "Kids cleanup" },
          },
        ],
      },
      "kids-cleanup": {
        id: "kids-cleanup",
        steps: [
          {
            kind: "tap",
            id: "disable-kids",
            target: { label: "Kids Mode", role: "button" },
          },
        ],
      },
    },
  };
  const evidence = run.artifacts.find((artifact) => artifact.kind === "campaign-check-evidence")!;
  evidence.data = {
    checkId: "kids-cleanup",
    attempts: [
      {
        kind: "target-resolution-attempt",
        data: { strategy: "label", target: { label: "Kids Mode" }, error: "not resolved" },
      },
    ],
    nodes: [
      {
        role: "button",
        label: "Kids Mode",
        hittable: true,
        rect: { x: 20, y: 100, width: 320, height: 48 },
      },
    ],
  };
  const result = run.artifacts.find(
    (artifact) =>
      artifact.kind === "campaign-check-result" &&
      (artifact.data as { id?: unknown }).id === "visit-18-birth-year",
  )!;
  result.data = {
    ...(result.data as Record<string, unknown>),
    id: "kids-cleanup",
    title: "Kids cleanup",
    error: "cleanup target was unknown",
  };

  const report = replayPersistedRunOffline(run);
  const check = report.checks.find((candidate) => candidate.id === "kids-cleanup")!;

  assert.equal(check.replayStatus, "root-failure");
  assert.deepEqual(check.currentMatcher, {
    status: "resolved",
    comparison: "changed",
    inputDigest: check.currentMatcher?.inputDigest,
    evidence: check.currentMatcher?.evidence,
    selectors: [
      {
        recipeId: "kids-cleanup",
        recipeStepId: "disable-kids",
        stepKind: "tap",
        target: { label: "Kids Mode", role: "button" },
        status: "resolved",
        method: "label",
      },
    ],
  });
  assert.match(check.currentMatcher!.inputDigest, /^[a-f0-9]{64}$/u);
  assert.deepEqual(
    report.repairProposals.filter((proposal) => proposal.kind === "review-current-matcher"),
    [
      {
        id: `offline:${run.id}:kids-cleanup:review-current-matcher`,
        checkId: "kids-cleanup",
        kind: "review-current-matcher",
        reason:
          "The current pure matcher disagrees with the recorded selector result. Review the frozen target and evidence before proposing any map or test repair.",
        mutation: "none",
        requiresReview: true,
        evidence: check.currentMatcher!.evidence,
      },
    ],
  );
});
