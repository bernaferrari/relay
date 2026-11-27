import * as z from "zod/v4";
import { recipeStepSchema } from "./recipe/recipe-step-schema.js";

/** Actions that last carried out a plain-English step, replayed before the
 * model. v2 entries carry the proof needed to replay safely; legacy entries
 * without it stay valid document data but compile as absent. */
export const plainEnglishStepCacheSchema = z.union([
  z
    .object({
      steps: z.array(recipeStepSchema).max(40),
      runId: z.string(),
      savedAt: z.number(),
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(2),
      steps: z.array(recipeStepSchema).max(40),
      runId: z.string(),
      savedAt: z.number(),
      targetKind: z.enum(["browser", "device"]),
      platform: z.enum(["android", "ios"]).optional(),
      viewport: z.object({ width: z.number(), height: z.number() }).strict().optional(),
      resolution: z.array(
        z
          .object({
            strategy: z.enum(["identifier", "ref", "label", "text"]),
            key: z.string(),
          })
          .strict(),
      ),
      verification: z
        .object({
          runOutcome: z.literal("passed"),
          checkStepIds: z.array(z.string()).optional(),
        })
        .strict(),
      healedFrom: z
        .object({ runId: z.string(), savedAt: z.number(), reason: z.string() })
        .strict()
        .optional(),
      hits: z.number().optional(),
      lastHitAt: z.number().optional(),
    })
    .strict(),
]);

/** Fields an unresolved Test step binding adds when it runs from its words. */
export const plainEnglishBindingFields = {
  fromText: z.literal(true).optional(),
  cache: plainEnglishStepCacheSchema.optional(),
};

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
          replayedSteps: z.number().optional(),
          reResolvedSteps: z.number().optional(),
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
                replay: z
                  .object({
                    source: z.enum(["cache", "model", "re-resolved"]),
                    detail: z.string().optional(),
                  })
                  .strict()
                  .optional(),
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
