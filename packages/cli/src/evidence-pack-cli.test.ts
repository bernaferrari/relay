import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { REVIEW_CHECKLIST_START, visualReviewCommand } from "@relay/core";
import {
  exportWatchedCombinePack,
  finalizeCombineExportResult,
  finalizeExportedEvidencePack,
} from "./evidence-pack-cli.js";

const CHECKLIST_END = "<!-- /relay-review-checklist -->";

async function seedPack(rootDir: string): Promise<void> {
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    join(rootDir, "checklist.json"),
    `${JSON.stringify([
      {
        id: "job-home",
        test: "Home",
        status: "passed",
        jobId: "job-home",
        reviewCommand: visualReviewCommand("job-home"),
      },
    ])}\n`,
  );
  await writeFile(
    join(rootDir, "index.html"),
    `<main>${REVIEW_CHECKLIST_START}<p>old</p>${CHECKLIST_END}</main>\n`,
  );
}

test("finalize copies the pack to --export and merges --todo rows", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-export-todo-"));
  try {
    const rootDir = join(directory, "pack");
    const exportDir = join(directory, "out");
    const todoFile = join(directory, "todo.json");
    await seedPack(rootDir);
    await writeFile(todoFile, JSON.stringify([{ id: "chat-heavy", title: "Chat Heavy" }]));
    const finalized = await finalizeExportedEvidencePack({
      rootDir,
      exportDir,
      todoFile,
    });
    assert.equal(finalized.exportDir, exportDir);
    const copied = await readFile(join(exportDir, "index.html"), "utf8");
    assert.match(copied, /Chat Heavy/);
    assert.match(copied, /data-status="todo"/);
    assert.match(copied, /relay run visual review job-home/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("plan run --export invokes combine export with the campaign id", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-plan-export-"));
  try {
    const rootDir = join(directory, "pack");
    const exportDir = join(directory, "out");
    await seedPack(rootDir);
    const calls: unknown[] = [];
    const result = await exportWatchedCombinePack({
      operationId: "job.combine.start",
      exportDir,
      started: { campaign: { id: "camp-1" } },
      invoke: async (operationId, payload) => {
        calls.push({ operationId, payload });
        return { rootDir };
      },
    });
    assert.deepEqual(calls, [
      { operationId: "job.combine.export", payload: { batchId: "camp-1" } },
    ]);
    assert.deepEqual(result, { rootDir, exportDir });
    assert.match(await readFile(join(exportDir, "index.html"), "utf8"), /relay-review-checklist/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("plan export --export/--todo leave other operations unchanged", async () => {
  const summarized = await finalizeCombineExportResult({
    operationId: "job.get",
    result: { rootDir: "/tmp/pack" },
    summarized: { ok: true },
    exportDir: "/tmp/out",
  });
  assert.deepEqual(summarized, { ok: true });
});
