import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { PersistedRun } from "./runs.js";
import {
  buildRunShareReport,
  createRunShare,
  listRunShares,
  resolveRunShareToken,
  revokeRunShare,
} from "./run-shares.js";
import { loadRedactionPolicy } from "./redaction.js";

function run(input: {
  id: string;
  batchId?: string;
  caseIndex?: number;
  frames?: number;
  outcome?: PersistedRun["outcome"];
}): PersistedRun {
  return {
    schemaVersion: 5,
    id: input.id,
    projectId: "project-a",
    ownerId: "owner-a",
    action: "settings-tour",
    title: "Settings tour",
    platform: "android",
    status: input.outcome === "product-failure" ? "error" : "ok",
    ...(input.outcome ? { outcome: input.outcome } : {}),
    ...(input.outcome === "product-failure"
      ? { error: "Element not found: Bearer secret-token-123" }
      : {}),
    ...(input.batchId ? { batchId: input.batchId } : {}),
    ...(input.caseIndex !== undefined ? { caseIndex: input.caseIndex, caseCount: 2 } : {}),
    attempts: 1,
    queuedAt: 1,
    startedAt: 2,
    finishedAt: 102,
    durationMs: 100,
    logs: ["private log"],
    steps: [],
    frames: Array.from({ length: input.frames ?? 1 }, (_, index) => ({
      path: `frames/${index + 1}.png`,
      caption: `Screen ${index + 1}`,
      capturedAt: 10 + index,
      mime: "image/png",
      width: 100,
      height: 200,
    })),
    dir: `/runs/${input.id}`,
    writtenAt: 200 + (input.caseIndex ?? 0),
    artifacts: [{ kind: "secret", capturedAt: 2, data: { token: "hidden" } }],
    inputDigest: "digest",
    resolvedInputs: { password: "hidden" },
  };
}

test("creates a durable signed batch share and projects only bounded report evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-run-share-"));
  const at = 10_000;
  const previousMode = process.env.RELAY_REDACTION_MODE;
  process.env.RELAY_REDACTION_MODE = "on";
  await loadRedactionPolicy();
  const first = run({
    id: "run-a",
    batchId: "batch-a",
    caseIndex: 0,
    frames: 2,
    outcome: "passed",
  });
  const second = run({
    id: "run-b",
    batchId: "batch-a",
    caseIndex: 1,
    frames: 2,
    outcome: "product-failure",
  });
  try {
    const created = await createRunShare({
      root,
      run: first,
      relatedRuns: [second, first],
      actorId: "human:reviewer",
      expiresAt: at + 60 * 60 * 1_000,
      includeBatch: true,
      at,
    });
    assert.equal(created.share.runCount, 2);
    assert.equal(created.share.frameCount, 4);
    assert.match(created.path, /^\/shared\/runs\//u);
    assert.equal(
      (await listRunShares(root, { projectId: "project-a", ownerId: "owner-a" }, at)).length,
      1,
    );

    const record = await resolveRunShareToken(root, created.token, at + 1);
    assert.ok(record);
    const report = buildRunShareReport(record, [second, first]);
    assert.deepEqual(report.totals, { runs: 2, passed: 1, problems: 1, screenshots: 4 });
    assert.deepEqual(
      report.runs.map((item) => item.id),
      ["run-a", "run-b"],
    );
    assert.equal("logs" in report.runs[0]!, false);
    assert.equal("resolvedInputs" in report.runs[0]!, false);
    assert.equal("errorHeadline" in report.runs[0]!, false);
    assert.match(report.runs[1]!.errorHeadline!, /Element not found/u);
    assert.doesNotMatch(report.runs[1]!.errorHeadline!, /secret-token-123/u);
    assert.equal("serial" in report.runs[0]!, false);

    const [body, signature] = created.token.split(".");
    assert.equal(await resolveRunShareToken(root, `${body}.${signature}x`, at + 1), null);
    assert.equal(await resolveRunShareToken(root, created.token, created.share.expiresAt), null);
    assert.equal((await stat(join(root, ".run-share-secret"))).mode & 0o777, 0o600);
    assert.doesNotMatch(
      await readFile(join(root, ".run-shares.json"), "utf8"),
      /private log|hidden/u,
    );
  } finally {
    if (previousMode === undefined) delete process.env.RELAY_REDACTION_MODE;
    else process.env.RELAY_REDACTION_MODE = previousMode;
    await loadRedactionPolicy();
    await rm(root, { recursive: true, force: true });
  }
});

test("revocation invalidates the bearer capability without deleting its audit summary", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-run-share-revoke-"));
  const at = 20_000;
  const sharedRun = run({ id: "run-a", frames: 1, outcome: "passed" });
  try {
    const created = await createRunShare({
      root,
      run: sharedRun,
      relatedRuns: [sharedRun],
      actorId: "human:reviewer",
      expiresAt: at + 60 * 60 * 1_000,
      includeBatch: false,
      at,
    });
    assert.equal(
      await revokeRunShare({
        root,
        id: created.share.id,
        scope: { projectId: "other-project", ownerId: "owner-a" },
        actorId: "human:reviewer",
        at: at + 1,
      }),
      null,
    );
    const revoked = await revokeRunShare({
      root,
      id: created.share.id,
      scope: { projectId: "project-a", ownerId: "owner-a" },
      actorId: "human:reviewer",
      at: at + 2,
    });
    assert.equal(revoked?.status, "revoked");
    assert.equal(await resolveRunShareToken(root, created.token, at + 3), null);
    assert.equal(
      (await listRunShares(root, { projectId: "project-a", runId: "run-a" }, at + 3))[0]?.status,
      "revoked",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
