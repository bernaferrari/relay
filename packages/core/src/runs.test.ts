import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { TestJob } from "./session.js";
import {
  listPersistedRuns,
  listRunSummaries,
  persistRun,
  readPersistedRun,
  reviewPersistedRun,
  RunReviewError,
  runsRoot,
  writeFramePng,
} from "./runs.js";
import { replayInputFromPersistedRun } from "./session-job-factory.js";

function job(root: string, status: TestJob["status"] = "ok"): TestJob {
  const at = Date.now();
  return {
    id: `run-${Math.random().toString(36).slice(2)}`,
    action: "evidence-test",
    platform: "android",
    targetContext: { kind: "device", platform: "android", serial: "runs-test" },
    targetKind: "device",
    status,
    queuedAt: at - 20,
    startedAt: at - 10,
    ...(status === "running" ? {} : { finishedAt: at }),
    logs: ["started", "finished"],
    attempts: 1,
    steps: [],
    frames: [],
    artifacts: [],
    glyphs: [],
    kind: "Replay",
    tone: "acc",
    title: "Evidence test",
    runDir: root,
    resolvedInputs: {},
    sensitiveInputNames: [],
    evidencePolicy: { schemaVersion: 1, sensitive: {} },
  };
}

test("run storage follows an explicit Relay state boundary", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-state-runs-"));
  const previousState = process.env.RELAY_STATE_DIR;
  const previousRuns = process.env.RELAY_RUNS_DIR;
  process.env.RELAY_STATE_DIR = root;
  delete process.env.RELAY_RUNS_DIR;
  try {
    assert.equal(runsRoot(), join(root, "runs"));
  } finally {
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    if (previousRuns === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previousRuns;
    await rm(root, { recursive: true, force: true });
  }
});

