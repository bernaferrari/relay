import { createOperationBuilders } from "./operation-builders.js";
import type { RelayOperationMap } from "./operation-map.js";

export type CombineOperationId =
  | "job.combine.start"
  | "job.combine.export"
  | "job.combine.analysis"
  | "job.combine.campaign.get"
  | "job.combine.campaign.repeat.active"
  | "job.combine.campaign.repeat.clusters"
  | "job.combine.campaign.resume"
  | "job.combine.campaign.cancel"
  | "job.combine.campaign.triage";

const { command, query } = createOperationBuilders<Pick<RelayOperationMap, CombineOperationId>>();

export const combineOperationDefinitions = [
  command("job.combine.start", "Run state combinations × tests", "POST", "/jobs/combine", {
    category: "execution",
    progress: true,
    cancellable: true,
    lease: "exclusive",
    targetCapabilities: ["tap", "snapshot", "screenshot", "launch"],
  }),
  query("job.combine.export", "Export a Combine pack", "/jobs/combine/:batchId/export", {
    category: "execution",
  }),
  query("job.combine.analysis", "Analyze Combine evidence", "/jobs/combine/:batchId/analysis", {
    category: "execution",
  }),
  query(
    "job.combine.campaign.get",
    "Get a resumable Combine campaign",
    "/jobs/combine/:batchId/campaign",
    { category: "execution" },
  ),
  query(
    "job.combine.campaign.repeat.active",
    "Find unfinished Repeat work",
    "/jobs/combine/repeat/active",
    { category: "execution" },
  ),
  query(
    "job.combine.campaign.repeat.clusters",
    "Review equivalent Repeat failure clusters",
    "/jobs/combine/:batchId/repeat/clusters",
    { category: "evidence", minimumRole: "viewer" },
  ),
  command(
    "job.combine.campaign.resume",
    "Resume eligible Combine cases",
    "POST",
    "/jobs/combine/:batchId/resume",
    {
      category: "execution",
      progress: true,
      cancellable: true,
      lease: "exclusive",
      targetCapabilities: ["tap", "snapshot", "screenshot", "launch"],
    },
  ),
  command(
    "job.combine.campaign.cancel",
    "Cancel a Combine campaign",
    "POST",
    "/jobs/combine/:batchId/cancel",
    { category: "execution", idempotency: "inherent" },
  ),
  command(
    "job.combine.campaign.triage",
    "Assign or mark Combine campaign cases",
    "POST",
    "/jobs/combine/:batchId/triage",
    { category: "execution", idempotency: "inherent" },
  ),
] as const;
