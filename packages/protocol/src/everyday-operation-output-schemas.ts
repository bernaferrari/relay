import * as z from "zod/v4";

/** Responses of the everyday loop: describe a Test, its file, a Run's verdict, the model key. */
export const everydayOperationOutputSchemas = {
  "test.create-from-goal": z
    .object({
      appId: z.string(),
      testId: z.string(),
      name: z.string(),
      steps: z.array(z.object({ kind: z.enum(["action", "check"]), text: z.string() }).strict()),
      source: z.enum(["model", "lines"]),
      createdApp: z.boolean(),
    })
    .strict(),
  "test.apply-yaml": z
    .object({
      appId: z.string(),
      testId: z.string(),
      name: z.string(),
      created: z.boolean(),
      createdApp: z.boolean(),
      /** Steps kept exact (recorded) because their words did not change. */
      keptRecorded: z.number().int().nonnegative(),
    })
    .strict(),
  "test.yaml.get": z.object({ yaml: z.string(), appId: z.string(), testId: z.string() }).strict(),
  "run.verdict.get": z
    .object({
      verdict: z
        .object({
          runId: z.string(),
          title: z.string(),
          status: z.enum(["passed", "failed", "blocked", "cancelled", "running"]),
          summary: z.string(),
          reason: z.string().optional(),
          durationMs: z.number().optional(),
          device: z.string().optional(),
          steps: z.array(
            z
              .object({
                id: z.string(),
                title: z.string(),
                kind: z.enum(["action", "check"]).optional(),
                status: z.enum(["passed", "failed", "not-run"]),
                expected: z.string().optional(),
                saw: z.string().optional(),
                screenshot: z.string().optional(),
              })
              .strict(),
          ),
        })
        .strict(),
    })
    .strict(),
  "system.model-key.set": z
    .object({
      configured: z.boolean(),
      source: z.enum(["settings", "environment", "none"]),
    })
    .strict(),
} as const;
