import * as z from "zod/v4";
import { workflowRecordOperationOutputSchemas } from "./workflow-record-operation-schemas.js";

export const executionJobOutputSchema = z
  .object({
    id: z.string().min(1),
    action: z.string().min(1),
    status: z.string().min(1),
    queuedAt: z.number(),
    startedAt: z.number().optional(),
    finishedAt: z.number().optional(),
    error: z.string().optional(),
    runId: z.string().optional(),
    batchId: z.string().optional(),
  })
  .passthrough();

const persistedRun = executionJobOutputSchema.extend({
  writtenAt: z.number().optional(),
  artifacts: z.array(z.unknown()).optional(),
  evidence: z.unknown().optional(),
});

/** Output contracts for exact core operations that do not own a custom parser. */
export const coreOperationOutputSchemas = {
  ...workflowRecordOperationOutputSchemas,
  "event.stream": z
    .object({
      schemaVersion: z.literal(1),
      eventId: z.string().min(1),
      cursor: z.number().int().nonnegative(),
      eventType: z.string().min(1),
      timestamp: z.number(),
      payload: z.unknown(),
    })
    .passthrough(),
  "job.get": z.object({ job: executionJobOutputSchema }).strict(),
  "job.start": z.object({ job: executionJobOutputSchema }).strict(),
  "job.cancel": z.object({ job: executionJobOutputSchema }).strict(),
  "job.pause": z.object({ job: executionJobOutputSchema }).strict(),
  "job.resume": z.object({ job: executionJobOutputSchema }).strict(),
  "run.get": z.object({ run: persistedRun }).strict(),
  "run.evidence.get": z
    .object({
      evidence: z
        .object({
          runId: z.string().optional(),
          events: z.array(z.unknown()).optional(),
          channels: z.record(z.string(), z.unknown()).optional(),
        })
        .passthrough(),
    })
    .strict(),
  "run.story.get": z
    .object({
      story: z
        .object({
          runId: z.string().optional(),
          title: z.string().optional(),
          steps: z.array(z.unknown()).optional(),
          frames: z.array(z.unknown()).optional(),
        })
        .passthrough(),
    })
    .strict(),
  "target.ui.describe": z
    .object({
      summary: z.string(),
      platform: z.string().optional(),
      serial: z.string().optional(),
      foregroundApp: z.string().optional(),
      titles: z.array(z.string()),
      sheetLikely: z.boolean(),
      keyboardLikely: z.boolean(),
      topLabels: z.array(z.string()),
      coordinateSpace: z.literal("logical-points"),
      bounds: z.object({ width: z.number(), height: z.number() }).strict().optional(),
      nodeCount: z.number(),
      treePreview: z.string(),
    })
    .strict(),
  "target.ui.back": z
    .object({ method: z.enum(["back", "parent", "close", "key", "edge-swipe"]) })
    .strict(),
  "target.ui.scrollCollect": z
    .object({
      controls: z.array(
        z
          .object({
            label: z.string(),
            role: z.string().optional(),
            target: z
              .object({
                identifier: z.string().optional(),
                ref: z.string().optional(),
                label: z.string().optional(),
                text: z.string().optional(),
              })
              .strict(),
          })
          .strict(),
      ),
      count: z.number(),
    })
    .strict(),
} as const satisfies Readonly<Record<string, z.ZodType>>;

/**
 * One review-only screen-matching suggestion from destination repair.
 * Mirrors core's RepairProposal writer; nothing here mutates an App Map.
 */
export const destinationRepairProposalSchema = z.object({
  candidateScreenId: z.string().min(1),
  /** 0..1 explainable match confidence; proposals arrive sorted descending. */
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
  method: z.enum(["fingerprint", "semantic", "vision"]),
});

/**
 * Data payload of the `destination-repair-proposals` run artifact written
 * after a failed step. An unavailable grounder degrades to an explicit
 * zero-proposal result instead of pretending to ground pixels.
 */
export const destinationRepairProposalsArtifactDataSchema = z.discriminatedUnion("available", [
  z.object({
    available: z.literal(true),
    proposals: z.array(destinationRepairProposalSchema),
  }),
  z.object({
    available: z.literal(false),
    proposals: z.tuple([]),
    reason: z.literal("grounding-unavailable"),
  }),
]);

export type DestinationRepairProposalsArtifactData = z.output<
  typeof destinationRepairProposalsArtifactDataSchema
>;
