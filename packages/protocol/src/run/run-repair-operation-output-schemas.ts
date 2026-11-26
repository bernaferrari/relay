import * as z from "zod/v4";
import { appMapDocumentSchema } from "../app-map/app-map-document-schema.js";

const campaignRepairActionOutputSchema = z
  .object({
    kind: z.enum([
      "continue-and-report",
      "retry-check",
      "retarget-proposal",
      "accept-current-proposal",
      "repair-test-proposal",
      "defer-check-proposal",
    ]),
    label: z.string(),
    available: z.boolean(),
    mutation: z.enum(["none", "new-run", "reviewed-proposal"]),
    description: z.string(),
    operationId: z.string().optional(),
    fixedInput: z.record(z.string(), z.unknown()).optional(),
    requiredInput: z.array(z.string()).optional(),
    unavailableReason: z.string().optional(),
    proposalRequirements: z
      .object({
        actorAttribution: z.literal(true),
        priorRevision: z.literal(true),
        reviewRequired: z.literal(true),
        inverseEditsForRevert: z.literal(true),
        equivalentDiffGrouping: z.literal(true).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
const campaignRepairTargetOutputSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    status: z.literal("pending"),
    defaultAction: z.literal("continue-and-report"),
    source: z
      .object({
        runId: z.string().min(1),
        runInputDigest: z.string().min(1),
        checkId: z.string().min(1),
        checkTitle: z.string(),
        action: z.string(),
        capturedAt: z.number(),
        appMapId: z.string().optional(),
        appMapRevision: z.number().optional(),
        testId: z.string().optional(),
      })
      .strict(),
    expected: z
      .object({
        recipeId: z.string().optional(),
        screenId: z.string().optional(),
        groupId: z.string().optional(),
        originScreenId: z.string().optional(),
        transitionId: z.string().optional(),
      })
      .strict(),
    observed: z
      .object({
        error: z.string(),
        screenIdentity: z.unknown().optional(),
        chrome: z.unknown().optional(),
        accessibility: z.unknown().optional(),
        navigationRepair: z
          .object({
            connectionId: z.string().min(1),
            beforeSelector: z.record(z.string(), z.unknown()),
            currentSelector: z.record(z.string(), z.unknown()),
            attempts: z.array(z.unknown()),
          })
          .strict()
          .optional(),
      })
      .strict(),
    evidence: z
      .object({
        result: z.unknown(),
        failure: z.unknown().optional(),
        frames: z.array(
          z
            .object({
              index: z.number(),
              path: z.string().min(1),
              caption: z.string(),
              capturedAt: z.number(),
            })
            .strict(),
        ),
      })
      .strict(),
    lineage: z
      .object({
        sourceRunId: z.string().min(1),
        retryOf: z.string().optional(),
        priorAttempts: z.array(
          z
            .object({
              runId: z.string().min(1),
              jobId: z.string().optional(),
              status: z.string().optional(),
              createdAt: z.number().optional(),
            })
            .strict(),
        ),
      })
      .strict(),
    actions: z.array(campaignRepairActionOutputSchema),
  })
  .strict();
const campaignRepairTargetSummaryOutputSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    status: z.literal("pending"),
    defaultAction: z.literal("continue-and-report"),
    source: campaignRepairTargetOutputSchema.shape.source,
    error: z.string().min(1),
    priorAttemptCount: z.number(),
  })
  .strict();
export const runRepairOperationOutputSchemas = {
  "run.repair.list": z
    .object({ repairs: z.array(campaignRepairTargetSummaryOutputSchema) })
    .strict(),
  "run.repair.get": z.object({ repair: campaignRepairTargetOutputSchema }).strict(),
  "run.repair.retry": z
    .object({
      repair: campaignRepairTargetOutputSchema,
      job: z.record(z.string(), z.unknown()),
    })
    .strict(),
  "run.repair.propose": z
    .object({
      repair: campaignRepairTargetOutputSchema,
      appMap: appMapDocumentSchema,
      proposalId: z.string().min(1),
    })
    .strict(),
} as const satisfies Readonly<Record<string, z.ZodType>>;
