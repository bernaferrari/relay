import { createOperationBuilders } from "./operation-builders.js";
import type { RelayOperationMap } from "./operation-map.js";

export type CombineOperationId =
  | "job.combine.start"
  | "job.combine.export"
  | "job.combine.infer"
  | "job.combine.campaign.get"
  | "job.combine.campaign.resume"
  | "job.combine.campaign.cancel";

const { command, query } =
  createOperationBuilders<Pick<RelayOperationMap, CombineOperationId>>();

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
  query(
    "job.combine.campaign.get",
    "Get a resumable Combine campaign",
    "/jobs/combine/:batchId/campaign",
    { category: "execution" },
  ),
  command(
    "job.combine.campaign.resume",
    "Resume untouched Combine cases",
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
    "job.combine.infer",
    "Infer variable rows from taught live-screen rows",
    "POST",
    "/jobs/combine/infer",
    { category: "execution" },
  ),
] as const;
