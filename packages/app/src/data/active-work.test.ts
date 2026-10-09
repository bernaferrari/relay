import { describe, expect, it } from "vitest";
import type { ProductRecordingState } from "./recording-product-service";
import { collectActiveWork } from "./active-work";

describe("active work projection", () => {
  it("keeps a durable recording reopenable at its truthful route", () => {
    const items = collectActiveWork({
      recordingId: "workflow/1",
      recording: {
        status: "recording",
        targets: [],
        snapshot: {
          schemaVersion: 1,
          kind: "author-test",
          title: "Checkout",
          phase: "running",
          stage: "recording",
          version: "v1",
          progress: { label: "Recording" },
          allowedNextActions: [],
          problems: [],
          evidenceRefs: [],
        },
      },
    });

    expect(items).toMatchObject([
      { kind: "recording", title: "Checkout", href: "/recordings/workflow%2F1" },
    ]);
  });

  it("groups active batch cases and retains independent runs and changes", () => {
    const baseRun = {
      title: "Checkout",
      action: "run",
      status: "running",
      phase: "running" as const,
      queuedAt: 1,
      identity: { runId: "run-1" },
      links: { self: "/runs/run-1" },
    };
    const items = collectActiveWork({
      runs: [
        { ...baseRun, id: "run-1", testName: "Checkout" },
        { ...baseRun, id: "run-2", batchId: "batch-1", caseCount: 3 },
        { ...baseRun, id: "run-3", batchId: "batch-1", caseCount: 3 },
        {
          ...baseRun,
          id: "run-4",
          batchId: "batch-1",
          caseCount: 3,
          phase: "completed",
          status: "passed",
        },
      ],
      changes: [
        {
          id: "change-1",
          version: 1,
          status: "running",
          repository: "relay",
          title: "Fix checkout",
          baseRevision: "base",
          requestedRevision: "head",
          runs: [],
          evidenceCount: 0,
          coverageGaps: [],
          residualRisk: [],
          affectedTestCount: 1,
          requiredVerificationCount: 1,
          advisoryVerificationCount: 0,
          updatedAt: 1,
        },
      ],
    });

    expect(items.map((item) => item.kind)).toEqual(["run", "batch", "change"]);
    expect(items[1]).toMatchObject({ href: "/batches/batch-1", detail: "1 of 3 cases finished" });
  });

  it("does not keep a batch active after every case finishes", () => {
    const items = collectActiveWork({
      runs: [
        {
          id: "run-1",
          title: "Checkout",
          action: "run",
          status: "passed",
          phase: "completed",
          queuedAt: 1,
          identity: { runId: "run-1" },
          links: { self: "/runs/run-1" },
          batchId: "batch-1",
          caseCount: 1,
        },
      ],
    });

    expect(items).toEqual([]);
  });

  it("keeps independently started work discoverable when the local pointer is stale", () => {
    const items = collectActiveWork({
      recordingId: "recording-host-a",
      recording: {
        status: "recording",
        targets: [],
        snapshot: {
          schemaVersion: 1,
          kind: "author-test",
          title: "Record checkout",
          phase: "running",
          stage: "recording",
          version: "v1",
          progress: { label: "Recording" },
          allowedNextActions: [],
          problems: [],
          evidenceRefs: [],
        },
      },
      runs: [
        {
          id: "run-host-b",
          title: "Run checkout",
          action: "run",
          status: "running",
          phase: "running",
          queuedAt: 2,
          testName: "Checkout",
          identity: { runId: "run-host-b" },
          links: { self: "/runs/run-host-b" },
        },
      ],
      runPointer: {
        workflowId: "stale-local-workflow",
        runId: "run-host-c",
        testId: "checkout-c",
      },
    });

    expect(items.map(({ id }) => id)).toEqual([
      "recording:recording-host-a",
      "run:run-host-b",
      "run:run-host-c",
    ]);
    expect(items.find(({ id }) => id === "run:run-host-c")?.href).toBe("/runs/run-host-c");
  });
});

const reviewedDraft: ProductRecordingState = {
  status: "reviewing",
  targets: [],
  snapshot: {
    schemaVersion: 1,
    kind: "author-test",
    title: "Draft checkout",
    phase: "running",
    stage: "reviewing",
    version: "v1",
    progress: { label: "Review the recording" },
    allowedNextActions: ["inspect", "edit", "replay"],
    problems: [],
    evidenceRefs: [],
  },
};

it("keeps a reviewed draft reopenable without presenting it as execution", () => {
  expect(collectActiveWork({ recordingId: "draft-1", recording: reviewedDraft })).toMatchObject([
    {
      activity: "draft",
      status: "Draft",
      title: "Draft checkout",
      href: "/recordings/draft-1/review",
    },
  ]);
});

it("distinguishes a draft, running execution, queued execution and unconfirmed pointer", () => {
  const run = {
    id: "running",
    title: "Checkout",
    action: "test",
    status: "running",
    phase: "running" as const,
    queuedAt: 1,
    identity: { runId: "running" },
    links: { self: "/runs/running" },
  };
  const items = collectActiveWork({
    recordingId: "draft-1",
    recording: reviewedDraft,
    runs: [run, { ...run, id: "queued", phase: "queued" }],
    runPointer: { runId: "unknown", workflowId: "workflow", testId: "test" },
  });
  expect(items.map((item) => item.activity)).toEqual(["draft", "running", "queued", "unknown"]);
  expect(items.filter((item) => item.activity === "running")).toHaveLength(1);
});
