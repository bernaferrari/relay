import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { TestJob } from "./session.js";
import { listPersistedRuns, persistRun, readPersistedRun, writeFramePng } from "./runs.js";

function job(root: string, status: TestJob["status"] = "ok"): TestJob {
  const at = Date.now();
  return {
    id: `run-${Math.random().toString(36).slice(2)}`,
    action: "evidence-test",
    platform: "android",
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
    evidencePolicy: { schemaVersion: 1, sensitive: {} },
  };
}

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
  try {
    await writeFramePng(run, Buffer.from("frame").toString("base64"), "before finish");
    await assert.rejects(access(join(run.runDir!, "run.json")));

    const persisted = await persistRun(run);
    assert.equal(persisted.status, "ok");
    assert.equal(persisted.schemaVersion, 5);
    await access(join(run.runDir!, ".complete"));
    const onDisk = JSON.parse(await readFile(join(run.runDir!, "run.json"), "utf8"));
    assert.deepEqual(onDisk, JSON.parse(JSON.stringify(persisted)));

    assert.deepEqual(await persistRun(run), onDisk, "an identical finalization is idempotent");
    run.logs.push("late mutation");
    await assert.rejects(persistRun(run), /integrity conflict/);
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
