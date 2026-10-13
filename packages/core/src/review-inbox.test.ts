import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { listReviewInbox } from "./review-inbox.js";
import { catalogSummaries, rebuildRunCatalog } from "./run-catalog.js";

const NOW = 1_800_000_000_000;

async function writeRun(
  root: string,
  id: string,
  testId: string,
  extra: Record<string, unknown>,
): Promise<void> {
  const dir = join(root, id);
  await mkdir(dir, { recursive: true });
  const raw = JSON.stringify({
    schemaVersion: 5,
    id,
    dir,
    action: `app-map:shop:test:${testId}:root:r1`,
    title: testId,
    status: "ok",
    queuedAt: NOW - 3_000,
    finishedAt: NOW - 1_000,
    writtenAt: NOW - 1_000,
    platform: "browser",
    serial: "chrome",
    frames: [],
    artifacts: [
      {
        kind: "capture-review",
        capturedAt: NOW - 2_000,
        data: {
          caption: `${testId} screen`,
          framePath: "frames/001.png",
          imageSha256: createHash("sha256").update(id).digest("hex"),
          checkpointId: `${testId}-screen`,
          attempt: 1,
        },
      },
    ],
    ...extra,
  });
  await writeFile(join(dir, "run.json"), raw);
  await writeFile(
    join(dir, ".complete"),
    JSON.stringify({ digest: createHash("sha256").update(raw).digest("hex") }),
  );
}

test("passing runs leave the review inbox unless a Plan asked a person to look", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-review-inbox-"));
  const previous = process.env.RELAY_RUNS_DIR;
  process.env.RELAY_RUNS_DIR = root;
  try {
    await writeRun(root, "run-pass", "checkout", { outcome: "passed" });
    await writeRun(root, "run-fail", "search", { outcome: "product-failure" });
    await writeRun(root, "run-human", "login", {
      outcome: "passed",
      referenceReviewMode: "human",
    });
    await rebuildRunCatalog(root);

    // A catalog written before the policy still counts the passing run's screenshot.
    const db = new DatabaseSync(join(root, ".catalog.sqlite"));
    db.prepare(
      `UPDATE runs SET capture_summary_json='{"captured":1,"missing":0,"pending":1,"accepted":0,"issue":0,"needMoreEvidence":0}' WHERE id='run-pass'`,
    ).run();
    db.prepare("DELETE FROM metadata WHERE key='capture-summary-passing-run-v1'").run();
    db.close();
    const passing = (await catalogSummaries(root)).find((summary) => summary.id === "run-pass");
    assert.equal(passing?.captureSummary?.pending, 0);
    assert.equal(passing?.captureSummary?.accepted, 1);

    const inbox = await listReviewInbox(root, { now: NOW });
    assert.deepEqual(inbox.entries.map((entry) => entry.runId).sort(), ["run-fail", "run-human"]);
    assert.equal(inbox.totals.pending, 2);

    const count = await listReviewInbox(root, { now: NOW, countOnly: true });
    assert.deepEqual(count.entries, []);
    assert.equal(count.totals.pending, 2, "the badge count matches the list");

    // A rewritten manifest is read again rather than served from memory.
    await writeRun(root, "run-fail", "search", {
      outcome: "product-failure",
      captureReviews: [
        {
          captureId: inbox.entries.find((entry) => entry.runId === "run-fail")!.items[0]!.captureId,
          action: "accept",
          decidedAt: NOW,
          decidedBy: { id: "human:qa", kind: "human" },
        },
      ],
    });
    const after = await listReviewInbox(root, { now: NOW });
    assert.deepEqual(
      after.entries.map((entry) => entry.runId),
      ["run-human"],
    );
  } finally {
    if (previous === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
