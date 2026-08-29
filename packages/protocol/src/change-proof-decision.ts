import * as z from "zod/v4";
import { CHANGE_VERIFICATION_DECISIONS } from "./change-verification.js";

const identifier = z.string().trim().min(1).max(256);
const boundedText = z.string().trim().min(1).max(4_096);
const sha256 = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const exactGitSha = z.string().regex(/^[a-f0-9]{40}$/u);

export const changeProofCaseResultSchema = z
  .object({
    appMapId: identifier,
    testId: identifier,
    targetCaseId: identifier,
    runId: identifier,
    sourceSha: exactGitSha,
    buildId: identifier,
    artifactDigest: sha256,
    outcome: z.enum(["passed", "rejected", "needs-review", "insufficient-evidence"]),
    evidenceDigests: z.array(sha256).min(1).max(128).readonly(),
    evidenceComplete: z.boolean(),
    selectorResolution: z.enum(["deterministic", "ambiguous", "unproven"]),
    inputOutcome: z.enum(["reconciled", "unreconciled"]),
    cleanup: z.enum(["restored", "unproved"]),
    failure: z
      .object({
        checkId: identifier.optional(),
        summary: boundedText,
        expected: boundedText.optional(),
        observed: boundedText.optional(),
        evidenceRefs: z.array(sha256).max(64).readonly(),
        relevantLogs: z.array(boundedText).max(32).readonly().optional(),
        suggestedScope: z.array(identifier).max(32).readonly().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((result, context) => {
    if (new Set(result.evidenceDigests).size !== result.evidenceDigests.length) {
      context.addIssue({ code: "custom", path: ["evidenceDigests"], message: "must be unique" });
    }
    if (result.outcome === "rejected" && !result.failure) {
      context.addIssue({ code: "custom", path: ["failure"], message: "is required for rejection" });
    }
  });

export const changeProofDecisionSchema = z
  .object({
    schemaVersion: z.literal(1),
    decision: z.enum(CHANGE_VERIFICATION_DECISIONS),
    state: z.enum(CHANGE_VERIFICATION_DECISIONS),
    summary: z
      .object({
        required: z.number().int().nonnegative(),
        passed: z.number().int().nonnegative(),
        rejected: z.number().int().nonnegative(),
        needsReview: z.number().int().nonnegative(),
        insufficient: z.number().int().nonnegative(),
        missing: z.number().int().nonnegative(),
      })
      .strict(),
    runIds: z.array(identifier).max(1_000).readonly(),
    evidenceDigests: z.array(sha256).max(2_000).readonly(),
    firstCausalFailure: z
      .object({
        runId: identifier,
        testId: identifier,
        targetCaseId: identifier,
        checkId: identifier.optional(),
        summary: boundedText,
        evidenceRefs: z.array(sha256).max(64).readonly(),
      })
      .strict()
      .optional(),
    coverageGaps: z.array(boundedText).max(128).readonly(),
    residualRisk: z.array(boundedText).max(128).readonly(),
    smallestNextVerification: z
      .object({
        kind: z.enum(["expand", "review", "none"]),
        reason: boundedText,
        appMapId: identifier.optional(),
        testId: identifier.optional(),
        targetCaseId: identifier.optional(),
      })
      .strict(),
    ruleIds: z.array(identifier).min(1).max(32).readonly(),
  })
  .strict();

export const agentRepairPacketSchema = z
  .object({
    schemaVersion: z.literal(1),
    proofId: identifier,
    headSha: exactGitSha,
    runId: identifier,
    appMapId: identifier,
    testId: identifier,
    targetCaseId: identifier,
    firstCausalFailure: boundedText,
    expected: boundedText.optional(),
    observed: boundedText.optional(),
    evidenceRefs: z.array(sha256).max(64).readonly(),
    relevantLogs: z.array(boundedText).max(32).readonly(),
    suggestedScope: z.array(identifier).max(32).readonly(),
    rerun: z
      .object({ operationId: z.literal("proof.rerun-affected"), proofId: identifier })
      .strict(),
  })
  .strict();

export const changeProofProviderCheckSchema = z
  .object({
    schemaVersion: z.literal(1),
    name: z.literal("Relay Proof"),
    externalId: identifier,
    headSha: exactGitSha,
    status: z.literal("completed"),
    conclusion: z.enum(["success", "failure", "action-required"]),
    title: boundedText,
    summary: boundedText,
    text: z.string().max(65_535),
    detailsUrl: z.string().url().optional(),
  })
  .strict();

/** Token-free provider acknowledgement retained beside the immutable Proof.
 * Repeated publications append receipts while preserving one provider check
 * identity for the exact head. */
export const changeProofPublicationReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    sequence: z.number().int().positive(),
    organizationId: identifier,
    projectId: identifier,
    proofId: identifier,
    provider: z.literal("github"),
    repository: z.string().trim().min(1).max(512),
    headSha: exactGitSha,
    externalId: identifier,
    checkRunId: z.number().int().positive(),
    checkDigest: sha256,
    conclusion: z.enum(["success", "failure", "action-required"]),
    htmlUrl: z.string().url().optional(),
    publishedAt: z.number().int().nonnegative(),
  })
  .strict();

export type ChangeProofCaseResult = z.output<typeof changeProofCaseResultSchema>;
export type ChangeProofDecision = z.output<typeof changeProofDecisionSchema>;
export type AgentRepairPacket = z.output<typeof agentRepairPacketSchema>;
export type ChangeProofProviderCheck = z.output<typeof changeProofProviderCheckSchema>;
export type ChangeProofPublicationReceipt = z.output<typeof changeProofPublicationReceiptSchema>;
