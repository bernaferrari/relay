import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  catalogLatestRunPerTest,
  catalogSurfaceComparisons,
  catalogSummaries,
  catalogSummaryPage,
  indexRun,
  setRunPinned,
} from "./run-catalog.js";
import { runMatrixCase, runSummaryLineage } from "./run-matrix-case.js";
import {
  listPersistedRunSummariesPageAtRoot,
  listRunSummariesPageAtRoot,
  RunListCursorError,
} from "./run-summary-pagination.js";
import type { PersistedRun } from "./runs.js";

const matrix = {
  kind: "combine-cell",
  appMapId: "grok-ios",
  testId: "fast",
  combineId: "prompt-checks",
  cellId: "retained-cell",
  world: "value-1",
  values: { prompts: "value-1" },
  inputs: { chat_prompt: "Private runtime prompt must stay out of summaries" },
};

type CompanionData = {
  cell: { testId: string };
  child: { sourcePlan: { appMapId: string; testId: string } };
  nativeCompanion: {
    platform: string;
    appMapId: string;
    testId: string;
    requestedFrom: { appMapId: string; testId: string };
  };
};

function run(id: string, at: number, overrides: Partial<PersistedRun> = {}): PersistedRun {
  return {
    schemaVersion: 5,
    id,
    projectId: "project-a",
    ownerId: "owner-a",
    action: `cell-${id}`,
    title: "Prompt checks",
    status: "error",
    attempts: 1,
    queuedAt: at,
    startedAt: at,
    finishedAt: at + 1,
    durationMs: 1,
    batchId: "batch",
    logs: [],
    steps: [],
    frames: [],
    dir: "",
    writtenAt: at,
    inputDigest: "digest",
    resolvedInputs: {},
    artifacts: [
      {
        kind: "app-map-combine-cell-execution-intent",
        capturedAt: at,
        data: { child: { sourcePlan: { appMapId: "grok-ios", testId: "fast" } } },
      },
      { kind: "frozen-inputs", capturedAt: at, data: matrix },
    ],
    ...overrides,
  };
}

function companionRun(id: string, at: number, authoredMap = "grok-web"): PersistedRun {
  return run(id, at, {
    artifacts: [
      {
        kind: "app-map-combine-cell-execution-intent",
        capturedAt: at,
        data: {
          cell: { testId: "fast" },
          child: { sourcePlan: { appMapId: "grok-ios", testId: "native-fast" } },
          nativeCompanion: {
            platform: "ios",
            appMapId: "grok-ios",
            testId: "native-fast",
            requestedFrom: { appMapId: authoredMap, testId: "fast" },
          },
        },
      },
      { kind: "frozen-inputs", capturedAt: at, data: matrix },
    ],
  });
}

async function commit(root: string, record: PersistedRun): Promise<PersistedRun> {
  const next = { ...record, dir: join(root, record.id) };
  await mkdir(next.dir);
  const raw = JSON.stringify(next);
  await writeFile(join(next.dir, "run.json"), raw);
  await writeFile(
    join(next.dir, ".complete"),
    JSON.stringify({ digest: createHash("sha256").update(raw).digest("hex") }),
  );
  await indexRun(root, next as unknown as Record<string, unknown>);
  return next;
}

test("persisted matrix lineage uses only an exact owned frozen tuple", () => {
  const projected = runMatrixCase(run("current", 1));
  assert.deepEqual(projected, {
    kind: "combine",
    appMapId: "grok-ios",
    testId: "fast",
    combineId: "prompt-checks",
    world: "value-1",
    values: { prompts: "value-1" },
  });
  assert.equal(JSON.stringify(projected).includes("Private runtime prompt"), false);
  for (const data of [
    { ...matrix, appMapId: "foreign" },
    { ...matrix, testId: "foreign" },
    { ...matrix, combineId: "" },
    { ...matrix, combineId: " prompt-checks" },
    { ...matrix, kind: "single" },
    { ...matrix, values: { prompts: { secret: "private" } } },
    { ...matrix, appMapId: undefined },
    { ...matrix, world: undefined },
  ])
    assert.equal(
      runMatrixCase(
        run("invalid", 1, {
          artifacts: [
            run("owned", 1).artifacts[0]!,
            { kind: "frozen-inputs", capturedAt: 1, data },
          ],
        }),
      ),
      undefined,
    );
  assert.equal(
    runMatrixCase(
      run("ambiguous", 1, {
        artifacts: [
          ...run("owned", 1).artifacts,
          { kind: "frozen-inputs", capturedAt: 2, data: { ...matrix, combineId: "other" } },
        ],
      }),
    ),
    undefined,
  );
  assert.equal(
    runMatrixCase(run("single", 1, { action: "app-map:grok-ios:test:fast", artifacts: [] })),
    undefined,
  );
});

