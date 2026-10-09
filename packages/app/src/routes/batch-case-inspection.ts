import type { ProductBatchCase } from "@relay/product/run-across";

/** Active jobs can be inspected before a final Run is persisted. Do not turn
 * their identity, or an earlier attempt, into evidence for this case. */
export function batchCaseInspectionReference(
  item: Pick<ProductBatchCase, "status" | "jobId" | "runId">,
): { id: string; kind: "saved" | "live" } | undefined {
  const runId = item.runId?.trim();
  if (runId) return { id: runId, kind: "saved" };
  const jobId = item.jobId?.trim();
  if (jobId && (item.status === "queued" || item.status === "running")) {
    return { id: jobId, kind: "live" };
  }
  return undefined;
}

export function batchCaseEvidenceMessage(item: Pick<ProductBatchCase, "status">): string {
  if (item.status === "pending" || item.status === "queued") return "Waiting to start.";
  if (item.status === "running")
    return "Run in progress. Evidence will appear here as it is saved.";
  if (item.status === "cancelled") return "This case stopped without saved run evidence.";
  return "This case ended without saved run evidence.";
}
