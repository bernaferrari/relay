import * as z from "zod/v4";
import {
  CHANGE_VERIFICATION_STATES,
  changeVerificationBuildSchema,
  changeVerificationChangeSchema,
  changeVerificationNextSchema,
  changeVerificationMutationReceiptSchema,
  changeVerificationPolicySchema,
  changeVerificationSchema,
  changeVerificationSelectionSchema,
} from "./change-verification.js";
import { verificationPlanSchema } from "./change-impact.js";
import { changeProofPublicationReceiptSchema } from "./change-proof-decision.js";
import { changeProofPublicationOutboxRecordSchema } from "./change-proof-publication-outbox.js";
import {
  changeProofRunInputSchema,
  changeProofRunOutputSchema,
  changeProofExecutionSummarySchema,
} from "./change-proof-execution.js";

const identifier = z.string().trim().min(1).max(256);
const reason = z.string().trim().min(1).max(4_096);
const expectedVersion = z.number().int().positive();

const initialProofFields = {
  change: changeVerificationChangeSchema,
  builds: z.array(changeVerificationBuildSchema).max(32).readonly().optional(),
  selection: changeVerificationSelectionSchema.optional(),
  policy: changeVerificationPolicySchema,
  coverageGaps: z.array(reason).max(128).readonly().optional(),
  residualRisk: z.array(reason).max(128).readonly().optional(),
  smallestNextVerification: changeVerificationNextSchema.optional(),
} as const;

export const changeVerificationOperationInputSchemas = {
  "proof.prepare": z
    .object({
      baseRef: z.string().trim().min(1).max(512).optional(),
      pullRequest: z.number().int().positive().optional(),
      agentClaim: z
        .object({
          summary: reason,
          acceptanceCriteria: z.array(reason).max(64).readonly(),
        })
        .strict()
        .optional(),
      policy: changeVerificationPolicySchema.optional(),
      targetIds: z.array(identifier).min(1).max(250).readonly().optional(),
      buildIds: z.array(identifier).min(1).max(32).readonly().optional(),
    })
    .strict(),
  "proof.start": z.object(initialProofFields).strict(),
  "proof.list": z
    .object({
      state: z.enum(CHANGE_VERIFICATION_STATES).optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
    })
    .strict(),
  "proof.inspect": z
    .object({
      proofId: identifier,
      includeHistory: z
        .union([z.boolean(), z.enum(["true", "false"]).transform((value) => value === "true")])
        .optional(),
    })
    .strict(),
  "proof.plan.approve": z
    .object({
      proofId: identifier,
      expectedVersion,
      decisionId: identifier,
      reason,
      confirm: z.literal(true),
    })
    .strict(),
  "proof.continue": z
    .object({
      proofId: identifier,
      expectedVersion,
      action: z.enum([
        "revise-plan",
        "request-plan-review",
        "return-to-planning",
        "start-pilot",
        "start-required-coverage",
        "record-runs",
      ]),
      builds: z.array(changeVerificationBuildSchema).max(32).readonly().optional(),
      selection: changeVerificationSelectionSchema.optional(),
      coverageGaps: z.array(reason).max(128).readonly().optional(),
      residualRisk: z.array(reason).max(128).readonly().optional(),
      smallestNextVerification: changeVerificationNextSchema.optional(),
      runIds: z.array(identifier).min(1).max(1_000).readonly().optional(),
      reason: reason.optional(),
    })
    .strict()
    .superRefine((input, context) => {
      if (input.action === "revise-plan" && (!input.builds || !input.selection)) {
        context.addIssue({
          code: "custom",
          message: "revise-plan requires exact builds and selection",
        });
      }
      if (input.action !== "revise-plan" && !input.reason) {
        if (
          input.action === "request-plan-review" ||
          input.action === "return-to-planning" ||
          input.action === "start-pilot" ||
          input.action === "start-required-coverage"
        ) {
          context.addIssue({ code: "custom", message: `${input.action} requires a reason` });
        }
      }
      if (input.action === "record-runs" && !input.runIds) {
        context.addIssue({ code: "custom", message: "record-runs requires runIds" });
      }
      if (input.action !== "record-runs" && input.runIds) {
        context.addIssue({
          code: "custom",
          path: ["runIds"],
          message: "is only valid for record-runs",
        });
      }
      if (input.action === "record-runs" && input.reason) {
        context.addIssue({
          code: "custom",
          path: ["reason"],
          message: "is not accepted; record-runs accepts only runIds",
        });
      }
      if (
        input.action === "record-runs" &&
        (input.builds ||
          input.selection ||
          input.coverageGaps ||
          input.residualRisk ||
          input.smallestNextVerification)
      ) {
        context.addIssue({
          code: "custom",
          message: "record-runs accepts only runIds",
        });
      }
      if (
        input.action !== "revise-plan" &&
        input.action !== "record-runs" &&
        (input.builds ||
          input.selection ||
          input.coverageGaps ||
          input.residualRisk ||
          input.smallestNextVerification)
      ) {
        context.addIssue({
          code: "custom",
          message: `${input.action} cannot include Verification Plan fields`,
        });
      }
    }),
  "proof.cancel": z
    .object({
      proofId: identifier,
      expectedVersion,
      reason,
      confirm: z.literal(true),
    })
    .strict(),
  "proof.publication.retry": z
    .object({
      proofId: identifier,
      publicationId: identifier,
      expectedProofVersion: expectedVersion,
      reason,
      confirm: z.literal(true),
    })
    .strict(),
  "proof.rerun-affected": z
    .object({
      proofId: identifier,
      expectedVersion,
      change: changeVerificationChangeSchema,
      builds: z.array(changeVerificationBuildSchema).max(32).readonly().optional(),
      selection: changeVerificationSelectionSchema.optional(),
      policy: changeVerificationPolicySchema.optional(),
      coverageGaps: z.array(reason).max(128).readonly().optional(),
      residualRisk: z.array(reason).max(128).readonly().optional(),
      smallestNextVerification: changeVerificationNextSchema.optional(),
    })
    .strict(),
  "proof.run": changeProofRunInputSchema,
} as const;

