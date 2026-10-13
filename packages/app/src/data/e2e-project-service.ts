import type { Platform } from "../platform/types";
import { productClientForPlatform } from "./product-client";
export function createE2EProjectService(platform: Platform) {
  const invoke = async <K extends import("@relay/protocol").OperationId>(
    id: K,
    input: import("@relay/protocol").OperationInput<K>,
  ) => (await productClientForPlatform(platform)).client.invoke(id, input);
  return {
    list: () => invoke("e2e.project.list", {}),
    open: (path: string) => invoke("e2e.project.open", { path, trust: "trusted-project" }),
    refresh: (projectId: string) => invoke("e2e.project.refresh", { projectId }),
    source: (projectId: string, file: string) => invoke("e2e.project.source", { projectId, file }),
    run: (projectId: string, testId?: string) =>
      invoke("e2e.project.run", { projectId, ...(testId ? { testId } : {}) }),
    execution: (executionId: string) => invoke("e2e.execution.get", { executionId }),
    cancel: (executionId: string) => invoke("e2e.execution.cancel", { executionId }),
    retryImport: (executionId: string) => invoke("e2e.execution.retry-import", { executionId }),
  };
}
