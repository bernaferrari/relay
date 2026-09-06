import assert from "node:assert/strict";
import test from "node:test";
import {
  createProductRunAcrossService,
  previewProductRunAcross,
  selectProductBatchCases,
  summarizeProductBatch,
  type ProductRunAcrossSetup,
} from "./run-across.js";

const setup: ProductRunAcrossSetup = {
  appMapId: "app-1",
  appMapRevision: 3,
  testId: "test-1",
  testName: "Language settings",
  appName: "Grok",
  dataSet: {
    name: "Languages",
    dimensions: [
      {
        id: "language",
        name: "Language",
        kind: "language",
        values: [
          { id: "en", label: "English" },
          { id: "pt", label: "Português" },
        ],
      },
      {
        id: "theme",
        name: "Theme",
        kind: "theme",
        values: [
          { id: "light", label: "Light" },
          { id: "dark", label: "Dark" },
        ],
      },
    ],
  },
};

function batchWithStatuses(...statuses: Array<"passed" | "failed" | "blocked" | "cancelled">) {
  return {
    id: "batch-summary",
    navigation: { route: "/batches/$batchId", href: "/batches/batch-summary" },
    title: "Summary",
    status: "completed" as const,
    createdAt: 1,
    updatedAt: 2,
    cases: statuses.map((status, index) => ({
      id: `case-${index}`,
      index,
      phase: "coverage" as const,
      status,
      values: {},
    })),
    runIds: [],
    targetNames: [],
    totalCases: statuses.length,
    completedCases: statuses.length,
    passedCases: statuses.filter((status) => status === "passed").length,
    failedCases: statuses.filter((status) => status === "failed").length,
    pendingCases: 0,
  };
}

test("batch summaries preserve cancelled and blocked outcomes", () => {
  assert.equal(
    summarizeProductBatch({ ...batchWithStatuses(), status: "cancelled" }).headline,
    "Batch was cancelled",
  );
  assert.equal(summarizeProductBatch(batchWithStatuses()).headline, "No cases were run");
  assert.equal(
    summarizeProductBatch(batchWithStatuses("cancelled")).headline,
    "Batch was cancelled",
  );
  assert.equal(
    summarizeProductBatch(batchWithStatuses("blocked")).headline,
    "All selected cases are blocked",
  );
  assert.match(
    summarizeProductBatch(batchWithStatuses("passed", "blocked", "cancelled")).detail,
    /1 passed · 0 failed · 1 blocked · 1 cancelled · 0 remaining/u,
  );
  assert.equal(
    summarizeProductBatch(batchWithStatuses("passed", "passed")).headline,
    "All selected cases passed",
  );
});

test("preview exposes exact readable scope and a representative pilot", () => {
  const preview = previewProductRunAcross({
    setup,
    selected: { language: ["en", "pt"], theme: ["light", "dark"] },
    target: { kind: "device", platform: "android", targetId: "pixel-9", label: "Pixel 9" },
  });
  assert.equal(preview.caseCount, 4);
  assert.deepEqual(preview.pilot, { language: "en", theme: "light" });
  assert.equal(preview.scopeLabel, "4 cases on Pixel 9");
  assert.doesNotMatch(JSON.stringify(preview), /combine|cell|world/iu);
});

test("preview rejects values outside the saved data set", () => {
  assert.throws(
    () =>
      previewProductRunAcross({
        setup,
        selected: { language: ["fr"] },
        target: { kind: "device", platform: "android", targetId: "pixel-9" },
      }),
    /at least one value/u,
  );
});

