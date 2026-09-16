import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compileBrowserEnvironment } from "@relay/protocol";
import {
  AccountNeedsReloginError,
  cancelJob,
  enqueueJob,
  listJobs,
  prepareJobBatch,
  resetControlDatabaseCache,
  resumeJob,
  retryJob,
  runJobSync,
  runWithOperationContext,
  saveBrowserAuthenticationFixture,
  waitForJobCompletion,
} from "./index.js";
import type { Recipe } from "./recipes.js";

const sleepRecipe: Recipe = {
  id: "sleep-once",
  title: "Sleep once",
  source: "custom",
  steps: [{ kind: "sleep", ms: 1 }],
  createdAt: 1,
  updatedAt: 1,
};

const operation = {
  schemaVersion: 1 as const,
  actorId: "human:qa",
  actorKind: "human" as const,
  organizationId: "acme",
  projectId: "mobile",
  operationId: "job.start",
  requestId: "session-auth-health",
  idempotencyKey: "session-auth-health",
  issuedAt: 1,
};

function shopEnvironment(fixtureId?: string) {
  return compileBrowserEnvironment({
    engine: "chromium",
    ...(fixtureId ? { authenticationFixtureId: fixtureId } : {}),
  });
}

async function rememberHealth(
  root: string,
  reference: string,
  health: { status: string; checkedAt: number; detail: string; signedIn?: boolean },
): Promise<void> {
  await mkdir(join(root, ".relay"), { recursive: true });
  await writeFile(
    join(root, ".relay", "browser-auth-health.json"),
    `${JSON.stringify({ schemaVersion: 1, entries: { [reference]: health } })}\n`,
  );
}

async function saveSuperGrok() {
  return saveBrowserAuthenticationFixture({
    projectId: "mobile",
    targetId: "shop-web",
    name: "SuperGrok",
    createdBy: "human:qa",
    storageState: {
      cookies: [],
      origins: [{ origin: "https://example.test", localStorage: [] }],
    },
  });
}

async function saveBlockedSuperGrok(root: string) {
  const saved = await saveSuperGrok();
  await rememberHealth(root, saved.reference, {
    status: "error",
    checkedAt: 1,
    detail: "lab probe failed",
  });
  return saved;
}

async function saveReadySuperGrok(root: string) {
  const saved = await saveSuperGrok();
  await rememberHealth(root, saved.reference, {
    status: "ready",
    checkedAt: 1,
    signedIn: true,
    detail: "SuperGrok is signed in.",
  });
  return saved;
}

function isAccountNeedsRelogin(error: unknown): boolean {
  return (
    error instanceof AccountNeedsReloginError &&
    error.code === "ACCOUNT_NEEDS_RELOGIN" &&
    /lab probe failed/u.test(error.detail)
  );
}

async function withSessionAuthWorkspace(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "relay-session-auth-"));
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

function browserJobInput(fixtureId?: string) {
  const environment = shopEnvironment(fixtureId);
  return {
    recipe: sleepRecipe.id,
    recipeSnapshot: sleepRecipe,
    recipeGraph: { [sleepRecipe.id]: sleepRecipe },
    targetKind: "browser" as const,
    browserTargetId: "shop-web",
    browserCaseProfile: environment,
    projectId: "mobile",
    ownerId: "human:qa",
  };
}

function deviceJobInput() {
  return {
    recipe: sleepRecipe.id,
    recipeSnapshot: sleepRecipe,
    recipeGraph: { [sleepRecipe.id]: sleepRecipe },
    targetKind: "device" as const,
    serial: "ipad-1",
    platform: "ios" as const,
    projectId: "mobile",
    ownerId: "human:qa",
  };
}

function jobIds(): string[] {
  return listJobs(100)
    .map((job) => job.id)
    .sort();
}

function assertNoNewJobs(before: readonly string[]): void {
  assert.deepEqual(jobIds(), [...before].sort());
}

function drainQueued(id: string): void {
  cancelJob(id);
}

