import * as z from "zod/v4";
import { identifier } from "./operation-schema-primitives.js";

export const combineAccountBindingSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("fixture"),
      accountId: z.string().trim().min(1),
      accountRevision: z.string().trim().min(1),
      reference: z.string().trim().min(1).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("signed-out"),
      attested: z.literal(true),
    })
    .strict(),
]);

export const combineProfileTargetInputSchema = z
  .object({
    profileId: identifier("Environment profile identifier"),
    targetProfileId: identifier("Saved runtime profile identifier").optional(),
    engine: z.enum(["chromium", "firefox", "webkit"]).optional(),
    account: combineAccountBindingSchema.optional(),
    target: z
      .object({
        targetKind: z.enum(["device", "browser"]).optional(),
        serial: identifier("Connected device serial").optional(),
        platform: z.enum(["android", "ios", "browser"]).optional(),
        browserTargetId: identifier("Managed browser target identifier").optional(),
      })
      .strict(),
  })
  .strict();

export type CombineProfileTargetInput = z.infer<typeof combineProfileTargetInputSchema>;

export type BrowserAccountPackQuote = {
  estimatedParallelDurationMs: number;
  laneCount: number;
  workItems: number;
  workItemDurationMs: number;
  observedDurationMs: number;
  observedWorkItemCount: number;
};