test("start, continue, and export use the canonical durable campaign", async () => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const invoke = async (id: string, input: Record<string, unknown>) => {
    calls.push([id, input]);
    if (id === "app-map.get")
      return {
        appMap: {
          ...setup,
          id: "app-1",
          revision: 3,
          name: "Grok",
          tests: { "test-1": { id: "test-1", name: "Language settings" } },
          variables: {},
        },
      };
    if (id === "app-map.test.run") return { campaign: { id: "batch-1" } };
    if (id === "job.combine.export") return { rootDir: "/tmp/report", jobIds: ["job-1"] };
    return {
      campaign: {
        id: "batch-1",
        title: "Language settings",
        status: "ready-to-resume",
        createdAt: 1,
        updatedAt: 2,
        appMapId: "app-1",
        cases: [
          { status: "passed", runId: "run-1", target: { targetId: "pixel-9" } },
          { status: "pending", target: { targetId: "pixel-9" } },
        ],
      },
    };
  };
  const service = createProductRunAcrossService({ invoke } as never, {
    invoke: invoke as never,
  });
  const started = await service.startPilot({
    setup,
    selected: { language: ["en", "pt"] },
    target: { kind: "device", platform: "android", targetId: "pixel-9" },
  });
  assert.equal(started.id, "batch-1");
  await service.continue("batch-1");
  const report = await service.exportReport("batch-1");
  assert.deepEqual(report.export, { rootDir: "/tmp/report", jobIds: ["job-1"] });
  assert.deepEqual(report.cases, [
    {
      id: "case-1",
      index: 0,
      phase: "pilot",
      status: "passed",
      values: {},
      runId: "run-1",
    },
    {
      id: "case-2",
      index: 1,
      phase: "coverage",
      status: "pending",
      values: {},
    },
  ]);
  assert.deepEqual(
    calls.map(([id]) => id),
    [
      "app-map.test.run",
      "job.combine.campaign.get",
      "job.combine.campaign.resume",
      "job.combine.campaign.get",
      "job.combine.campaign.get",
      "job.combine.export",
    ],
  );
});

test("canonical cases expose Test × environment identity without inventing legacy identity", async () => {
  const invoke = async (id: string) => {
    assert.equal(id, "job.combine.campaign.get");
    return {
      campaign: {
        id: "batch-identity",
        title: "Language settings",
        status: "completed-with-problems",
        createdAt: 1,
        updatedAt: 2,
        appMapId: "app-1",
        cases: [
          {
            index: 0,
            cellId: "cell-pt",
            testId: "test-1",
            targetProfileId: "pixel-profile",
            target: { targetId: "pixel-9", platform: "android" },
            phase: "coverage",
            status: "failed",
            values: { language: "pt" },
            runId: "run-pt",
            priorRunIds: ["run-old"],
          },
          {
            index: 1,
            cellId: "legacy-cell",
            phase: "coverage",
            status: "failed",
            values: {},
          },
        ],
      },
    };
  };
  const service = createProductRunAcrossService({ invoke } as never, { invoke } as never);
  const batch = await service.inspect("batch-identity");
  assert.deepEqual(batch.cases[0]!.identity, {
    testId: "test-1",
    environmentId: "pixel-profile",
    environmentPlatform: "android",
    runId: "run-pt",
  });
  assert.deepEqual(batch.cases[0]!.priorRunIds, ["run-old"]);
  assert.equal(batch.cases[1]!.identity, undefined);
});

test("blocked cases are complete problems rather than pending work", async () => {
  const invoke = async () => ({
    campaign: {
      id: "batch-blocked",
      title: "Checkout",
      status: "completed-with-problems",
      createdAt: 1,
      updatedAt: 2,
      appMapId: "app-1",
      cases: [
        { cellId: "passed", status: "passed" },
        { cellId: "blocked", status: "blocked" },
        { cellId: "pending", status: "pending" },
      ],
    },
  });
  const service = createProductRunAcrossService({ invoke } as never, { invoke } as never);

  const batch = await service.inspect("batch-blocked");

  assert.equal(batch.completedCases, 2);
  assert.equal(batch.pendingCases, 1);
  assert.equal(batch.cases[1]?.status, "blocked");
});

