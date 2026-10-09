import { expect, it } from "vitest";
import { batchCaseEvidenceMessage, batchCaseInspectionReference } from "./batch-case-inspection";

it.each(["queued", "running"] as const)(
  "inspects the exact %s job without labeling it saved evidence",
  (status) => {
    expect(batchCaseInspectionReference({ status, jobId: "current-job" })).toEqual({
      kind: "live",
      id: "current-job",
    });
  },
);

it("prefers the persisted run when a live job reference is also present", () => {
  expect(
    batchCaseInspectionReference({ status: "failed", jobId: "job", runId: "immutable-run" }),
  ).toEqual({ kind: "saved", id: "immutable-run" });
});

it.each(["pending", "passed", "failed", "blocked", "cancelled"] as const)(
  "does not treat a %s job-only case as available run evidence",
  (status) => {
    expect(batchCaseInspectionReference({ status, jobId: "job" })).toBeUndefined();
  },
);

it("ignores empty references and does not use identity or prior-attempt run IDs", () => {
  const item = {
    status: "running" as const,
    jobId: " ",
    runId: " ",
    identity: { runId: "unrelated-run" },
    priorRunIds: ["earlier-run"],
  };
  expect(batchCaseInspectionReference(item)).toBeUndefined();
});

it.each([
  ["pending", "Waiting to start."],
  ["queued", "Waiting to start."],
  ["running", "Run in progress. Evidence will appear here as it is saved."],
  ["cancelled", "This case stopped without saved run evidence."],
  ["blocked", "This case ended without saved run evidence."],
] as const)("keeps %s evidence copy distinct from a stopped run", (status, message) => {
  expect(batchCaseEvidenceMessage({ status })).toBe(message);
});
