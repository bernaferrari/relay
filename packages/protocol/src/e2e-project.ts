import * as z from "zod/v4";

const test = z
  .object({
    id: z.string(),
    file: z.string(),
    title: z.string(),
    titlePath: z.array(z.string()),
    target: z.string(),
    agent: z.string(),
    disposition: z.enum(["run", "skip"]),
  })
  .passthrough();
export const e2eProjectSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    path: z.string(),
    configFile: z.string(),
    harness: z.literal("e2e"),
    version: z.literal("0.20.0"),
    tests: z.array(test),
    openedAt: z.number(),
    updatedAt: z.number(),
  })
  .strict();
export const e2eExecutionSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    status: z.enum(["running", "importing", "complete", "interrupted", "import-incomplete"]),
    startedAt: z.number(),
    finishedAt: z.number().optional(),
    upstreamStatus: z.string().optional(),
    exitCode: z.number().nullable().optional(),
    runIds: z.array(z.string()),
    results: z
      .array(z.object({ runId: z.string(), title: z.string(), status: z.string() }).strict())
      .optional(),
    logs: z.string(),
    error: z.string().optional(),
    requiredCaptures: z.number().optional(),
    availableCaptures: z.number().optional(),
    pendingReview: z.number().optional(),
    accepted: z.number().optional(),
    issues: z.number().optional(),
  })
  .strict();
export type E2EProject = z.output<typeof e2eProjectSchema>;
export type E2EExecution = z.output<typeof e2eExecutionSchema>;
const projectId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/);
export const e2eOperationInputSchemas = {
  "e2e.project.list": z.object({}).strict(),
  "e2e.project.open": z
    .object({
      path: z.string().min(1).max(4096),
      trust: z.literal("trusted-project"),
      configFile: z.string().min(1).optional(),
    })
    .strict(),
  "e2e.project.refresh": z.object({ projectId }).strict(),
  "e2e.project.source": z.object({ projectId, file: z.string().min(1).max(4096) }).strict(),
  "e2e.project.run": z.object({ projectId, testId: z.string().optional() }).strict(),
  "e2e.execution.get": z.object({ executionId: projectId }).strict(),
  "e2e.execution.cancel": z.object({ executionId: projectId }).strict(),
  "e2e.execution.retry-import": z.object({ executionId: projectId }).strict(),
};
export const e2eOperationOutputSchemas = {
  "e2e.project.list": z
    .object({ projects: z.array(e2eProjectSchema), executions: z.array(e2eExecutionSchema) })
    .strict(),
  "e2e.project.open": z.object({ project: e2eProjectSchema }).strict(),
  "e2e.project.refresh": z.object({ project: e2eProjectSchema }).strict(),
  "e2e.project.source": z.object({ file: z.string(), text: z.string() }).strict(),
  "e2e.project.run": z.object({ execution: e2eExecutionSchema }).strict(),
  "e2e.execution.get": z.object({ execution: e2eExecutionSchema }).strict(),
  "e2e.execution.cancel": z.object({ execution: e2eExecutionSchema }).strict(),
  "e2e.execution.retry-import": z.object({ execution: e2eExecutionSchema }).strict(),
};
export type E2EOperationMap = {
  [K in keyof typeof e2eOperationInputSchemas]: {
    input: z.output<(typeof e2eOperationInputSchemas)[K]>;
    output: z.output<(typeof e2eOperationOutputSchemas)[K]>;
  };
};
