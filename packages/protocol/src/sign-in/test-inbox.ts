import * as z from "zod/v4";
import { savedSignInKeySchema } from "./saved-sign-in.js";

/** Portable logical name a Test may mention. It intentionally uses the same
 * lowercase grammar as saved sign-ins so CI environment overlays are stable. */
export const testInboxKeySchema = savedSignInKeySchema;

const inboxId = z.uuid();
const inboxRevision = z.number().int().positive();

export const testInboxReferenceSchema = z
  .string()
  .regex(
    /^inbox:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[1-9][0-9]*$/u,
    "Expected an exact versioned test inbox reference",
  );

const hostSchema = z.string().trim().min(1).max(253);
const mailboxSchema = z.string().trim().min(1).max(256);
const recipientSchema = z.string().trim().min(3).max(320);
const portSchema = z.number().int().min(1).max(65_535);

export const testInboxMetadataSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: inboxId,
    reference: testInboxReferenceSchema,
    revision: inboxRevision,
    projectId: z.string().min(1).max(256),
    key: testInboxKeySchema,
    name: z.string().min(1).max(128),
    host: hostSchema,
    port: portSchema,
    secure: z.boolean(),
    mailbox: mailboxSchema,
    /** Optional non-secret deliverability filter. It is metadata because it is
     * often the plus-addressed test recipient shown in the product. */
    recipient: recipientSchema.optional(),
    /** Person-supplied non-secret reminder. It is never derived from the secret username. */
    usernameHint: z.string().min(1).max(160).optional(),
    createdAt: z.number().int().nonnegative(),
    createdBy: z.string().min(1).max(256),
    updatedAt: z.number().int().nonnegative(),
    updatedBy: z.string().min(1).max(256),
    revokedAt: z.number().int().nonnegative().optional(),
    revokedBy: z.string().min(1).max(256).optional(),
  })
  .strict()
  .superRefine((inbox, context) => {
    if (inbox.reference !== `inbox:${inbox.id}:${inbox.revision}`) {
      context.addIssue({
        code: "custom",
        path: ["reference"],
        message: "Test inbox reference must match its exact id and revision",
      });
    }
    if ((inbox.revokedAt === undefined) !== (inbox.revokedBy === undefined)) {
      context.addIssue({
        code: "custom",
        path: ["revokedAt"],
        message: "Test inbox revocation time and reviewer must be recorded together",
      });
    }
    if (inbox.updatedAt < inbox.createdAt) {
      context.addIssue({
        code: "custom",
        path: ["updatedAt"],
        message: "Test inbox update time cannot precede creation",
      });
    }
  });

export type TestInboxMetadata = z.infer<typeof testInboxMetadataSchema>;

/** Plaintext exists only inside the encrypted vault file and inside the
 * save/rotate request boundary. It is never an operation output. */
export const testInboxSecretSchema = z
  .object({
    username: z.string().min(1).max(320),
    password: z.string().min(1).max(512),
  })
  .strict();

export type TestInboxSecret = z.infer<typeof testInboxSecretSchema>;

const inboxConfigurationFields = {
  host: hostSchema,
  port: portSchema,
  secure: z.boolean(),
  mailbox: mailboxSchema,
  recipient: recipientSchema.optional(),
  usernameHint: z.string().trim().min(1).max(160).optional(),
} as const;

const mutableSecretFields = {
  username: testInboxSecretSchema.shape.username,
  password: testInboxSecretSchema.shape.password,
} as const;

export const testInboxOperationInputSchemas = {
  "inbox.save": z
    .object({
      key: testInboxKeySchema.optional(),
      name: z.string().trim().min(1).max(128),
      ...inboxConfigurationFields,
      ...mutableSecretFields,
      confirm: z.literal(true),
    })
    .strict(),
  "inbox.rotate": z
    .object({
      key: testInboxKeySchema.optional(),
      host: hostSchema.optional(),
      port: portSchema.optional(),
      secure: z.boolean().optional(),
      mailbox: mailboxSchema.optional(),
      recipient: recipientSchema.optional(),
      usernameHint: z.string().trim().min(1).max(160).optional(),
      ...mutableSecretFields,
      confirm: z.literal(true),
    })
    .strict(),
  "inbox.list": z.object({ key: testInboxKeySchema.optional() }).strict(),
  "inbox.revoke": z
    .object({ key: testInboxKeySchema.optional(), confirm: z.literal(true) })
    .strict(),
  "inbox.check": z.object({ key: testInboxKeySchema.optional() }).strict(),
} as const;

export const testInboxResolutionSchema = z
  .object({
    schemaVersion: z.literal(1),
    key: testInboxKeySchema,
    status: z.enum([
      "ready",
      "missing",
      "revoked",
      "partial-environment",
      "authentication-failure",
      "connection-failure",
      "unavailable",
    ]),
    source: z.enum(["environment", "local", "none"]),
    reference: testInboxReferenceSchema.optional(),
    inbox: testInboxMetadataSchema.optional(),
    detail: z.string().min(1).max(500),
    recovery: z.string().min(1).max(500),
    environment: z
      .object({
        hostVariable: z.string().min(1).max(128),
        portVariable: z.string().min(1).max(128),
        secureVariable: z.string().min(1).max(128),
        mailboxVariable: z.string().min(1).max(128),
        usernameVariable: z.string().min(1).max(128),
        passwordVariable: z.string().min(1).max(128),
        recipientVariable: z.string().min(1).max(128),
        missing: z
          .array(z.enum(["host", "port", "secure", "mailbox", "username", "password"]))
          .min(1)
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type TestInboxResolution = z.infer<typeof testInboxResolutionSchema>;

export const testInboxOperationOutputSchemas = {
  "inbox.save": z.object({ inbox: testInboxMetadataSchema }).strict(),
  "inbox.rotate": z.object({ inbox: testInboxMetadataSchema }).strict(),
  "inbox.list": z.object({ inboxes: z.array(testInboxMetadataSchema).max(256) }).strict(),
  "inbox.revoke": z
    .object({
      key: testInboxKeySchema,
      inboxes: z.array(testInboxMetadataSchema).max(256),
    })
    .strict(),
  "inbox.check": z.object({ resolution: testInboxResolutionSchema }).strict(),
} as const;