test("runJobSync does not enqueue a signed-in target with remembered error health", async () => {
  await withSessionAuthWorkspace(async (root) => {
    const saved = await saveBlockedSuperGrok(root);
    const before = jobIds();
    await assert.rejects(
      () => runWithOperationContext(operation, () => runJobSync(browserJobInput(saved.reference))),
      isAccountNeedsRelogin,
    );
    assertNoNewJobs(before);
  });
});

test("unsigned runJobSync still queues while SuperGrok health is error", async () => {
  await withSessionAuthWorkspace(async (root) => {
    await saveBlockedSuperGrok(root);
    const pending = runWithOperationContext(operation, () => runJobSync(browserJobInput()));
    let id: string | undefined;
    for (let attempt = 0; attempt < 80 && !id; attempt += 1) {
      id = listJobs(20)[0]?.id;
      if (!id) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ok(id);
    cancelJob(id);
    const finished = await pending;
    assert.ok(finished.id);
    assert.equal(finished.error?.startsWith("ACCOUNT_NEEDS_RELOGIN:"), false);
  });
});

test("resumeJob does not resume SuperGrok when remembered health is blocked", async () => {
  await withSessionAuthWorkspace(async (root) => {
    const saved = await saveReadySuperGrok(root);
    await runWithOperationContext(operation, async () => {
      const staged = prepareJobBatch([{ input: browserJobInput(saved.reference) }]);
      staged.activate();
      const job = staged.jobs[0]!;
      job.status = "paused";
      await rememberHealth(root, saved.reference, {
        status: "error",
        checkedAt: 2,
        detail: "lab probe failed",
      });
      try {
        await assert.rejects(() => resumeJob(job.id), isAccountNeedsRelogin);
        assert.equal(job.status, "paused");
      } finally {
        staged.rollback();
      }
    });
  });
});

test("prepareJobBatch does not stage a signed-in target with remembered error health", async () => {
  await withSessionAuthWorkspace(async (root) => {
    const saved = await saveBlockedSuperGrok(root);
    await runWithOperationContext(operation, () => {
      const before = jobIds();
      assert.throws(
        () => prepareJobBatch([{ input: browserJobInput(saved.reference) }]),
        isAccountNeedsRelogin,
      );
      assertNoNewJobs(before);
    });
  });
});

test("enqueueJob does not queue a signed-in target with remembered error health", async () => {
  await withSessionAuthWorkspace(async (root) => {
    const saved = await saveBlockedSuperGrok(root);
    await runWithOperationContext(operation, () => {
      const before = jobIds();
      assert.throws(() => enqueueJob(browserJobInput(saved.reference)), isAccountNeedsRelogin);
      assertNoNewJobs(before);
    });
  });
});

test("unsigned prepareJobBatch and enqueueJob still proceed while SuperGrok health is error", async () => {
  await withSessionAuthWorkspace(async (root) => {
    await saveBlockedSuperGrok(root);
    await runWithOperationContext(operation, () => {
      const staged = prepareJobBatch([{ input: browserJobInput() }]);
      try {
        assert.equal(staged.jobs.length, 1);
        assert.equal(staged.jobs[0]?.authenticationHealth, undefined);
      } finally {
        staged.rollback();
      }
      const job = enqueueJob(browserJobInput());
      try {
        assert.ok(job.id);
        assert.equal(Boolean(job.error?.startsWith("ACCOUNT_NEEDS_RELOGIN:")), false);
      } finally {
        drainQueued(job.id);
      }
    });
  });
});

test("ready SuperGrok prepareJobBatch and enqueueJob still proceed", async () => {
  await withSessionAuthWorkspace(async (root) => {
    const saved = await saveReadySuperGrok(root);
    await runWithOperationContext(operation, () => {
      const staged = prepareJobBatch([{ input: browserJobInput(saved.reference) }]);
      try {
        assert.equal(staged.jobs.length, 1);
        assert.equal(staged.jobs[0]?.authenticationHealth?.status, "ready");
        assert.equal(staged.jobs[0]?.authenticationHealth?.signedIn, true);
      } finally {
        staged.rollback();
      }
      const job = enqueueJob(browserJobInput(saved.reference));
      try {
        assert.ok(job.id);
        assert.equal(job.authenticationHealth?.status, "ready");
      } finally {
        drainQueued(job.id);
      }
    });
  });
});

test("retryJob does not re-enqueue SuperGrok when remembered health is blocked", async () => {
  await withSessionAuthWorkspace(async (root) => {
    const saved = await saveReadySuperGrok(root);
    await runWithOperationContext(operation, async () => {
      const staged = prepareJobBatch([{ input: browserJobInput(saved.reference) }]);
      staged.activate();
      const parent = staged.jobs[0]!;
      parent.status = "error";
      await rememberHealth(root, saved.reference, {
        status: "error",
        checkedAt: 2,
        detail: "lab probe failed",
      });
      const before = jobIds();
      try {
        assert.throws(() => retryJob(parent.id), isAccountNeedsRelogin);
        assertNoNewJobs(before);
      } finally {
        staged.rollback();
      }
    });
  });
});

test("prepareJobBatch does not stage unsigned cells beside a dead claimed fixture", async () => {
  await withSessionAuthWorkspace(async (root) => {
    const saved = await saveBlockedSuperGrok(root);
    await runWithOperationContext(operation, () => {
      const before = jobIds();
      assert.throws(
        () =>
          prepareJobBatch([
            { input: browserJobInput() },
            { input: browserJobInput(saved.reference) },
          ]),
        isAccountNeedsRelogin,
      );
      assertNoNewJobs(before);
    });
  });
});

test("device prepareJobBatch still stages while SuperGrok health is error", async () => {
  await withSessionAuthWorkspace(async (root) => {
    await saveBlockedSuperGrok(root);
    await runWithOperationContext(operation, () => {
      const staged = prepareJobBatch([{ input: deviceJobInput() }]);
      try {
        assert.equal(staged.jobs.length, 1);
        assert.equal(staged.jobs[0]?.targetKind, "device");
      } finally {
        staged.rollback();
      }
    });
  });
});

async function dispatchQueued(input: ReturnType<typeof browserJobInput>) {
  const staged = prepareJobBatch([{ input }]);
  staged.activate();
  return staged;
}

test("queued SuperGrok job does not run recipes after health becomes error", async () => {
  await withSessionAuthWorkspace(async (root) => {
    const saved = await saveReadySuperGrok(root);
    await runWithOperationContext(operation, async () => {
      const staged = await dispatchQueued(browserJobInput(saved.reference));
      await rememberHealth(root, saved.reference, {
        status: "error",
        checkedAt: 2,
        detail: "lab probe failed",
      });
      staged.dispatch();
      const finished = await waitForJobCompletion(staged.jobs[0]!.id);
      assert.equal(finished.status, "error");
      assert.match(finished.error ?? "", /^ACCOUNT_NEEDS_RELOGIN:/u);
      assert.match(finished.error ?? "", /lab probe failed/u);
      assert.equal(finished.steps.length, 0);
      assert.equal(
        finished.logs.some((line) => line.includes("managed browser missing")),
        false,
      );
    });
  });
});

test("unsigned queued job still executes after SuperGrok health becomes error", async () => {
  await withSessionAuthWorkspace(async (root) => {
    const saved = await saveReadySuperGrok(root);
    await runWithOperationContext(operation, async () => {
      const staged = await dispatchQueued(browserJobInput());
      await rememberHealth(root, saved.reference, {
        status: "error",
        checkedAt: 2,
        detail: "lab probe failed",
      });
      staged.dispatch();
      const finished = await waitForJobCompletion(staged.jobs[0]!.id);
      assert.equal(Boolean(finished.error?.startsWith("ACCOUNT_NEEDS_RELOGIN:")), false);
      assert.notEqual(finished.status, "queued");
    });
  });
});

test("ready SuperGrok queued job still executes", async () => {
  await withSessionAuthWorkspace(async (root) => {
    const saved = await saveReadySuperGrok(root);
    await runWithOperationContext(operation, async () => {
      const staged = await dispatchQueued(browserJobInput(saved.reference));
      staged.dispatch();
      const finished = await waitForJobCompletion(staged.jobs[0]!.id);
      assert.equal(Boolean(finished.error?.startsWith("ACCOUNT_NEEDS_RELOGIN:")), false);
      assert.notEqual(finished.status, "queued");
    });
  });
});
