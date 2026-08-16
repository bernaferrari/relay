import assert from "node:assert/strict";
import test from "node:test";
import type { Recipe } from "./recipes.js";
import type { PersistedRun } from "./runs.js";
import {
  buildCampaignRepairTarget,
  campaignCheckRepairInput,
  listCampaignRepairTargets,
} from "./campaign-repair.js";

const at = 1_700_000_000_000;

function fixture(): PersistedRun {
  const rootRecovery: Recipe = {
    id: "confirm-open-navigation",
    title: "Canonical root recovery",
    source: "custom",
    steps: [{ kind: "app", action: "open", app: "ai.x.grok" }],
    createdAt: at,
    updatedAt: at,
  };
  const recovery: Recipe = {
    id: "usage:recover",
    title: "Usage · canonical recovery",
    source: "custom",
    steps: [
      {
        kind: "expect-screen",
        screenId: "settings",
        screenTitle: "Settings",
        fingerprint: "a".repeat(64),
        recovery: { strategy: "back", maxAttempts: 8 },
      },
      {
        kind: "tap",
        target: { label: "Usage" },
        navigationContract: {
          connectionId: "open-usage",
          expectedScreenId: "usage",
          expectedFingerprint: "b".repeat(64),
          evidenceIds: ["usage-evidence"],
        },
      },
      {
        kind: "expect-screen",
        screenId: "usage",
        screenTitle: "Usage",
        fingerprint: "b".repeat(64),
      },
    ],
    createdAt: at,
    updatedAt: at,
  };
  const sibling: Recipe = {
    id: "privacy:warm",
    title: "Privacy",
    source: "custom",
    steps: [{ kind: "tap", target: { label: "Privacy" } }],
    createdAt: at,
    updatedAt: at,
  };
  const root: Recipe = {
    id: "app-map:grok:test:settings:root:r7",
    title: "Settings coverage",
    source: "custom",
    steps: [
      {
        kind: "module",
        recipeId: "usage:warm",
        check: {
          id: "usage",
          title: "Usage",
          recovery: {
            groupId: "settings:usage",
            recipeId: rootRecovery.id,
            transitionId: "open-navigation",
            mode: "warm-transition",
          },
          transitionDependencies: [
            {
              connectionId: "open-navigation",
              originScreenId: "start",
              destination: { kind: "screen", screenId: "settings" },
            },
            {
              connectionId: "open-usage",
              originScreenId: "settings",
              destination: { kind: "screen", screenId: "usage" },
            },
          ],
        },
      },
      {
        kind: "module",
        recipeId: sibling.id,
        check: { id: "privacy", title: "Privacy" },
      },
    ],
    createdAt: at,
    updatedAt: at,
  };
  return {
    schemaVersion: 5,
    id: "run-source",
    action: root.id,
    title: root.title,
    serial: "device-1",
    platform: "android",
    status: "error",
    attempts: 1,
    queuedAt: at,
    startedAt: at + 1,
    finishedAt: at + 100,
    logs: [],
    steps: [],
    frames: [{ path: "frames/001.png", caption: "failed:usage", capturedAt: at + 90 }],
    dir: "/runs/run-source",
    writtenAt: at + 101,
    recipeSnapshot: root,
    recipeGraph: {
      [root.id]: root,
      [rootRecovery.id]: rootRecovery,
      [recovery.id]: recovery,
      [sibling.id]: sibling,
      "usage:warm": {
        id: "usage:warm",
        title: "Usage warm",
        source: "custom",
        steps: [{ kind: "module", recipeId: recovery.id }],
        createdAt: at,
        updatedAt: at,
      },
    },
    artifacts: [
      {
        kind: "app-map-test-plan",
        capturedAt: at,
        data: { appMapId: "grok", appMapRevision: 7, test: { id: "settings" } },
      },
      {
        kind: "campaign-check-evidence",
        capturedAt: at + 90,
        data: {
          checkId: "usage",
          error: "Expected Usage, observed Settings",
          screenIdentity: { fingerprint: "observed-settings" },
          chrome: { app: "Grok", header: "Settings" },
          accessibility: { available: true, nodeCount: 42 },
          attempts: [{ kind: "target-resolution-attempt", data: { target: { label: "Usage" } } }],
        },
      },
      {
        kind: "campaign-check-result",
        capturedAt: at + 91,
        data: {
          id: "usage",
          title: "Usage",
          status: "failed",
          error: "Expected Usage, observed Settings",
          startedAt: at + 50,
          finishedAt: at + 91,
          selectiveRepair: {
            status: "pending",
            recipeId: rootRecovery.id,
            groupId: "settings:usage",
          },
        },
      },
      {
        kind: "campaign-check-result",
        capturedAt: at + 99,
        data: {
          id: "privacy",
          title: "Privacy",
          status: "passed",
          startedAt: at + 92,
          finishedAt: at + 99,
        },
      },
    ],
    inputDigest: "source-digest",
    resolvedInputs: { locale: "en" },
  };
}

