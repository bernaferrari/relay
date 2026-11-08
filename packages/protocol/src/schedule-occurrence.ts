import * as z from "zod/v4";

/** One due time, with exact admitted work. A missing Run never counts as a pass. */
export const scheduleOccurrenceSchema = z
  .object({
    id: z.string().min(1),
    scheduleId: z.string().min(1),
    projectId: z.string().min(1),
    scheduledAt: z.number().int().nonnegative(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    appMapId: z.string().optional(),
    combineId: z.string().optional(),
    recipeId: z.string().optional(),
    sourceRevision: z.number().int().nonnegative().optional(),
    batchId: z.string().optional(),
    campaignId: z.string().optional(),
    expectedCaseCount: z.number().int().nonnegative(),
    jobs: z.array(
      z
        .object({
          id: z.string().min(1),
          testId: z.string().optional(),
          caseIndex: z.number().int().nonnegative().optional(),
          targetId: z.string().optional(),
          executionCaseId: z.string().optional(),
        })
        .strict(),
    ),
    state: z.enum(["admitting", "running", "completed", "blocked", "skipped-busy", "interrupted"]),
    verdict: z.enum(["passed", "failed", "review-required"]).optional(),
    detail: z.string().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.state === "completed") !== (value.verdict !== undefined)) {
      context.addIssue({ code: "custom", message: "Only completed occurrences carry a verdict" });
    }
    if (value.state === "completed" && !value.jobs.length) {
      context.addIssue({ code: "custom", message: "An empty occurrence cannot complete" });
    }
  });

export type ScheduleOccurrence = z.infer<typeof scheduleOccurrenceSchema>;
