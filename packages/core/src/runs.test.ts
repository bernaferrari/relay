import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readPersistedRun } from "./runs.js";

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
