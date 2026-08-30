import * as z from "zod/v4";
import { changeVerificationSchema } from "./change-verification.js";

const identifier = z.string().trim().min(1).max(256);
const boundedText = z.string().trim().min(1).max(4_096);
const timestamp = z.number().int().nonnegative();

export const changeProofExecutionStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "cancelled",
  "uncertain",
]);

export const changeProofExecutionCellStatusSchema = z.enum([
  "pending",
  "dispatching",
  "running",
  "passed",
  "rejected",
  "needs-review",
  "insufficient-evidence",
  "infrastructure-failure",
  "cancelled",
  "uncertain",
]);

export const changeProofExecutionNextActionSchema = z.enum([
  "run-pilot",
  "run-required-coverage",
  "reconcile",
  "inspect",
  "cancelled",
  "complete",
]);

export const changeProofExecutionUncertaintySchema = z
  .object({
    cellId: identifier,
    reason: boundedText,
    at: timestamp,
    runId: identifier.optional(),
  })
  .strict();

export const changeProofExecutionCancellationSchema = z
  .object({
    reason: boundedText,
    cancelledBy: identifier,
    cancelledAt: timestamp,
  })
  .strict();

/** The intentionally small public projection of the server-owned Proof
 * coordinator. Frozen recipes/cells and provider-specific leases never cross
 * this seam. */
export const changeProofExecutionSummarySchema = z
  .object({
    id: identifier,
    proofId: identifier,
    status: changeProofExecutionStatusSchema,
    cursor: z.number().int().nonnegative(),
    total: z.number().int().positive(),
    currentCellId: identifier.optional(),
    runIds: z.array(identifier).max(1_000).readonly(),
    deadlineAt: timestamp,
    nextAction: changeProofExecutionNextActionSchema,
    cancellation: changeProofExecutionCancellationSchema.optional(),
    terminalUncertainty: changeProofExecutionUncertaintySchema.optional(),
  })
  .strict()
  .superRefine((summary, context) => {
    if (summary.cursor > summary.total) {
      context.addIssue({ code: "custom", path: ["cursor"], message: "cannot exceed total" });
    }
    if (summary.status === "uncertain" && !summary.terminalUncertainty) {
      context.addIssue({
        code: "custom",
        path: ["terminalUncertainty"],
        message: "is required for an uncertain execution",
      });
    }
    if (summary.status !== "uncertain" && summary.terminalUncertainty) {
      context.addIssue({
        code: "custom",
        path: ["terminalUncertainty"],
        message: "is only valid for an uncertain execution",
      });
    }
  });

/** Operation input intentionally contains no cursor, cell, or execution
 * policy knobs. A repeated request therefore means resume the one durable
 * execution selected by proofId. */
export const changeProofRunInputSchema = z
  .object({
    proofId: identifier,
    expectedVersion: z.number().int().positive().optional(),
    wait: z.boolean().optional(),
  })
  .strict();

export const changeProofRunOutputSchema = z
  .object({
    proof: changeVerificationSchema,
    execution: changeProofExecutionSummarySchema,
  })
  .strict();

export type ChangeProofExecutionStatus = z.output<typeof changeProofExecutionStatusSchema>;
export type ChangeProofExecutionCellStatus = z.output<typeof changeProofExecutionCellStatusSchema>;
export type ChangeProofExecutionNextAction = z.output<typeof changeProofExecutionNextActionSchema>;
export type ChangeProofExecutionUncertainty = z.output<
  typeof changeProofExecutionUncertaintySchema
>;
export type ChangeProofExecutionCancellation = z.output<
  typeof changeProofExecutionCancellationSchema
>;
export type ChangeProofExecutionSummary = z.output<typeof changeProofExecutionSummarySchema>;
export type ChangeProofRunInput = z.output<typeof changeProofRunInputSchema>;
export type ChangeProofRunOutput = z.output<typeof changeProofRunOutputSchema>;