test("assembles one complete stable repair target without mutating source evidence", () => {
  const run = fixture();
  const before = structuredClone(run);
  const repair = buildCampaignRepairTarget(run, "usage");
  assert.ok(repair);
  assert.equal(repair.id, "run-source:usage");
  assert.equal(repair.defaultAction, "continue-and-report");
  assert.equal(repair.source.appMapRevision, 7);
  assert.equal(repair.expected.recipeId, "usage:recover");
  assert.equal(repair.expected.originScreenId, "settings");
  assert.equal(repair.expected.transitionId, "open-usage");
  assert.equal(repair.expected.screenId, "usage");
  assert.equal(repair.observed.error, "Expected Usage, observed Settings");
  assert.equal(repair.evidence.frames[0]?.path, "frames/001.png");
  assert.deepEqual(
    repair.actions.map(({ kind, available, mutation }) => ({ kind, available, mutation })),
    [
      { kind: "continue-and-report", available: true, mutation: "none" },
      { kind: "retry-check", available: true, mutation: "new-run" },
      { kind: "accept-current-proposal", available: false, mutation: "reviewed-proposal" },
      { kind: "repair-test-proposal", available: true, mutation: "reviewed-proposal" },
      { kind: "defer-check-proposal", available: false, mutation: "reviewed-proposal" },
    ],
  );
  assert.deepEqual(run, before, "building a repair target leaves the original run immutable");
});

test("builds a frozen one-check retry and omits successful siblings", () => {
  const run = fixture();
  const input = campaignCheckRepairInput(run, "usage");
  assert.equal(input.retryOf, run.id);
  assert.equal(input.recipeSnapshot?.steps.length, 2);
  const checkpoint = input.recipeSnapshot?.steps[0];
  assert.equal(checkpoint?.kind, "expect-screen");
  assert.equal(checkpoint?.kind === "expect-screen" ? checkpoint.screenId : undefined, "settings");
  assert.equal(checkpoint?.kind === "expect-screen" ? checkpoint.recovery : undefined, undefined);
  assert.equal(
    checkpoint?.kind === "expect-screen" ? checkpoint.repairCheckpoint?.sourceRunId : undefined,
    run.id,
  );
  const step = input.recipeSnapshot?.steps[1];
  assert.equal(step?.kind, "module");
  assert.equal(step?.kind === "module" ? step.recipeId : undefined, "usage:recover");
  assert.equal(
    input.recipeSnapshot?.steps.some(
      (candidate) => candidate.kind === "module" && candidate.recipeId === "privacy:warm",
    ),
    false,
  );
  assert.deepEqual(input.variables, { locale: "en" });
  assert.equal(input.artifacts?.[0]?.kind, "campaign-check-repair-lineage");
});

test("a first check drops frozen setup and requires the live origin proof", () => {
  const run = fixture();
  const check = run.recipeSnapshot!.steps[0]!;
  assert.ok(check.check);
  run.recipeSnapshot!.steps = [
    { kind: "module", recipeId: "launch-grok" },
    check,
    run.recipeSnapshot!.steps[1]!,
  ];
  run.recipeGraph![run.recipeSnapshot!.id] = run.recipeSnapshot!;
  run.recipeGraph!["launch-grok"] = {
    id: "launch-grok",
    title: "Launch Grok",
    source: "custom",
    steps: [{ kind: "tap", target: { label: "Grok" } }],
    createdAt: at,
    updatedAt: at,
  };
  const input = campaignCheckRepairInput(run, "usage");
  assert.deepEqual(
    input.recipeSnapshot?.steps.flatMap((step) => (step.kind === "module" ? [step.recipeId] : [])),
    ["usage:recover"],
  );
  assert.equal(input.recipeSnapshot?.steps[0]?.kind, "expect-screen");
  assert.equal(
    input.artifacts?.[0]?.data &&
      (input.artifacts[0].data as { execution?: { setupStepsReplayed?: number } }).execution
        ?.setupStepsReplayed,
    0,
  );
});

test("fails closed when no frozen origin proof exists", () => {
  const run = fixture();
  const recovery = run.recipeGraph!["usage:recover"]!;
  recovery.steps = recovery.steps.filter((step) => step.kind !== "expect-screen");
  assert.equal(
    buildCampaignRepairTarget(run, "usage")?.actions.find((action) => action.kind === "retry-check")
      ?.available,
    false,
  );
  assert.throws(() => campaignCheckRepairInput(run, "usage"), /verified live origin/u);
});

test("refuses an app launch hidden inside a warm repair module", () => {
  const run = fixture();
  run.recipeGraph!["usage:recover"]!.steps.splice(1, 0, {
    kind: "app",
    action: "open",
    app: "ai.x.grok",
    relaunch: false,
  });
  assert.equal(
    buildCampaignRepairTarget(run, "usage")?.actions.find((action) => action.kind === "retry-check")
      ?.available,
    false,
  );
  assert.throws(() => campaignCheckRepairInput(run, "usage"), /refuses app open/u);
});

test("links persisted selective attempts back to the original repair target", () => {
  const source = fixture();
  const attempt: PersistedRun = {
    ...fixture(),
    id: "run-attempt",
    status: "ok",
    retryOf: source.id,
    artifacts: [
      {
        kind: "campaign-check-repair-lineage",
        capturedAt: at + 200,
        data: { sourceRunId: source.id, sourceCheckId: "usage" },
      },
    ],
  };
  const repairs = listCampaignRepairTargets([attempt, source]);
  assert.equal(repairs.length, 1);
  assert.deepEqual(repairs[0]?.lineage.priorAttempts, [
    { runId: "run-attempt", status: "ok", createdAt: at },
  ]);
});

test("ignores historical runs that predate repair artifact collections", () => {
  const historical = {
    ...fixture(),
    id: "run-before-repair-artifacts",
    artifacts: undefined,
    frames: undefined,
  } as unknown as PersistedRun;
  assert.deepEqual(listCampaignRepairTargets([historical]), []);
});
