import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { RunShareRecord } from "./run-shares.js";
import type { PersistedRun } from "./runs.js";
import {
  buildRunShareReport,
  createRunShare,
  findActiveRunSharePath,
  listRunShares,
  publicShareBaseUrl,
  pruneExpiredShares,
  resolveRunShareToken,
  resolveRunShareTokenState,
  revokeRunShare,
} from "./run-shares.js";
import { loadRedactionPolicy } from "./redaction.js";

function traceStep(
  title: string,
  status: PersistedRun["steps"][number]["status"],
): PersistedRun["steps"][number] {
  return {
    id: title,
    index: 0,
    kind: "Replay",
    tone: status === "error" ? "fail" : "acc",
    title,
    glyphs: [],
    startedAt: 0,
    log: "",
    frames: [],
    ...(status ? { status } : {}),
  };
}

function run(input: {
  id: string;
  batchId?: string;
  caseIndex?: number;
  frames?: number;
  outcome?: PersistedRun["outcome"];
  status?: PersistedRun["status"];
}): PersistedRun {
  return {
    schemaVersion: 5,
    id: input.id,
    projectId: "project-a",
    ownerId: "owner-a",
    action: "settings-tour",
    title: "Settings tour",
    status: input.status ?? (input.outcome === "product-failure" ? "error" : "ok"),
    platform: "android",
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
    assert.deepEqual(report.totals, {
      runs: 2,
      passed: 1,
      problems: 1,
      screenshots: 4,
      inProgress: 0,
    });
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

function withEnv(key: string, value: string | undefined): () => void {
  const previous = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  return () => {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  };
}

test("createRunShare absolutizes the share link only when a public base URL is configured", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-run-share-url-"));
  const sharedRun = run({ id: "run-a", outcome: "passed" });
  const lifetime = 60 * 60 * 1_000;
  try {
    const restoreBase = withEnv("RELAY_PUBLIC_BASE_URL", undefined);
    const bare = await createRunShare({
      root,
      run: sharedRun,
      relatedRuns: [sharedRun],
      actorId: "human:a",
      expiresAt: 10_000 + lifetime,
      includeBatch: false,
      at: 10_000,
    });
    assert.equal(bare.url, undefined);
    assert.match(bare.path, /^\/shared\/runs\//u);

    const restoreHttps = withEnv("RELAY_PUBLIC_BASE_URL", "https://proof.example.com");
    const absolute = await createRunShare({
      root,
      run: sharedRun,
      relatedRuns: [sharedRun],
      actorId: "human:a",
      expiresAt: 30_000 + lifetime,
      includeBatch: false,
      at: 30_000,
    });
    assert.equal(absolute.url, `https://proof.example.com${absolute.path}`);

    const restoreTrailingPath = withEnv(
      "RELAY_PUBLIC_BASE_URL",
      "http://relay.internal:8787/prefix",
    );
    const prefixed = await createRunShare({
      root,
      run: sharedRun,
      relatedRuns: [sharedRun],
      actorId: "human:a",
      expiresAt: 40_000 + lifetime,
      includeBatch: false,
      at: 40_000,
    });
    assert.equal(prefixed.url, `http://relay.internal:8787${prefixed.path}`);

    assert.throws(() => publicShareBaseUrl("ftp://proof.example.com"), /absolute http\(s\) URL/u);
    assert.throws(() => publicShareBaseUrl("not-a-url"), /absolute http\(s\) URL/u);
    restoreTrailingPath();
    restoreHttps();
    restoreBase();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("share reports project the proof block and failed-step drill-in from persisted runs", () => {
  const record: RunShareRecord = {
    schemaVersion: 1,
    id: "share-1",
    runId: "run-a",
    runIds: ["run-a"],
    projectId: "project-a",
    title: "Proof report",
    createdAt: 1,
    expiresAt: 10_000,
    createdBy: "human:a",
    frameCount: 1,
  };
  const failedRun: PersistedRun = {
    ...run({ id: "run-a", frames: 1 }),
    status: "error",
    failureCategory: "locator",
    appVersion: "2.7.1",
    deviceName: "Pixel 8",
    targetProfile: {
      id: "pixel-8-1080x2400",
      targetId: "pixel-8",
      source: "device",
      platform: "android",
      name: "Pixel 8",
      capabilities: [],
      observedAt: 1,
    },
    startedAt: 100,
    finishedAt: 340,
    steps: [
      traceStep("Open settings", "ok"),
      traceStep("Tap About phone", "error"),
      traceStep("Read version", "running"),
    ],
    artifacts: [
      {
        kind: "app-map-test-execution-intent",
        capturedAt: 1,
        data: { sourcePlan: { appMapRevision: 42 } },
      },
    ],
    resolvedInputs: { password: "hidden", commit_sha: "abc123def456", pr_number: "17" },
  };
  const report = buildRunShareReport(record, [failedRun]);

  assert.deepEqual(report.provenance, {
    appVersion: "2.7.1",
    platform: "android",
    profileId: "pixel-8-1080x2400",
    deviceName: "Pixel 8",
    appMapRevision: 42,
    sourceRevision: { sha: "abc123def456", prNumber: 17 },
    startedAt: 100,
    completedAt: 340,
  });
  const failedReport = report.runs[0]!;
  assert.deepEqual(failedReport.failedStep, {
    index: 1,
    total: 3,
    label: "Tap About phone",
  });
  assert.equal(failedReport.failureCategory, "locator");

  // Healthy runs never carry drill-in fields.
  const healthyRecord: RunShareRecord = { ...record, runIds: ["run-b"], runId: "run-b" };
  const healthyReport = buildRunShareReport(healthyRecord, [
    {
      ...run({ id: "run-b", outcome: "passed" }),
      steps: [traceStep("Only step", "ok")],
      resolvedInputs: {},
    },
  ]);
  assert.equal(healthyReport.runs[0]?.failedStep, undefined);
  assert.equal(healthyReport.runs[0]?.failureCategory, undefined);
  assert.equal(healthyReport.provenance?.sourceRevision, undefined);
  assert.equal(healthyReport.provenance?.appMapRevision, undefined);
});

test("totals exclude non-terminal runs from problems and surface them as in progress", () => {
  const record: RunShareRecord = {
    schemaVersion: 1,
    id: "share-1",
    runId: "run-a",
    runIds: ["run-a", "run-b", "run-c", "run-d"],
    projectId: "project-a",
    title: "Matrix report",
    createdAt: 1,
    expiresAt: 10_000,
    createdBy: "human:a",
    frameCount: 4,
  };
  const report = buildRunShareReport(record, [
    run({ id: "run-a", outcome: "passed" }),
    run({ id: "run-b", outcome: "product-failure" }),
    run({ id: "run-c", status: "running" }),
    { ...run({ id: "run-d" }), status: "queued" },
  ]);
  assert.deepEqual(report.totals, {
    runs: 4,
    passed: 1,
    problems: 1,
    screenshots: 4,
    inProgress: 2,
  });
});

test("pruneExpiredShares removes expired records and keeps active ones", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-run-share-prune-"));
  const at = 30_000;
  const sharedRun = run({ id: "run-a", frames: 1, outcome: "passed" });
  try {
    await createRunShare({
      root,
      run: sharedRun,
      relatedRuns: [sharedRun],
      actorId: "human:reviewer",
      expiresAt: at + 60 * 60 * 1_000,
      includeBatch: false,
      at,
    });
    // Age the only record past its expiry by rewriting the store directly.
    const store = join(root, ".run-shares.json");
    const parsed = JSON.parse(await readFile(store, "utf8")) as {
      shares: Array<{ expiresAt: number }>;
    };
    parsed.shares[0]!.expiresAt = at - 1;
    await writeFile(store, `${JSON.stringify(parsed, null, 2)}\n`);

    assert.equal(await pruneExpiredShares(root, at), 1);
    assert.equal(await pruneExpiredShares(root, at), 0);
    assert.deepEqual(await listRunShares(root, { projectId: "project-a" }, at), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resolveRunShareTokenState distinguishes expired from invalid tokens", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-run-share-state-"));
  const at = 40_000;
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
    const active = await resolveRunShareTokenState(root, created.token, at + 1);
    assert.equal(active.state, "active");
    if (active.state === "active") assert.equal(active.record.id, created.share.id);

    const expiredAt = created.share.expiresAt;
    assert.equal(
      (await resolveRunShareTokenState(root, created.token, expiredAt)).state,
      "expired",
    );
    assert.equal(
      (await resolveRunShareTokenState(root, `not-a-token.${created.token}`, at + 1)).state,
      "invalid",
    );

    await revokeRunShare({
      root,
      id: created.share.id,
      scope: { projectId: "project-a", ownerId: "owner-a" },
      actorId: "human:reviewer",
      at: at + 2,
    });
    assert.equal((await resolveRunShareTokenState(root, created.token, at + 3)).state, "invalid");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("findActiveRunSharePath returns a resolvable token path only for live shares", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-run-share-find-"));
  const at = 50_000;
  const lifetime = 60 * 60 * 1_000;
  const sharedRun = run({ id: "run-find", outcome: "passed" });
  const otherRun = run({ id: "run-other", outcome: "passed" });
  try {
    // No store yet: no path, never a fabricated one.
    assert.equal(await findActiveRunSharePath(root, sharedRun.id, at), undefined);

    const created = await createRunShare({
      root,
      run: sharedRun,
      relatedRuns: [sharedRun],
      actorId: "human:a",
      expiresAt: at + lifetime,
      includeBatch: false,
      at,
    });
    const path = await findActiveRunSharePath(root, sharedRun.id, at + 1);
    assert.ok(path);
    assert.match(path, /^\/shared\/runs\//u);
    // The path resolves to the same record the token in createRunShare did.
    const token = path.slice("/shared/runs/".length);
    assert.equal((await resolveRunShareTokenState(root, token, at + 1)).state, "active");
    // A run the share does not cover stays linkless.
    assert.equal(await findActiveRunSharePath(root, otherRun.id, at + 1), undefined);

    // Revoked shares stop producing paths.
    await revokeRunShare({
      root,
      id: created.share.id,
      scope: { projectId: "project-a", ownerId: "owner-a" },
      actorId: "human:a",
      at: at + 2,
    });
    assert.equal(await findActiveRunSharePath(root, sharedRun.id, at + 3), undefined);

    // A fresh share past its expiry is equally linkless.
    const expired = await createRunShare({
      root,
      run: sharedRun,
      relatedRuns: [sharedRun],
      actorId: "human:a",
      expiresAt: at + lifetime,
      includeBatch: false,
      at: at + 10,
    });
    assert.equal(await findActiveRunSharePath(root, sharedRun.id, expired.share.expiresAt + 1), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
