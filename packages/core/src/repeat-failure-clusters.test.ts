import assert from "node:assert/strict";
import test from "node:test";
import type { CombineCampaign } from "@relay/protocol";
import { buildRepeatFailureClusters, repeatFailureSignature } from "./repeat-failure-clusters.js";
import type { PersistedRun } from "./runs.js";

function run(input: {
  id: string;
  error?: string;
  failureCategory?: PersistedRun["failureCategory"];
  artifacts?: PersistedRun["artifacts"];
  review?: PersistedRun["review"];
}): PersistedRun {
  return {
    schemaVersion: 5,
    id: input.id,
    projectId: "project",
    ownerId: "agent:test",
    action: "app-map:test",
    status: "error",
    attempts: 1,
    queuedAt: 1,
    finishedAt: 10,
    logs: [],
    steps: [],
    frames: [],
    dir: "/tmp/run",
    writtenAt: 10,
    artifacts: input.artifacts ?? [
      {
        kind: "campaign-check-result",
        capturedAt: 10,
        data: {
          id: "check-language",
          title: "Language check",
          status: "failed",
          error: input.error ?? "Content assertion: expected translated title",
          startedAt: 1,
          finishedAt: 10,
        },
      },
    ],
    inputDigest: "a".repeat(64),
    resolvedInputs: {},
    ...(input.error ? { error: input.error } : {}),
    ...(input.failureCategory ? { failureCategory: input.failureCategory } : {}),
    ...(input.review ? { review: input.review } : {}),
  } as PersistedRun;
}

function campaign(): CombineCampaign {
  return {
    schemaVersion: 1,
    id: "campaign",
    projectId: "project",
    appMapId: "map",
    combineId: "languages",
    sourceRevision: 1,
    latestRevision: 1,
    status: "completed-with-problems",
    createdAt: 1,
    updatedAt: 2,
    cases: [
      {
        index: 0,
        cellId: "cell-en",
        testId: "test",
        world: "English",
        values: { language: "en" },
        targetProfileId: "pixel-1",
        childIntentDigest: "a",
        outerIntentDigest: "b",
        wrapperGraphDigest: "c",
        staticInputDigest: "d",
        phase: "coverage",
        status: "failed",
        jobId: "job-en",
        runId: "run-en",
      },
      {
        index: 1,
        cellId: "cell-pt",
        testId: "test",
        world: "Português",
        values: { language: "pt-BR" },
        targetProfileId: "pixel-1",
        childIntentDigest: "a",
        outerIntentDigest: "b",
        wrapperGraphDigest: "c",
        staticInputDigest: "d",
        phase: "coverage",
        status: "failed",
        jobId: "job-pt",
        runId: "run-pt",
        priorRunIds: ["old-pt"],
      },
    ],
    lineage: [],
    execution: { selectedCellIds: ["cell-en", "cell-pt"], seed: 1 },
  };
}

test("Repeat failure signatures ignore run ids, locales, and object insertion order", () => {
  const first = run({ id: "run-en", error: "Content assertion: expected title" });
  const second = run({
    id: "run-pt",
    error: "Content assertion: expected title",
    artifacts: [
      {
        kind: "campaign-check-result",
        capturedAt: 20,
        data: {
          finishedAt: 20,
          startedAt: 1,
          error: "Content assertion: expected title",
          status: "failed",
          title: "Language check",
          id: "check-language",
        },
      },
    ],
  });
  assert.equal(repeatFailureSignature(first)?.digest, repeatFailureSignature(second)?.digest);
  assert.equal(repeatFailureSignature(first)?.kind, "causal");
});

test("clusters preserve independent cell evidence and review decisions", () => {
  const report = buildRepeatFailureClusters(campaign(), [
    run({ id: "run-en" }),
    run({
      id: "run-pt",
      review: {
        schemaVersion: 1,
        status: "rejected",
        capability: "run",
        reason: "Review the Portuguese evidence",
        requestedAt: 11,
        decidedAt: 12,
      },
    }),
  ]);
  assert.equal(report.clusters.length, 1);
  assert.deepEqual(
    report.clusters[0]!.cases.map((item) => [item.cellId, item.runId]),
    [
      ["cell-en", "run-en"],
      ["cell-pt", "run-pt"],
    ],
  );
  assert.deepEqual(report.clusters[0]!.cases[1]!.priorRunIds, ["old-pt"]);
  assert.equal(report.clusters[0]!.cases[1]!.decision?.status, "rejected");
  assert(
    report.clusters[0]!.cases.every((item) => item.evidenceRefs.includes(`run:${item.runId}`)),
  );
});