test("failure clusters and selective rerun stay bounded and evidence-gated", async () => {
  const campaign = {
    id: "batch-triage",
    title: "Language settings",
    status: "completed-with-problems",
    createdAt: 1,
    updatedAt: 2,
    appMapId: "app-1",
    cases: [
      {
        index: 0,
        cellId: "cell-en",
        testId: "test-1",
        targetProfileId: "pixel-profile",
        target: { targetId: "pixel-9", platform: "android" },
        phase: "coverage",
        status: "failed",
        values: { language: "en" },
        runId: "run-en",
      },
      {
        index: 1,
        cellId: "cell-pt",
        testId: "test-1",
        targetProfileId: "pixel-profile",
        target: { targetId: "pixel-9", platform: "android" },
        phase: "coverage",
        status: "failed",
        values: { language: "pt" },
        runId: "run-pt",
      },
      {
        index: 2,
        cellId: "cell-pending",
        testId: "test-1",
        targetProfileId: "pixel-profile",
        target: { targetId: "pixel-9", platform: "android" },
        phase: "coverage",
        status: "pending",
        values: { language: "es" },
      },
    ],
  };
  const calls: Array<[string, Record<string, unknown>]> = [];
  const invoke = async (id: string, input: Record<string, unknown>) => {
    calls.push([id, input]);
    if (id === "job.combine.campaign.repeat.clusters") {
      return {
        schemaVersion: 1,
        campaignId: "batch-triage",
        clusters: [
          {
            schemaVersion: 1,
            id: "repeat-cluster:sha256:abc:pixel-profile",
            kind: "causal",
            cohort: "pixel-profile",
            representativeCellId: "cell-en",
            representativeRunId: "run-en",
            signature: {
              schemaVersion: 1,
              kind: "causal",
              digest: `sha256:${"a".repeat(64)}`,
              key: '{"kind":"causal"}',
              summary: "causal failure in check-1",
              checkIds: ["check-1"],
            },
            cases: [
              {
                cellId: "cell-en",
                runId: "run-en",
                priorRunIds: [],
                values: { language: "en" },
                world: "English",
                targetProfileId: "pixel-profile",
                status: "failed",
                signature: {
                  schemaVersion: 1,
                  kind: "causal",
                  digest: `sha256:${"a".repeat(64)}`,
                  key: '{"kind":"causal"}',
                  summary: "causal failure in check-1",
                  checkIds: ["check-1"],
                },
                evidenceRefs: ["run:run-en"],
              },
              {
                cellId: "cell-pt",
                runId: "run-pt",
                priorRunIds: [],
                values: { language: "pt" },
                world: "Portuguese",
                targetProfileId: "pixel-profile",
                status: "failed",
                signature: {
                  schemaVersion: 1,
                  kind: "causal",
                  digest: `sha256:${"a".repeat(64)}`,
                  key: '{"kind":"causal"}',
                  summary: "causal failure in check-1",
                  checkIds: ["check-1"],
                },
                evidenceRefs: ["run:run-pt"],
              },
            ],
          },
        ],
      };
    }
    return { campaign };
  };
  const service = createProductRunAcrossService({ invoke } as never, { invoke } as never);
  const productCases = [
    {
      id: "cell-en",
      index: 0,
      phase: "coverage" as const,
      status: "failed" as const,
      values: { language: "en" },
      runId: "run-en",
    },
    {
      id: "cell-pending",
      index: 2,
      phase: "coverage" as const,
      status: "pending" as const,
      values: { language: "es" },
    },
  ];
  const clusters = await service.getFailureClusters("batch-triage", {
    failureKind: "causal",
    environmentId: "pixel-profile",
  });
  assert.deepEqual(clusters.clusters[0], {
    id: "repeat-cluster:sha256:abc:pixel-profile",
    kind: "causal",
    signature: {
      kind: "causal",
      digest: `sha256:${"a".repeat(64)}`,
      summary: "causal failure in check-1",
      checkIds: ["check-1"],
    },
    environmentId: "pixel-profile",
    representativeCaseId: "cell-en",
    representativeRunId: "run-en",
    caseIds: ["cell-en", "cell-pt"],
  });
  calls.length = 0;
  await service.rerun("batch-triage", { clusterIds: ["repeat-cluster:sha256:abc:pixel-profile"] });
  assert.deepEqual(
    calls.map(([id, input]) => [id, input.cellIds]),
    [
      ["job.combine.campaign.get", undefined],
      ["job.combine.campaign.repeat.clusters", undefined],
      ["job.combine.campaign.resume", ["cell-en", "cell-pt"]],
      ["job.combine.campaign.get", undefined],
    ],
  );
  assert.deepEqual(
    selectProductBatchCases(
      {
        id: "batch-triage",
        cases: productCases,
      },
      { caseIds: ["cell-en"] },
    ),
    { caseIds: ["cell-en"], clusterIds: [] },
  );
  assert.throws(
    () =>
      selectProductBatchCases(
        {
          id: "batch-triage",
          cases: productCases,
        },
        { caseIds: ["cell-pending"] },
      ),
    /cannot be rerun/u,
  );
});

