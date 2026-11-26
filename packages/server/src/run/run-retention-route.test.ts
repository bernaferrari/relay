import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resetControlDatabaseCache } from "@relay/core";
import { startServer } from "../index.js";

test("run retention route previews a dry run and rejects phantom policy fields before touching storage", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-http-run-retention-"));
  const keys = ["RELAY_STATE_DIR", "RELAY_RUNS_DIR"] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.RELAY_STATE_DIR = join(root, "state");
  process.env.RELAY_RUNS_DIR = join(root, "runs");
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    resetControlDatabaseCache();
    server = await startServer({ host: "127.0.0.1", port: 0 });
    const base = `http://127.0.0.1:${server.port}`;
    const at = Date.now() - 10 * 86_400_000;
    const dir = join(root, "runs", "run-old");
    await mkdir(dir, { recursive: true });
    const raw = JSON.stringify({
      schemaVersion: 5,
      id: "run-old",
      dir,
      projectId: "project-a",
      ownerId: "owner-a",
      action: "retention-candidate",
      title: "Old run",
      status: "completed",
      attempts: 1,
      queuedAt: at,
      writtenAt: at,
      logs: [],
      steps: [],
      frames: [],
      artifacts: [],
    });
    await writeFile(join(dir, "run.json"), raw);
    await writeFile(
      join(dir, ".complete"),
      JSON.stringify({ digest: createHash("sha256").update(raw).digest("hex") }),
    );
    const rebuild = await fetch(`${base}/runs/catalog/rebuild`, { method: "POST" });
    assert.equal(rebuild.status, 200);

    const rejected = await fetch(`${base}/runs/retention`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ maxRuns: 5, olderThanMs: 1000 }),
    });
    assert.equal(rejected.status, 400);
    assert.equal((await stat(dir)).isDirectory(), true);

    const preview = await fetch(`${base}/runs/retention`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ maxAgeDays: 1, dryRun: true }),
    });
    assert.equal(preview.status, 200);
    const payload = (await preview.json()) as {
      disabled: boolean;
      candidates: Array<{ id: string }>;
      deleted: string[];
    };
    assert.deepEqual(payload.deleted, []);
    assert.deepEqual(
      payload.candidates.map((candidate) => candidate.id),
      ["run-old"],
    );
    assert.equal((await stat(dir)).isDirectory(), true);
  } finally {
    await server?.close();
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetControlDatabaseCache();
    await rm(root, { recursive: true, force: true });
  }
});