test("leftover Close 004 last-frame cannot fill dest evidence refs", () => {
  const destEnd = run({
    id: "run-en",
    artifacts: [
      {
        kind: "campaign-check-result",
        capturedAt: 10,
        data: {
          id: "check-language",
          title: "Language check",
          status: "failed",
          error: "Content assertion: expected translated title",
          startedAt: 1,
          finishedAt: 10,
        },
      },
      {
        kind: "capture-review",
        capturedAt: 10,
        data: {
          caption: "Observe",
          framePath: "frames/003.png",
          phase: "dest",
          policy: "fast",
        },
      },
      {
        kind: "capture-review",
        capturedAt: 11,
        data: { caption: "Close", framePath: "frames/004.png" },
      },
    ],
  });
  destEnd.frames = [
    { path: "frames/003.png", caption: "Observe", capturedAt: 10 },
    { path: "frames/004.png", caption: "after · Run saved Test", capturedAt: 11 },
  ];
  const report = buildRepeatFailureClusters(campaign(), [destEnd, run({ id: "run-pt" })]);
  const refs = report.clusters[0]!.cases.find((item) => item.runId === "run-en")?.evidenceRefs;
  assert.ok(refs?.includes("run:run-en"));
  assert.ok(refs?.includes("run:run-en#frame:0"));
  assert.equal(refs?.includes("run:run-en#frame:1"), false);
});

test("opener Tap beside leftover Transition cannot fill dest evidence refs", () => {
  const destEnd = run({
    id: "run-en",
    artifacts: [
      {
        kind: "campaign-check-result",
        capturedAt: 10,
        data: {
          id: "check-language",
          title: "Language check",
          status: "failed",
          error: "Content assertion: expected translated title",
          startedAt: 1,
          finishedAt: 10,
        },
      },
      {
        kind: "capture-review",
        capturedAt: 10,
        data: { caption: "Observe", framePath: "frames/003.png", policy: "fast" },
      },
    ],
  });
  destEnd.frames = [
    {
      path: "frames/001.png",
      caption: "before · Tap identifier sidebar.open.button",
      capturedAt: 8,
    },
    { path: "frames/002.png", caption: "after · Transition executed", capturedAt: 9 },
    { path: "frames/003.png", caption: "Observe", capturedAt: 10 },
    { path: "frames/004.png", caption: "after · Transition executed", capturedAt: 11 },
  ];
  const report = buildRepeatFailureClusters(campaign(), [destEnd, run({ id: "run-pt" })]);
  const refs = report.clusters[0]!.cases.find((item) => item.runId === "run-en")?.evidenceRefs;
  assert.ok(refs?.includes("run:run-en"));
  assert.ok(refs?.includes("run:run-en#frame:2"));
  assert.equal(refs?.includes("run:run-en#frame:0"), false);
  assert.equal(refs?.includes("run:run-en#frame:1"), false);
  assert.equal(refs?.includes("run:run-en#frame:3"), false);
});

test("failure kind and target cohort filters are deterministic", () => {
  const input = campaign();
  input.cases[1]!.targetProfileId = "pixel-2";
  const network = run({
    id: "run-pt",
    error: "Request failed with HTTP 503",
    failureCategory: "environment",
    artifacts: [
      {
        kind: "network",
        capturedAt: 10,
        data: { entries: [{ method: "GET", status: 503, url: "https://example.test/api/items" }] },
      },
    ],
  });
  const report = buildRepeatFailureClusters(input, [run({ id: "run-en" }), network], {
    failureKind: "network",
    cohort: "pixel-2",
  });
  assert.equal(report.clusters.length, 1);
  assert.equal(report.clusters[0]!.kind, "network");
  assert.deepEqual(
    report.clusters[0]!.cases.map((item) => item.cellId),
    ["cell-pt"],
  );
});
