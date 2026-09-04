import type { QueryClient } from "@tanstack/react-query";
import type { RecordingProductService } from "./recording-product-service";

export const recordingQueryKeys = {
  apps: ["recording", "apps"] as const,
  targets: ["recording", "targets"] as const,
  targetPresentation: (targetId: string) => ["recording", "target-presentation", targetId] as const,
  workflow: (workflowId: string) => ["recording", "workflow", workflowId] as const,
  pointer: ["recording", "active-pointer"] as const,
};

export async function refreshRecording(
  queryClient: QueryClient,
  service: RecordingProductService,
  workflowId: string,
) {
  await queryClient.invalidateQueries({ queryKey: recordingQueryKeys.workflow(workflowId) });
  return queryClient.fetchQuery({
    queryKey: recordingQueryKeys.workflow(workflowId),
    queryFn: () => service.inspect(workflowId),
    staleTime: 0,
  });
}