test("native companion lineage projects only the authored ownership proven by its receipt", () => {
  const historical = companionRun("companion", 1);
  const original = JSON.stringify(historical);
  const expected = {
    sourceTest: { appMapId: "grok-web", testId: "fast" },
    matrixCase: {
      kind: "combine",
      appMapId: "grok-web",
      testId: "fast",
      combineId: "prompt-checks",
      world: "value-1",
      values: { prompts: "value-1" },
    },
  };
  assert.deepEqual(runSummaryLineage(historical), expected);
  assert.equal(JSON.stringify(historical), original);
  const future = structuredClone(historical);
  (future.artifacts[1]!.data as Record<string, unknown>).appMapId = "grok-web";
  assert.deepEqual(runSummaryLineage(future), expected);
  for (const mutate of [
    (data: CompanionData) => {
      data.nativeCompanion.appMapId = "foreign";
    },
    (data: CompanionData) => {
      data.nativeCompanion.testId = "foreign";
    },
    (data: CompanionData) => {
      data.nativeCompanion.platform = "browser";
    },
    (data: CompanionData) => {
      data.nativeCompanion.requestedFrom.testId = "foreign";
    },
    (data: CompanionData) => {
      data.nativeCompanion.requestedFrom.appMapId = "";
    },
    (data: CompanionData) => {
      data.nativeCompanion.requestedFrom.appMapId = " grok-web";
    },
    (data: CompanionData) => {
      data.cell.testId = "foreign";
    },
    (data: CompanionData) => {
      data.child.sourcePlan.testId = "foreign";
    },
  ]) {
    const invalid = structuredClone(historical);
    mutate(invalid.artifacts[0]!.data as CompanionData);
    assert.equal(runMatrixCase(invalid), undefined);
  }
  const foreign = structuredClone(historical);
  (foreign.artifacts[1]!.data as Record<string, unknown>).appMapId = "foreign";
  assert.equal(runMatrixCase(foreign), undefined);
  const conflicting = structuredClone(historical);
  conflicting.artifacts.push(structuredClone(conflicting.artifacts[0]!));
  assert.equal(runMatrixCase(conflicting), undefined);
});

