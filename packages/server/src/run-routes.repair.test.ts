import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RelayClient } from "@relay/client";
import {
  createAppMap,
  mutateStoredAppMap,
  persistRun,
  resetControlDatabaseCache,
  type Recipe,
  type TestJob,
} from "@relay/core";
import { startServer } from "./index.js";

test("failed campaign checks are addressable as complete repair resources", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-repair-routes-"));
  const previous = process.env.RELAY_RUNS_DIR;
  const previousState = process.env.RELAY_STATE_DIR;
  process.env.RELAY_RUNS_DIR = root;
  process.env.RELAY_STATE_DIR = join(root, "state");
  const at = Date.now();
  const recovery: Recipe = {
    id: "usage:recover",
    title: "Usage recovery",
    source: "custom",
    steps: [
      {
        kind: "expect-screen",
        screenId: "settings",
        screenTitle: "Settings",
        fingerprint: "a".repeat(64),
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
    ],
    createdAt: at,
    updatedAt: at,
  };
  const recipe: Recipe = {
    id: "settings",
    title: "Settings",
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
            recipeId: recovery.id,
            transitionId: "open-usage",
            mode: "warm-transition",
          },
          transitionDependencies: [
            {
              connectionId: "open-usage",
              originScreenId: "settings",
              destination: { kind: "screen", screenId: "usage" },
            },
          ],
        },
      },
    ],
    createdAt: at,
    updatedAt: at,
  };
  const job: TestJob = {
    id: "failed-run",
    action: recipe.id,
    recipeId: recipe.id,
    title: recipe.title,
    targetContext: { kind: "device", platform: "android", serial: "test-device" },
    serial: "test-device",
    platform: "android",
    targetKind: "device",
    status: "error",
    queuedAt: at,
    startedAt: at + 1,
    finishedAt: at + 20,
    logs: [],
    attempts: 1,
    steps: [],
    frames: [{ path: "runs/failed-run/usage.png", caption: "failed:usage", capturedAt: at + 18 }],
    glyphs: [],
    kind: "Replay",
    tone: "acc",
    recipeSnapshot: recipe,
    recipeGraph: {
      [recipe.id]: recipe,
      [recovery.id]: recovery,
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
        capturedAt: at + 1,
        data: { appMapId: "repair-map", appMapRevision: 1, test: { id: "smoke" } },
      },
      {
        kind: "campaign-check-evidence",
        capturedAt: at + 18,
        data: {
          checkId: "usage",
          error: "Usage moved",
          screenIdentity: { fingerprint: "c".repeat(64) },
          attempts: [],
          nodes: [],
        },
      },
      {
        kind: "navigation-repair-proposal",
        capturedAt: at + 17,
        data: {
          connectionId: "open-usage",
          beforeSelector: { label: "Usage" },
          currentSelector: { identifier: "usage-row" },
          attempts: [],
        },
      },
      {
        kind: "campaign-check-result",
        capturedAt: at + 19,
        data: {
          id: "usage",
          title: "Usage",
          status: "failed",
          error: "Usage moved",
          startedAt: at + 5,
          finishedAt: at + 19,
          selectiveRepair: { status: "pending", recipeId: recovery.id },
        },
      },
    ],
    resolvedInputs: {},
    evidencePolicy: { schemaVersion: 1, sensitive: {} },
  };
  await createAppMap({
    organizationId: "relay",
    projectId: "local",
    appMapId: "repair-map",
    name: "Repair map",
    at,
  });
  await mutateStoredAppMap("local", "repair-map", (map) => ({
    ...map,
    revision: 1,
    screens: {
      settings: {
        organizationId: "relay",
        projectId: "local",
        appMapId: "repair-map",
        id: "settings",
        title: "Settings",
        identity: { schemaVersion: 1, fingerprint: "a".repeat(64) },
        variantIds: [],
        createdAt: at,
        updatedAt: at,
      },
      usage: {
        organizationId: "relay",
        projectId: "local",
        appMapId: "repair-map",
        id: "usage",
        title: "Usage",
        identity: { schemaVersion: 1, fingerprint: "b".repeat(64) },
        variantIds: [],
        createdAt: at,
        updatedAt: at,
      },
    },
    connections: {
      "open-usage": {
        organizationId: "relay",
        projectId: "local",
        appMapId: "repair-map",
        id: "open-usage",
        fromScreenId: "settings",
        destination: { kind: "screen", screenId: "usage" },
        label: "Usage",
        state: "ready",
        actions: [{ id: "tap-usage", kind: "tap", target: { label: "Usage" } }],
        navigation: {
          targetAlternatives: [{ kind: "accessibility", label: "Usage" }],
          expectedDestination: {
            screenId: "usage",
            identity: { schemaVersion: 1, fingerprint: "b".repeat(64) },
            evidenceIds: ["usage-tree"],
          },
        },
        createdAt: at,
        updatedAt: at,
      },
    },
    tests: {
      smoke: {
        organizationId: "relay",
        projectId: "local",
        appMapId: "repair-map",
        id: "smoke",
        name: "Smoke",
        kind: "scenario",
        intentSchemaVersion: 1,
        steps: [
          {
            id: "usage",
            kind: "instruction",
            intent: "Visit Usage",
            binding: {
              status: "resolved",
              kind: "connections",
              connectionIds: ["open-usage"],
            },
          },
        ],
        createdAt: at,
        updatedAt: at,
      },
    },
    updatedAt: at,
  }));
  await persistRun(job);
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  try {
    const listResponse = await fetch(`http://127.0.0.1:${server.port}/runs/repairs`);
    assert.equal(listResponse.status, 200);
    const listed = (await listResponse.json()) as { repairs: Array<{ id: string }> };
    assert.deepEqual(
      listed.repairs.map(({ id }) => id),
      ["failed-run:usage"],
    );

    const detailResponse = await fetch(
      `http://127.0.0.1:${server.port}/runs/failed-run/checks/usage/repair`,
    );
    assert.equal(detailResponse.status, 200);
    const detail = (await detailResponse.json()) as {
      repair: {
        source: { runId: string; checkId: string; checkTitle: string; action: string };
        defaultAction: string;
      };
    };
    assert.equal(detail.repair.source.runId, "failed-run");
    assert.equal(detail.repair.source.checkId, "usage");
    assert.equal(detail.repair.source.checkTitle, "Usage");
    assert.equal(detail.repair.source.action, "settings");
    assert.equal(detail.repair.defaultAction, "continue-and-report");

    const client = new RelayClient({
      url: `http://127.0.0.1:${server.port}`,
      auth: { type: "none" },
      organizationId: "relay",
      projectId: "local",
      actorId: "agent:repair-test",
      actorKind: "agent",
    });
    const retry = await client.invoke("run.repair.retry", {
      runId: "failed-run",
      checkId: "usage",
    });
    const retryJob = retry.job as {
      retryOf?: string;
      recipeSnapshot?: Recipe;
      artifacts?: Array<{ kind: string; data?: { sourceCheckId?: string } }>;
    };
    assert.equal(retry.repair.id, "failed-run:usage");
    assert.equal(retryJob.retryOf, "failed-run");
    assert.equal(retryJob.recipeSnapshot?.steps.length, 2);
    assert.equal(retryJob.recipeSnapshot?.steps[0]?.kind, "expect-screen");
    assert.equal(retryJob.recipeSnapshot?.steps[1]?.check?.id, "usage");
    assert.equal(retryJob.artifacts?.[0]?.kind, "campaign-check-repair-lineage");
    assert.equal(retryJob.artifacts?.[0]?.data?.sourceCheckId, "usage");

    const proposed = await client.invoke("run.repair.propose", {
      runId: "failed-run",
      checkId: "usage",
      kind: "retarget",
      selector: { identifier: "usage-row" },
      reason: "The preserved runtime selector reached the reviewed Usage screen.",
    });
    const pending = proposed.appMap.proposals[proposed.proposalId]!;
    assert.equal(pending.status, "pending");
    assert.equal(pending.repair?.testId, "smoke");
    assert.deepEqual(pending.repair?.sourceRunIds, ["failed-run"]);
    assert.equal(
      proposed.appMap.connections["open-usage"]!.navigation?.targetAlternatives[0]?.kind,
      "accessibility",
    );

    const approved = await client.invoke("app-map.proposal.approve", {
      appMapId: "repair-map",
      proposalId: proposed.proposalId,
      expectedRevision: proposed.appMap.revision,
    });
    assert.deepEqual(approved.appMap.connections["open-usage"]!.navigation?.targetAlternatives[0], {
      kind: "identifier",
      identifier: "usage-row",
    });
    const reverted = await client.invoke("app-map.proposal.revert", {
      appMapId: "repair-map",
      proposalId: proposed.proposalId,
      expectedRevision: approved.appMap.revision,
      reason: "Restoring the reviewed prior selector",
    });
    assert.deepEqual(reverted.appMap.connections["open-usage"]!.navigation?.targetAlternatives, [
      { kind: "accessibility", label: "Usage" },
    ]);
    assert.equal(
      reverted.appMap.proposals[proposed.proposalId]?.repair?.reverted?.actorId,
      "agent:repair-test",
    );
  } finally {
    await server.close();
    resetControlDatabaseCache();
    if (previous === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previous;
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
});
