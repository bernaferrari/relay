import * as z from "zod/v4";
import {
  changeProofProviderCheckSchema,
  changeProofPublicationReceiptSchema,
} from "./change-proof-decision.js";

const identifier = z.string().trim().min(1).max(256);
const repository = z.string().trim().min(1).max(512);
const timestamp = z.number().int().nonnegative();

export const changeProofPublicationOutboxStatusSchema = z.enum([
  "pending",
  "claimed",
  "retry",
  "published",
]);

/** Failure classes are intentionally closed and token-free. Provider error
 * text must never become durable control-plane data. */
export const changeProofPublicationOutboxFailureKindSchema = z.enum([
  "provider-error",
  "reconciliation-error",
  "lease-lost",
]);

export const changeProofPublicationOutboxLeaseSchema = z
  .object({
    workerId: identifier,
    token: identifier,
    claimedAt: timestamp,
    expiresAt: timestamp,
  })
  .strict()
  .superRefine((lease, context) => {
    if (lease.expiresAt <= lease.claimedAt) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "must be after claimedAt",
      });
    }
  });

/** The complete, deterministic input to a provider publication. It contains
 * no provider credentials or endpoint configuration. */
export const changeProofPublicationIntentSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: identifier,
    organizationId: identifier,
    projectId: identifier,
    proofId: identifier,
    proofVersion: z.number().int().positive(),
    provider: z.literal("github"),
    repository,
    headSha: z.string().regex(/^[a-f0-9]{40}$/u),
    externalId: identifier,
    check: changeProofProviderCheckSchema,
    createdAt: timestamp,
  })
  .strict()
  .superRefine((intent, context) => {
    if (intent.check.headSha !== intent.headSha) {
      context.addIssue({
        code: "custom",
        path: ["check", "headSha"],
        message: "must match intent headSha",
      });
    }
    if (intent.check.externalId !== intent.externalId) {
      context.addIssue({
        code: "custom",
        path: ["check", "externalId"],
        message: "must match intent externalId",
      });
    }
  });

export const changeProofPublicationOutboxFailureSchema = z
  .object({
    kind: changeProofPublicationOutboxFailureKindSchema,
    at: timestamp,
  })
  .strict();

export const changeProofPublicationOutboxRecordSchema = changeProofPublicationIntentSchema
  .extend({
    status: changeProofPublicationOutboxStatusSchema,
    attempts: z.number().int().nonnegative(),
    maxAttempts: z.number().int().positive().max(32),
    nextAttemptAt: timestamp.optional(),
    lease: changeProofPublicationOutboxLeaseSchema.optional(),
    lastFailure: changeProofPublicationOutboxFailureSchema.optional(),
    receipt: changeProofPublicationReceiptSchema.optional(),
    publishedAt: timestamp.optional(),
    updatedAt: timestamp,
  })
  .strict()
  .superRefine((record, context) => {
    if (record.status === "pending") {
      if (record.attempts !== 0) {
        context.addIssue({
          code: "custom",
          path: ["attempts"],
          message: "pending must be untried",
        });
      }
      if (record.lease || record.receipt || record.publishedAt !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["status"],
          message: "pending has invalid terminal data",
        });
      }
    }
    if (record.status === "claimed") {
      if (
        record.attempts < 1 ||
        !record.lease ||
        record.receipt ||
        record.publishedAt !== undefined
      ) {
        context.addIssue({
          code: "custom",
          path: ["status"],
          message: "claimed requires one active lease",
        });
      }
    }
    if (record.status === "retry") {
      if (
        record.attempts < 1 ||
        record.lease ||
        record.receipt ||
        record.publishedAt !== undefined
      ) {
        context.addIssue({
          code: "custom",
          path: ["status"],
          message: "retry requires no active lease",
        });
      }
    }
    if (record.status === "published") {
      if (!record.receipt || record.publishedAt === undefined || record.lease) {
        context.addIssue({
          code: "custom",
          path: ["status"],
          message: "published requires a receipt",
        });
      }
      if (record.receipt && record.receipt.proofId !== record.proofId) {
        context.addIssue({
          code: "custom",
          path: ["receipt", "proofId"],
          message: "must match intent",
        });
      }
    }
    if (record.attempts > record.maxAttempts) {
      context.addIssue({
        code: "custom",
        path: ["attempts"],
        message: "cannot exceed maxAttempts",
      });
    }
  });

export type ChangeProofPublicationOutboxStatus = z.output<
  typeof changeProofPublicationOutboxStatusSchema
>;
export type ChangeProofPublicationOutboxFailureKind = z.output<
  typeof changeProofPublicationOutboxFailureKindSchema
>;
export type ChangeProofPublicationOutboxLease = z.output<
  typeof changeProofPublicationOutboxLeaseSchema
>;
export type ChangeProofPublicationIntent = z.output<typeof changeProofPublicationIntentSchema>;
export type ChangeProofPublicationOutboxFailure = z.output<
  typeof changeProofPublicationOutboxFailureSchema
>;
export type ChangeProofPublicationOutboxRecord = z.output<
  typeof changeProofPublicationOutboxRecordSchema
>;