test("local and authenticated companion pages keep authored Plan ownership", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-companion-lineage-"));
  try {
    const companion = await commit(root, companionRun("companion", 1));
    const local = await catalogSummaryPage(root, 40, undefined, undefined, "grok-web");
    assert.equal(local.totalCount, 1);
    assert.deepEqual(local.summaries[0]!.sourceTest, { appMapId: "grok-web", testId: "fast" });
    assert.equal(local.summaries[0]!.matrixCase!.appMapId, "grok-web");
    assert.equal(local.summaries[0]!.matrixCase!.combineId, "prompt-checks");
    const authenticated = await listPersistedRunSummariesPageAtRoot({
      rootDirectory: root,
      projectId: "project-a",
      ownerId: "owner-a",
      appMapId: "grok-web",
      loadRuns: async () => [companion],
    });
    assert.deepEqual(authenticated.runs[0]!.sourceTest, local.summaries[0]!.sourceTest);
    assert.deepEqual(authenticated.runs[0]!.matrixCase, local.summaries[0]!.matrixCase);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("retained catalog lineage backfills once and preserves pagination, pins and manifests", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-retained-lineage-"));
  try {
    const old = await commit(root, run("old", 1));
    await commit(root, run("newer", 2));
    const invalid = await commit(root, run("invalid-marker", 3));
    await writeFile(join(invalid.dir, ".complete"), JSON.stringify({ digest: "invalid" }));
    await setRunPinned(root, old.id, true);
    const before = await readFile(join(old.dir, "run.json"), "utf8");
    const db = new DatabaseSync(join(root, ".catalog.sqlite"));
    db.exec(
      "UPDATE runs SET matrix_case_json=NULL; DELETE FROM metadata WHERE key='matrix-case-v1'; PRAGMA user_version=4",
    );
    db.close();
    const [first, all] = await Promise.all([
      listRunSummariesPageAtRoot({
        rootDirectory: root,
        projectId: "project-a",
        appMapId: "grok-ios",
        limit: 1,
      }),
      catalogSummaries(root),
    ]);
    assert.equal(first.totalCount, 3);
    assert.equal(first.runs[0]!.id, invalid.id);
    assert.equal(
      first.runs[0]!.matrixCase,
      undefined,
      "uncommitted evidence must not acquire Plan lineage",
    );
    assert.equal(all.find((item) => item.id === old.id)!.matrixCase!.combineId, "prompt-checks");
    assert.equal(all.find((item) => item.id === old.id)!.pinned, true);
    assert.equal(await readFile(join(old.dir, "run.json"), "utf8"), before);
    const second = await listRunSummariesPageAtRoot({
      rootDirectory: root,
      projectId: "project-a",
      appMapId: "grok-ios",
      limit: 1,
      cursor: first.nextCursor,
    });
    assert.equal(second.runs[0]!.id, "newer");
    assert.equal(second.runs[0]!.matrixCase!.combineId, "prompt-checks");
    await assert.rejects(
      listRunSummariesPageAtRoot({
        rootDirectory: root,
        projectId: "other-project",
        appMapId: "grok-ios",
        cursor: first.nextCursor,
      }),
      RunListCursorError,
    );
    // Corrupting a fixture after migration detects an accidental per-page scan.
    await writeFile(join(old.dir, "run.json"), "not JSON");
    assert.equal(
      (await catalogSummaryPage(root)).summaries.find((item) => item.id === old.id)!.matrixCase!
        .combineId,
      "prompt-checks",
    );
    assert.equal((await catalogLatestRunPerTest(root, "grok-ios"))[0]!.id, invalid.id);
    await commit(root, run("fresh", 4));
    assert.equal(
      (await catalogSummaryPage(root)).summaries[0]!.matrixCase!.combineId,
      "prompt-checks",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("summary migration preserves newer indexed state while filling missing lineage", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-lineage-mutable-state-"));
  try {
    const stale = await commit(root, run("existing", 1));
    const missing = await commit(root, run("missing", 2));
    const cacheKey = `surface-comparison-v1-${"a".repeat(64)}`;
    const current = {
      ...stale,
      status: "ok",
      outcome: "passed",
      writtenAt: 10,
      review: {
        schemaVersion: 1,
        status: "approved",
        capability: "generation",
        reason: "Reviewed current result",
        requestedAt: 1,
        decidedAt: 9,
      },
      artifacts: [
        ...stale.artifacts,
        {
          kind: "logical-scroll-surface-result",
          capturedAt: 9,
          data: { cache: { key: cacheKey } },
        },
      ],
    };
    // The migration can have read this older committed manifest before a
    // current writer indexes its updated result. Never write that stale state
    // back over the current catalog row.
    await indexRun(root, current);
    const db = new DatabaseSync(join(root, ".catalog.sqlite"));
    db.prepare("DELETE FROM runs WHERE id=?").run(missing.id);
    db.prepare("UPDATE runs SET matrix_case_json=NULL WHERE id=?").run(stale.id);
    const before = db.prepare("SELECT * FROM runs WHERE id=?").get(stale.id)!;
    db.close();
    const page = await catalogSummaryPage(root);
    assert.deepEqual(
      page.summaries.map((item) => item.id),
      [stale.id, missing.id],
    );
    assert.equal(page.summaries[0]!.status, "ok");
    assert.equal(page.summaries[0]!.outcome, "passed");
    assert.deepEqual(page.summaries[0]!.review, current.review);
    assert.equal(page.summaries[0]!.matrixCase!.combineId, "prompt-checks");
    assert.equal(page.summaries[1]!.matrixCase!.combineId, "prompt-checks");
    const checked = new DatabaseSync(join(root, ".catalog.sqlite"));
    const after = checked.prepare("SELECT * FROM runs WHERE id=?").get(stale.id)!;
    checked.close();
    assert.deepEqual({ ...after, matrix_case_json: null }, { ...before });
    assert.deepEqual(await catalogSurfaceComparisons(root, cacheKey), [
      { runId: stale.id, at: 10, artifactCapturedAt: 9 },
    ]);
    assert.equal(JSON.parse(await readFile(join(stale.dir, "run.json"), "utf8")).status, "error");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("authenticated lineage pagination retains exact Project and owner fences", async () => {
  const records = [
    run("older", 1),
    run("latest", 2),
    run("foreign-project", 3, { projectId: "other" }),
    run("foreign-owner", 4, { ownerId: "other" }),
    run("standalone", 0, { action: "app-map:grok-ios:test:fast", artifacts: [] }),
  ];
  const input = {
    rootDirectory: "/unused",
    projectId: "project-a",
    ownerId: "owner-a",
    appMapId: "grok-ios",
    limit: 1,
    loadRuns: async () => records,
  };
  const first = await listPersistedRunSummariesPageAtRoot(input);
  assert.equal(first.totalCount, 3);
  assert.equal(first.runs[0]!.id, "latest");
  assert.equal(first.runs[0]!.matrixCase!.combineId, "prompt-checks");
  assert.equal(JSON.stringify(first).includes("Private runtime prompt"), false);
  const second = await listPersistedRunSummariesPageAtRoot({ ...input, cursor: first.nextCursor });
  assert.equal(second.runs[0]!.id, "older");
  const third = await listPersistedRunSummariesPageAtRoot({ ...input, cursor: second.nextCursor });
  assert.equal(third.runs[0]!.id, "standalone");
  assert.equal(third.runs[0]!.matrixCase, undefined);
  await assert.rejects(
    listPersistedRunSummariesPageAtRoot({ ...input, ownerId: "other", cursor: first.nextCursor }),
    RunListCursorError,
  );
});
