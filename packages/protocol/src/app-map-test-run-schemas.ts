import * as z from "zod/v4";
import { identifier, text } from "./operation-schema-primitives.js";

export const requirementActionKind = z
  .enum(["capture-view", "test-action"])
  .describe(
    "capture-view may leftover-skip dest chrome (GQA-004 attach, GQA-040 settings). test-action must execute the named opener. Omitted dest-end stays test-action.",
  );

export const forceRecaptureScreenIds = z
  .array(identifier("Full-surface screen identifier to recapture"))
  .min(1)
  .max(50)
  .superRefine((screenIds, context) => {
    if (new Set(screenIds).size === screenIds.length) return;
    context.addIssue({
      code: "custom",
      message: "forceRecaptureScreenIds must not repeat a screen identifier",
    });
  });

export const repeatWorkflowMutationSchema = z
  .object({
    schemaVersion: z.literal(1),
    workflowId: identifier("Durable Repeat workflow identifier"),
    transitionVersion: z.number().int().positive(),
    action: z.enum(["repeat-pilot", "repeat-resume", "repeat-cancel"]),
    completedAt: z.number().int().nonnegative(),
  })
  .strict();

const shaPattern = /^[0-9a-f]{7,40}$/;
export const sourceRevisionSchema = z
  .object({
    vcs: z.literal("git"),
    sha: z.string().regex(shaPattern, "must be 7-40 lowercase hex characters"),
    prNumber: z.number().int().positive().optional(),
    branch: text("Branch name").optional(),
    artifactDigest: text("Built artifact digest").optional(),
    buildId: identifier("Registered build or deployment identity").optional(),
  })
  .strict()
  .describe("Immutable commit/build identity frozen with the run as audit-grade evidence");

/** The offline preview and the queued run share one evidence-scope vocabulary.
 * Keeping it here makes every transport as strict as the protocol contract,
 * rather than silently dropping a selected profile at a presentation boundary. */
