import type { ProductRunSummary } from "@relay/product/catalog";
import type { ProductRecordingState } from "./recording-product-service";
import type { RunPointer } from "./run-pointer";

export type ActiveWorkKind = "recording" | "run" | "batch";

export type ActiveWorkItem = {
  id: string;
  kind: ActiveWorkKind;
  title: string;
  detail: string;
  status: string;
  /** Execution truth is separate from the fact that this work can be reopened. */
  activity: "running" | "queued" | "draft" | "unknown";
  href: string;
};

export function collectActiveWork(input: {
  recordingId?: string | null;
  recording?: ProductRecordingState;
  runs?: readonly ProductRunSummary[];
  runPointer?: RunPointer | null;
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
    const running =
      !reviewing && input.recording?.status === "recording" && snapshot?.phase === "running";
    items.push({
      id: `recording:${input.recordingId}`,
      kind: "recording",
      title: snapshot?.title || "Recording in progress",
      detail: reviewing ? "Saved steps ready for review" : targetDetail(input.recording),
      status: reviewing ? "Draft" : running ? "Recording" : "Status needs checking",
      activity: reviewing ? "draft" : running ? "running" : "unknown",
      href: `/recordings/${encodeURIComponent(input.recordingId)}${reviewing ? "/review" : ""}`,
    });
  }

  const allRuns = input.runs ?? [];
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
      status: batchRuns.some((run) => run.phase === "running") ? "Running across" : "Queued",
      activity: batchRuns.some((run) => run.phase === "running") ? "running" : "queued",
      href: `/batches/${encodeURIComponent(batchId)}`,
    });
  }

  if (input.runPointer && !allRuns.some((run) => run.id === input.runPointer?.runId)) {
    items.push({
      id: `run:${input.runPointer.runId}`,
      kind: "run",
      title: "Run",
      detail: "Open the latest server status",
      status: "Status needs checking",
      activity: "unknown",
      href: `/runs/${encodeURIComponent(input.runPointer.runId)}`,
    });
  }

  return items;
}

function runItem(run: ProductRunSummary): ActiveWorkItem {
  return {
    id: `run:${run.id}`,
    kind: "run",
    title: run.testName ?? run.title,
    detail: run.targetName ?? (run.phase === "queued" ? "Waiting for a target" : "Live run"),
    status: run.phase === "queued" ? "Queued" : "Running",
    activity: run.phase === "queued" ? "queued" : "running",
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