test("triage assigns review ownership without changing execution status", async () => {
  const campaign = {
    id: "batch-triage-ownership",
    title: "Language settings",
    status: "completed-with-problems",
    createdAt: 1,
    updatedAt: 2,
    appMapId: "app-1",
    cases: [
      {
        index: 0,
        cellId: "cell-en",
        testId: "test-1",
        targetProfileId: "pixel-profile",
        target: { targetId: "pixel-9", platform: "android" },
        phase: "coverage" as const,
        status: "failed",
        values: { language: "en" },
        runId: "run-en",
        triageStatus: "investigating",
        assignee: "human:qa",
      },
      {
        index: 1,
        cellId: "cell-pt",
        testId: "test-1",
        targetProfileId: "pixel-profile",
        target: { targetId: "pixel-9", platform: "android" },
        phase: "coverage" as const,
        status: "failed",
        values: { language: "pt" },
        runId: "run-pt",
      },
    ],
  };
  const calls: Array<[string, Record<string, unknown>]> = [];
  const invoke = async (id: string, input: Record<string, unknown>) => {
    calls.push([id, input]);
    assert.equal(id, "job.combine.campaign.triage");
    return { campaign };
  };
  const service = createProductRunAcrossService({ invoke } as never, { invoke } as never);
  const updated = await service.triage("batch-triage-ownership", {
    caseIds: ["cell-en"],
    triageStatus: "investigating",
    assignee: "human:qa",
  });
  assert.deepEqual(calls, [
    [
      "job.combine.campaign.triage",
      {
        batchId: "batch-triage-ownership",
        caseIds: ["cell-en"],
        triageStatus: "investigating",
        assignee: "human:qa",
      },
    ],
  ]);
  assert.equal(updated.cases[0]?.status, "failed");
  assert.equal(updated.cases[0]?.triageStatus, "investigating");
  assert.equal(updated.cases[0]?.assignee, "human:qa");
  assert.equal(updated.cases[1]?.assignee, undefined);
  await assert.rejects(
    service.triage("batch-triage-ownership", {
      caseIds: [],
      triageStatus: "resolved",
    }),
    /at least one Batch case/u,
  );
});

test("expanded Batch identities rerun only the selected profile case", () => {
  const batch = {
    id: "batch-expanded",
    cases: [
      {
        id: "case-profile-a",
        executionCaseId: "case-profile-a",
        values: { language: "en" },
        status: "failed" as const,
        runId: "run-a",
      },
      {
        id: "case-profile-b",
        executionCaseId: "case-profile-b",
        values: { language: "en" },
        status: "failed" as const,
        runId: "run-b",
      },
    ],
  } as never;
  const selected = selectProductBatchCases(batch, { executionCaseIds: ["case-profile-b"] });
  assert.deepEqual(selected.caseIds, ["case-profile-b"]);
});