test("finalizing an external run cannot contaminate the active run catalog", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-run-store-"));
  const external = await mkdtemp(join(tmpdir(), "relay-external-run-"));
  const previous = process.env.RELAY_RUNS_DIR;
  process.env.RELAY_RUNS_DIR = root;
  try {
    await persistRun(job(join(external, "run")));
    assert.deepEqual(await listRunSummaries(), []);
  } finally {
    if (previous === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previous;
    await rm(root, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  }
});

test("persisted runs resolve their full ID when folders use a short suffix", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-runs-"));
  const previous = process.env.RELAY_RUNS_DIR;
  process.env.RELAY_RUNS_DIR = root;
  const id = "78826c20-4015-47c7-b9f9-bf62e3fd2df8";
  const dir = join(root, "2026-07-07T05-13-35_logout_nodevice_78826c20");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "run.json"), JSON.stringify({ id, action: "logout" }));

  try {
    const run = await readPersistedRun(id);
    assert.equal(run?.id, id);
    assert.equal(run?.dir, dir);
  } finally {
    if (previous === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("run reports finalize once at a terminal atomic commit point", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-finalize-"));
  const run = job(join(root, "run"));
  run.retryOf = "immutable-source-run";
  try {
    await writeFramePng(run, Buffer.from("frame").toString("base64"), "before finish");
    await assert.rejects(access(join(run.runDir!, "run.json")));

    const persisted = await persistRun(run);
    assert.equal(persisted.status, "ok");
    assert.equal(persisted.schemaVersion, 5);
    assert.equal(persisted.retryOf, "immutable-source-run");
    await access(join(run.runDir!, ".complete"));
    await assert.rejects(access(join(run.runDir!, "report-manifest.json")));
    const onDisk = JSON.parse(await readFile(join(run.runDir!, "run.json"), "utf8"));
    assert.deepEqual(onDisk, JSON.parse(JSON.stringify(persisted)));

    assert.deepEqual(await persistRun(run), onDisk, "an identical finalization is idempotent");
    run.logs.push("late mutation");
    await assert.rejects(persistRun(run), /integrity conflict/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("deferred checks survive persistence and can be approved exactly once", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-run-review-"));
  const previous = process.env.RELAY_RUNS_DIR;
  process.env.RELAY_RUNS_DIR = root;
  const run = job(join(root, "run"));
  run.review = {
    schemaVersion: 1,
    status: "pending",
    capability: "camera attachment",
    reason: "The image needs a human comparison.",
    requestedAt: Date.now(),
    requestedBy: { id: "agent:openrouter", kind: "agent" },
  };
  try {
    const persisted = await persistRun(run);
    await assert.rejects(
      () =>
        reviewPersistedRun(runsRoot(), persisted, {
          action: "approve",
          actor: { id: "agent:openrouter", kind: "agent" },
        }),
      (error: unknown) => {
        assert.ok(error instanceof RunReviewError);
        assert.equal(error.code, "RUN_REVIEW_ACTOR_REQUIRED");
        return true;
      },
    );
    const decision = await reviewPersistedRun(runsRoot(), persisted, {
      action: "approve",
      actor: { id: "human:ada", kind: "human" },
      note: "The attachment matches the expected photo.",
    });
    assert.equal(decision.review.status, "approved");
    assert.equal(decision.run.outcome, "passed");
    assert.equal((await readPersistedRun(run.id))?.review?.status, "approved");
    assert.equal((await listRunSummaries())[0]?.review?.status, "approved");

    const retry = await reviewPersistedRun(runsRoot(), decision.run, {
      action: "approve",
      actor: { id: "human:ada", kind: "human" },
    });
    assert.equal(retry.review.decidedBy?.id, "human:ada");
  } finally {
    if (previous === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("concurrent human review decisions resolve from the committed winner", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-run-review-race-"));
  const previous = process.env.RELAY_RUNS_DIR;
  process.env.RELAY_RUNS_DIR = root;
  const run = job(join(root, "run"));
  run.review = {
    schemaVersion: 1,
    status: "pending",
    capability: "visual comparison",
    reason: "The region needs a human decision.",
    requestedAt: Date.now(),
  };
  try {
    const persisted = await persistRun(run);
    const [first, second] = await Promise.allSettled([
      reviewPersistedRun(runsRoot(), persisted, {
        action: "approve",
        actor: { id: "human:ada", kind: "human" },
      }),
      reviewPersistedRun(runsRoot(), persisted, {
        action: "reject",
        actor: { id: "human:grace", kind: "human" },
      }),
    ]);
    const fulfilled = [first, second].filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof reviewPersistedRun>>> =>
        result.status === "fulfilled",
    );
    const rejected = [first, second].filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.ok(rejected[0]?.reason instanceof RunReviewError);
    assert.equal(rejected[0]?.reason.code, "RUN_REVIEW_CONFLICT");
    assert.equal((await readPersistedRun(run.id))?.review?.status, "approved");
  } finally {
    if (previous === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("private run inputs never persist in plaintext when optional redaction is off", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-private-run-"));
  const run = job(join(root, "run"));
  const secret = "person@example.test";
  run.resolvedInputs = { login_email: secret, display_name: "Ada" };
  run.sensitiveInputNames = ["login_email"];
  run.logs = [`Signing in as ${secret}`];
  run.result = { account: secret };
  run.artifacts = [{ kind: "command-attempt", capturedAt: Date.now(), data: { text: secret } }];
  try {
    const persisted = await persistRun(run);
    const serialized = JSON.stringify(persisted);
    assert.equal(serialized.includes(secret), false);
    assert.equal(persisted.resolvedInputs.login_email, "[private]");
    assert.equal(persisted.resolvedInputs.display_name, "Ada");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("non-terminal and incomplete schema-v5 runs are not exposed", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-incomplete-"));
  const previous = process.env.RELAY_RUNS_DIR;
  process.env.RELAY_RUNS_DIR = root;
  const running = job(join(root, "running"), "running");
  try {
    await assert.rejects(persistRun(running), /non-terminal/);
    await mkdir(join(root, "partial"), { recursive: true });
    await writeFile(
      join(root, "partial", "run.json"),
      JSON.stringify({ schemaVersion: 5, id: "partial", status: "ok" }),
    );
    assert.deepEqual(await listPersistedRuns(), []);
    assert.equal(await readPersistedRun("partial"), null);
  } finally {
    if (previous === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("persisted browser runs retain browser identity instead of becoming Android", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-browser-run-"));
  const run = {
    ...job(join(root, "run")),
    targetKind: "browser" as const,
    browserTargetId: "browser-chat",
  };
  try {
    const persisted = await persistRun(run);
    assert.equal(persisted.platform, "browser");
    assert.equal(persisted.serial, "browser-chat");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("persisted runs retain a provider-scoped target for replay", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-provider-target-run-"));
  const run = job(join(root, "run"));
  run.targetContext = {
    kind: "cloud",
    provider: "example.device-farm",
    sessionId: "ios-session-42",
    platform: "ios",
  };
  run.platform = "ios";
  run.executionTarget = {
    schemaVersion: 1,
    kind: "provider-session",
    provider: { key: "example.device-farm", scope: "remote" },
    targetId: "ios-session-42",
    platform: "ios",
    identity: { kind: "provider-session", value: "ios-session-42" },
  };
  try {
    const persisted = await persistRun(run);
    assert.deepEqual(persisted.executionTarget, run.executionTarget);
    const replay = replayInputFromPersistedRun({
      ...persisted,
      recipeSnapshot: { id: "evidence-test", title: "Evidence test", steps: [] } as never,
      recipeGraph: {
        "evidence-test": { id: "evidence-test", title: "Evidence test", steps: [] },
      } as never,
    });
    assert.deepEqual(replay.executionTarget, run.executionTarget);
    assert.equal(replay.serial, undefined, "a provider session is never rebuilt as a local serial");
    assert.equal(replay.platform, "ios");
    assert.equal(replay.targetKind, "device");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("persisted runs retain bounded non-secret execution provenance", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-provenance-"));
  const run = job(join(root, "run"));
  run.operationContext = {
    schemaVersion: 1,
    actorId: "agent:test",
    actorKind: "agent",
    organizationId: "organization:test",
    projectId: "project:test",
    operationId: "operation:test",
    requestId: "request:test",
    idempotencyKey: "must-not-be-persisted",
    issuedAt: 1_786_000_000_000,
    causationId: "cause:test",
    correlationId: "c".repeat(400),
    authoringSessionId: "authoring:test",
    leaseId: "lease:test",
  };
  try {
    const persisted = await persistRun(run);
    assert.deepEqual(persisted.executionProvenance, {
      schemaVersion: 1,
      actorId: "agent:test",
      actorKind: "agent",
      organizationId: "organization:test",
      projectId: "project:test",
      operationId: "operation:test",
      requestId: "request:test",
      issuedAt: 1_786_000_000_000,
      causationId: "cause:test",
      correlationId: "c".repeat(256),
      authoringSessionId: "authoring:test",
      leaseId: "lease:test",
    });
    assert.equal(
      "idempotencyKey" in (persisted.executionProvenance as Record<string, unknown>),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
