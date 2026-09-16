import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compileBrowserEnvironment } from "@relay/protocol";
import {
  AccountNeedsReloginError,
  cancelJob,
  resetControlDatabaseCache,
  runWithOperationContext,
  saveBrowserAuthenticationFixture,
  startOptionRecipeRun,
  waitForJobCompletion,
} from "./index.js";
import type { Recipe } from "./recipes.js";
import type { OptionRunSet } from "./option-run.js";

const body: Recipe = {
  id: "checkout",
  title: "Checkout",
  source: "custom",
  steps: [{ kind: "sleep", ms: 1 }],
  createdAt: 1,
  updatedAt: 1,
};

const languages: OptionRunSet = {
  id: "languages",
  name: "Language",
  kind: "language",
  apply: {
    kind: "list",
    entryPath: [{ kind: "tap", target: { label: "Profile" } }],
    pickerPath: [{ kind: "tap", target: { text: "Language" } }],
  },
  options: [{ id: "en", identifier: "lang.en" }],
};

const operation = {
  schemaVersion: 1 as const,
  actorId: "human:qa",
  actorKind: "human" as const,
  organizationId: "acme",
  projectId: "mobile",
  operationId: "job.start",
  requestId: "option-run-auth-health",
  idempotencyKey: "option-run-auth-health",
  issuedAt: 1,
};

function memberProfile(fixtureId?: string) {
  return {
    id: "browser:shop-member",
    targetId: "shop-web",
    source: "browser" as const,
    platform: "browser" as const,
    name: "Shop member",
    capabilities: ["snapshot" as const],
    observedAt: 1,
    browserCaseProfile: compileBrowserEnvironment({
      engine: "chromium",
      ...(fixtureId ? { authenticationFixtureId: fixtureId } : {}),
    }),
  };
}

async function withOptionRunWorkspace(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "relay-option-run-auth-"));
  const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
  const previousState = process.env.RELAY_STATE_DIR;
  process.env.RELAY_WORKSPACE_ROOT = root;
  process.env.RELAY_STATE_DIR = root;
  resetControlDatabaseCache();
  try {
    await run(root);
  } finally {
    resetControlDatabaseCache();
    if (previousWorkspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousWorkspace;
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
}

test("startOptionRecipeRun does not enqueue a signed-in profile with remembered error health", async () => {
  await withOptionRunWorkspace(async (root) => {
    const saved = await saveBrowserAuthenticationFixture({
      projectId: "mobile",
      targetId: "shop-web",
      name: "SuperGrok",
      createdBy: "human:qa",
      storageState: {
        cookies: [],
        origins: [{ origin: "https://example.test", localStorage: [] }],
      },
    });
    await mkdir(join(root, ".relay"), { recursive: true });
    await writeFile(
      join(root, ".relay", "browser-auth-health.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        entries: {
          [saved.reference]: { status: "error", checkedAt: 1, detail: "lab probe failed" },
        },
      })}\n`,
    );
    await assert.rejects(
      () =>
        runWithOperationContext(operation, () =>
          startOptionRecipeRun({
            recipeId: body.id,
            compiledBody: body,
            targetId: "shop-web",
            targetKind: "browser",
            browserTargetId: "shop-web",
            targetProfile: memberProfile(saved.reference),
            request: { sets: [languages], strategy: "zip" },
            projectId: "mobile",
          }),
        ),
      (error: unknown) =>
        error instanceof AccountNeedsReloginError &&
        error.code === "ACCOUNT_NEEDS_RELOGIN" &&
        /lab probe failed/u.test(error.detail),
    );
  });
});

test("unsigned startOptionRecipeRun still queues while SuperGrok health is error", async () => {
  await withOptionRunWorkspace(async (root) => {
    const saved = await saveBrowserAuthenticationFixture({
      projectId: "mobile",
      targetId: "shop-web",
      name: "SuperGrok",
      createdBy: "human:qa",
      storageState: {
        cookies: [],
        origins: [{ origin: "https://example.test", localStorage: [] }],
      },
    });
    await mkdir(join(root, ".relay"), { recursive: true });
    await writeFile(
      join(root, ".relay", "browser-auth-health.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        entries: {
          [saved.reference]: { status: "error", checkedAt: 1, detail: "lab probe failed" },
        },
      })}\n`,
    );
    const started = await runWithOperationContext(operation, () =>
      startOptionRecipeRun({
        recipeId: body.id,
        compiledBody: body,
        targetId: "shop-web",
        targetKind: "browser",
        browserTargetId: "shop-web",
        targetProfile: memberProfile(),
        request: { sets: [languages], strategy: "zip" },
        projectId: "mobile",
      }),
    );
    assert.ok(started.jobs.length >= 1);
    for (const job of started.jobs) {
      cancelJob(job.id);
      await waitForJobCompletion(job.id);
    }
  });
});
