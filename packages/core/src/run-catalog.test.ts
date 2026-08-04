import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  applyRunRetention,
  catalogRunDirectory,
  catalogSummaries,
  rebuildRunCatalog,
} from "./run-catalog.js";

test("run catalog rebuilds from committed manifests and retention is dry-run safe", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-catalog-"));
  const dir = join(root, "fixture-run");
  await mkdir(dir);
  const run = {
    schemaVersion: 5,
    id: "fixture-id",
    dir,
    action: "smoke",
    status: "ok",
    queuedAt: 1,
    finishedAt: 2,
    writtenAt: 3,
    frames: [{ bytes: 12 }],
    artifacts: [],
  };
  const raw = JSON.stringify(run);
  await writeFile(join(dir, "run.json"), raw);
  await writeFile(
    join(dir, ".complete"),
    JSON.stringify({ digest: createHash("sha256").update(raw).digest("hex") }),
  );
  try {
    assert.deepEqual(await rebuildRunCatalog(root), { indexed: 1, incomplete: 0 });
    assert.equal((await catalogSummaries(root))[0]?.id, "fixture-id");
    assert.equal(await catalogRunDirectory(root, "fixture-id"), dir);
    const preview = await applyRunRetention(root, { maxAgeDays: 1, dryRun: true });
    assert.deepEqual(preview.deleted, []);
    assert.equal(JSON.parse(await readFile(join(dir, "run.json"), "utf8")).id, "fixture-id");
    const applied = await applyRunRetention(root, { maxAgeDays: 1 });
    assert.deepEqual(applied.deleted, ["fixture-id"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("run catalog filters an App Map before applying its history limit", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-catalog-map-"));
  try {
    for (let index = 0; index < 5; index += 1) {
      const id = `run-${index}`;
      const dir = join(root, id);
      await mkdir(dir);
      const run = {
        schemaVersion: 5,
        id,
        dir,
        action: index === 0 ? "app-map:settings:main" : `recipe:${index}`,
        status: "ok",
        queuedAt: index,
        writtenAt: index,
        frames: [],
        artifacts: [],
      };
      const raw = JSON.stringify(run);
      await writeFile(join(dir, "run.json"), raw);
      await writeFile(
        join(dir, ".complete"),
        JSON.stringify({ digest: createHash("sha256").update(raw).digest("hex") }),
      );
    }
    await rebuildRunCatalog(root);
    assert.deepEqual(
      (await catalogSummaries(root, 1, "app-map:settings:")).map((run) => run.id),
      ["run-0"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
