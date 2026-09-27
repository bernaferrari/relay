import type { ProductChange } from "@relay/product/change-journey";
import type { ProductRunSummary } from "@relay/product/catalog";
import type { ProductRecordingState } from "./recording-product-service";
import type { RunPointer } from "./run-pointer";

export type ActiveWorkKind = "recording" | "run" | "batch" | "change";

export type ActiveWorkItem = {
  id: string;
  kind: ActiveWorkKind;
  title: string;
  detail: string;
  status: string;
  href: string;
};

const activeChangeStates = new Set(["running-pilot", "running"]);

export function collectActiveWork(input: {
  recordingId?: string | null;
  recording?: ProductRecordingState;
  runs?: readonly ProductRunSummary[];
  runPointer?: RunPointer | null;
  changes?: readonly ProductChange[];
}): readonly ActiveWorkItem[] {
  const items: ActiveWorkItem[] = [];
  const snapshot = input.recording?.snapshot;
  if (
    input.recordingId &&
    snapshot?.stage !== "committed" &&
    snapshot?.stage !== "cancelled" &&
    snapshot?.stage !== "failed"
  ) {
    const reviewing = snapshot?.stage === "reviewing";
    items.push({
      id: `recording:${input.recordingId}`,
      kind: "recording",
      title: snapshot?.title || "Recording in progress",
      detail: reviewing ? "Ready to review and replay" : targetDetail(input.recording),
      status: reviewing ? "Reviewing" : "Recording",
      href: `/recordings/${encodeURIComponent(input.recordingId)}${reviewing ? "/review" : ""}`,
    });
  }

  const allRuns = input.runs ?? [];
  const activeRuns = allRuns.filter((run) => run.phase === "queued" || run.phase === "running");
  const batches = new Map<string, ProductRunSummary[]>();
  for (const run of allRuns) {
    if (run.batchId) {
      const current = batches.get(run.batchId) ?? [];
      current.push(run);
      batches.set(run.batchId, current);
      continue;
    }
    if (run.phase === "queued" || run.phase === "running") items.push(runItem(run));
  }
  for (const [batchId, batchRuns] of batches) {
    if (!batchRuns.some((run) => run.phase === "queued" || run.phase === "running")) continue;
    const completed = batchRuns.filter((run) => run.phase !== "queued" && run.phase !== "running");
    const total = Math.max(...batchRuns.map((run) => run.caseCount ?? 0), batchRuns.length);
    items.push({
      id: `batch:${batchId}`,
      kind: "batch",
      title: batchRuns[0]?.testName ?? batchRuns[0]?.title ?? "Run Across",
      detail: `${completed.length} of ${total} cases finished`,
      status: "Running across",
      href: `/batches/${encodeURIComponent(batchId)}`,
    });
  }

  if (input.runPointer && !activeRuns.some((run) => run.id === input.runPointer?.runId)) {
    items.push({
      id: `run:${input.runPointer.runId}`,
      kind: "run",
      title: "Run in progress",
      detail: "Open the latest server status",
      status: "Running",
      href: `/runs/${encodeURIComponent(input.runPointer.runId)}`,
    });
  }

  for (const change of input.changes ?? []) {
    if (!activeChangeStates.has(change.status)) continue;
    items.push({
      id: `change:${change.id}`,
      kind: "change",
      title: change.title,
      detail:
        change.status === "running-pilot"
          ? "Representative verification is running"
          : "Required verification is running",
      status: change.status === "running-pilot" ? "Pilot" : "Verifying",
      href: `/changes/${encodeURIComponent(change.id)}`,
    });
  }

  return items;
}

function runItem(run: ProductRunSummary): ActiveWorkItem {
  return {
    id: `run:${run.id}`,
    kind: "run",
    title: run.testName ?? run.title,
    detail: run.targetName ?? (run.phase === "queued" ? "Waiting for a target" : "Live Run"),
    status: run.phase === "queued" ? "Queued" : "Running",
    href: `/runs/${encodeURIComponent(run.id)}`,
  };
}

function targetDetail(recording: ProductRecordingState | undefined): string {
  const target = recording?.selectedTarget ?? recording?.snapshot?.frozen?.target;
  if (!target) return "Open the live recording";
  return target.platform === "browser"
    ? "Live browser"
    : `Live ${target.platform.toUpperCase()} device`;
}
