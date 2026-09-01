import * as z from "zod/v4";
import { changeVerificationSchema } from "./change-verification.js";
import { executionRiskSchema } from "./approval-policy.js";

const identifier = z.string().trim().min(1).max(256);
const boundedText = z.string().trim().min(1).max(4_096);
const timestamp = z.number().int().nonnegative();
const sha256 = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

const confirmationScopeSchema = z
  .object({
    organizationId: identifier,
    projectId: identifier,
    proofId: identifier,
    proofVersion: z.number().int().positive(),
    cellId: identifier,
    targetCaseId: identifier,
    buildId: identifier,
  })
  .strict();

/** Human authority for one exact Proof cell. This is deliberately narrower
 * than a Proof approval: it names the reviewed preview, actor, scope, action,
 * and validity window, so it cannot be replayed for another cell or revision. */
export const changeProofExecutionConfirmationReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    receiptId: identifier,
    previewDigest: sha256,
    actorId: identifier,
    scope: confirmationScopeSchema,
    action: z.literal("proof.run"),
    issuedAt: timestamp,
    expiresAt: timestamp,
    /** Destructive authority must be tied to a reviewed fixture and its
     * compensating cleanup checks. */
    fixtureScope: z
      .object({
        targetCaseId: identifier,
        targetProfileId: identifier,
        cleanupCheckIds: z.array(identifier).min(1).max(256).readonly(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((receipt, context) => {
    if (receipt.expiresAt <= receipt.issuedAt) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "must be later than issuedAt",
      });
    }
    if (receipt.fixtureScope && receipt.fixtureScope.targetCaseId !== receipt.scope.targetCaseId) {
      context.addIssue({
        code: "custom",
        path: ["fixtureScope", "targetCaseId"],
        message: "must equal scope.targetCaseId",
      });
    }
  });

export const changeProofExecutionConsumedReceiptSchema =
  changeProofExecutionConfirmationReceiptSchema.extend({ consumedAt: timestamp });

export const changeProofExecutionPreviewCellSchema = z
  .object({
    cellId: identifier,
    targetCaseId: identifier,
    buildId: identifier,
    executionRisk: executionRiskSchema,
    executionRiskDigest: sha256,
    cleanupRequired: z.boolean(),
  })
  .strict();

/** Read-only digestable projection shown before human confirmation. It
 * carries every effect-bearing field needed to detect plan drift while
 * omitting recipes and target secrets. */
export const changeProofExecutionPreviewSchema = z
  .object({
    schemaVersion: z.literal(1),
    organizationId: identifier,
    projectId: identifier,
    proofId: identifier,
    proofVersion: z.number().int().positive(),
    action: z.literal("proof.run"),
    cells: z.array(changeProofExecutionPreviewCellSchema).min(1).max(1_000).readonly(),
    previewDigest: sha256,
  })
  .strict();

export const changeProofExecutionStatusSchema = z.enum([
  "queued",
  "running",
  "paused-human",
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
  "human-intervention",
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

export const changeProofExecutionHumanInterventionSchema = z
  .object({
    cellId: identifier,
    stepId: identifier,
    effects: z.array(z.string().trim().min(1).max(256)).max(32).readonly(),
    reason: boundedText,
    at: timestamp,
  })
  .strict();

/** Durable evidence boundary for one exact human-only step. The evidence
 * digest is intentionally opaque here; its identity is bound to the frozen
 * execution/cell/step and recorded by the authenticated human actor. */
export const changeProofExecutionHumanInterventionEvidenceSchema = z
  .object({
    schemaVersion: z.literal(1),
    executionId: identifier,
    proofId: identifier,
    cellId: identifier,
    stepId: identifier,
    evidenceDigest: sha256,
    recordedBy: identifier,
    recordedAt: timestamp,
    requestId: identifier,
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
    humanIntervention: changeProofExecutionHumanInterventionSchema.optional(),
    humanInterventionEvidence: z
      .array(changeProofExecutionHumanInterventionEvidenceSchema)
      .max(1_000)
      .readonly()
      .optional(),
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
    if (summary.status === "paused-human" && !summary.humanIntervention) {
      context.addIssue({
        code: "custom",
        path: ["humanIntervention"],
        message: "is required for a human-paused execution",
      });
    }
    if (summary.status !== "paused-human" && summary.humanIntervention) {
      context.addIssue({
        code: "custom",
        path: ["humanIntervention"],
        message: "is only valid for a human-paused execution",
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
    confirmationReceipts: z
      .array(changeProofExecutionConfirmationReceiptSchema)
      .max(1_000)
      .readonly()
      .optional(),
  })
  .strict();

/** A human-only pause can be resumed only by recording evidence for the exact
 * durable execution, frozen cell, and frozen step identity. */
export const changeProofRunHumanEvidenceInputSchema = z
  .object({
    proofId: identifier,
    executionId: identifier,
    cellId: identifier,
    stepId: identifier,
    evidenceDigest: sha256,
    wait: z.boolean().optional(),
    confirm: z.literal(true),
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
export type ChangeProofExecutionHumanIntervention = z.output<
  typeof changeProofExecutionHumanInterventionSchema
>;
export type ChangeProofExecutionHumanInterventionEvidence = z.output<
  typeof changeProofExecutionHumanInterventionEvidenceSchema
>;
export type ChangeProofExecutionConfirmationReceipt = z.output<
  typeof changeProofExecutionConfirmationReceiptSchema
>;
export type ChangeProofExecutionConsumedReceipt = z.output<
  typeof changeProofExecutionConsumedReceiptSchema
>;
export type ChangeProofExecutionPreviewCell = z.output<
  typeof changeProofExecutionPreviewCellSchema
>;
export type ChangeProofExecutionPreview = z.output<typeof changeProofExecutionPreviewSchema>;
export type ChangeProofExecutionSummary = z.output<typeof changeProofExecutionSummarySchema>;
export type ChangeProofRunInput = z.output<typeof changeProofRunInputSchema>;
export type ChangeProofRunHumanEvidenceInput = z.output<
  typeof changeProofRunHumanEvidenceInputSchema
>;
export type ChangeProofRunOutput = z.output<typeof changeProofRunOutputSchema>;