const mutationOutputSchema = z
  .object({ proof: changeVerificationSchema, receipt: changeVerificationMutationReceiptSchema })
  .strict();

export const changeVerificationOperationOutputSchemas = {
  "proof.prepare": z
    .object({
      proof: changeVerificationSchema,
      plan: verificationPlanSchema,
      disposition: z.enum(["created", "existing"]),
      nextAction: changeVerificationNextSchema,
      blockers: z.array(reason).max(512).readonly(),
    })
    .strict(),
  "proof.start": mutationOutputSchema.extend({ disposition: z.enum(["created", "existing"]) }),
  "proof.list": z
    .object({ proofs: z.array(changeVerificationSchema).max(100).readonly() })
    .strict(),
  "proof.inspect": z
    .object({
      proof: changeVerificationSchema,
      history: z.array(changeVerificationSchema).max(100).readonly().optional(),
      publications: z.array(changeProofPublicationReceiptSchema).max(100).readonly(),
      publicationOutbox: z.array(changeProofPublicationOutboxRecordSchema).max(100).readonly(),
      execution: changeProofExecutionSummarySchema.optional(),
    })
    .strict(),
  "proof.plan.approve": mutationOutputSchema,
  "proof.continue": mutationOutputSchema,
  "proof.cancel": mutationOutputSchema,
  "proof.publication.retry": z
    .object({
      proof: changeVerificationSchema,
      publication: changeProofPublicationOutboxRecordSchema,
      disposition: z.enum(["accepted", "reconciled", "already-published"]),
    })
    .strict(),
  "proof.rerun-affected": z
    .object({
      previous: changeVerificationSchema,
      replacement: changeVerificationSchema,
      receipt: changeVerificationMutationReceiptSchema,
    })
    .strict(),
  "proof.run": changeProofRunOutputSchema,
} as const;
