export const runQueryKeys = {
  test: (testId: string) => ["run", "test", testId] as const,
  testStability: (testId: string) => ["run", "test", testId, "stability"] as const,
  targets: ["run", "targets"] as const,
  targetPresentation: (targetId: string) => ["run", "target-presentation", targetId] as const,
  pointer: ["run", "active-pointer"] as const,
  workflow: (workflowId: string) => ["run", "workflow", workflowId] as const,
  restore: (runId: string) => ["run", "restore", runId] as const,
  report: (runId: string) => ["run", "report", runId] as const,
  rawEvidence: (runId: string) => ["run", "report", runId, "raw-evidence"] as const,
};
