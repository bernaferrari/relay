import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { persistPersistedRun, readCompletedPersistedRun, type PersistedRun } from "./runs.js";
import { createHash } from "node:crypto";
import { rebuildRunCatalog } from "./run-catalog.js";
import { exportRelayRunBundle, verifyRelayRunBundle } from "./run-bundle.js";

test("an interrupted review preserves the previous committed Run and catalog", async () => {
  const root = await fs.mkdtemp(join(tmpdir(), "relay-review-durability-"));
  const dir = join(root, "run");
  await fs.mkdir(dir);
  const run: PersistedRun = {
    schemaVersion: 5,
    id: "durable",
    dir,
    action: "test",
    status: "succeeded",
    attempts: 1,
    queuedAt: 1,
    finishedAt: 2,
    writtenAt: 2,
    logs: [],
    steps: [],
    frames: [],
    artifacts: [],
    inputDigest: "a".repeat(64),
    resolvedInputs: {},
  };
  const raw = JSON.stringify(run, null, 2);
  await fs.writeFile(join(dir, "run.json"), raw);
  await fs.writeFile(
    join(dir, ".complete"),
    JSON.stringify({
      schemaVersion: 1,
      id: run.id,
      digest: createHash("sha256").update(raw).digest("hex"),
    }),
  );
  const rename = fs.rename;
  try {
    fs.rename = async (from, to) => {
      if (String(to) === join(dir, ".complete")) throw new Error("injected publication failure");
      return rename(from, to);
    };
    syncBuiltinESMExports();
    await assert.rejects(
      persistPersistedRun(root, run, { ...run, title: "New review" }),
      /injected/,
    );
    const previous = await readCompletedPersistedRun(dir);
    assert(previous);
    assert.equal(previous.title, undefined);
    assert.deepEqual(await rebuildRunCatalog(root), { indexed: 1, incomplete: 0 });
    const bundle = join(root, "recovered.relayrun");
    await exportRelayRunBundle(dir, bundle);
    const verified = await verifyRelayRunBundle(bundle);
    assert(!verified.manifest.entries.some((entry) => entry.path === ".run.previous.json"));
    fs.rename = rename;
    syncBuiltinESMExports();
    await persistPersistedRun(root, run, { ...run, title: "Retried review" });
    assert.equal((await readCompletedPersistedRun(dir))?.title, "Retried review");
  } finally {
    fs.rename = rename;
    syncBuiltinESMExports();
    await fs.rm(root, { recursive: true, force: true });
  }
});
