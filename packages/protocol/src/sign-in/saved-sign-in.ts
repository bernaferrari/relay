import * as z from "zod/v4";

export const DEFAULT_SAVED_SIGN_IN_KEY = "default";

/** Portable logical name a Test may mention. Lowercase keeps the CI
 * environment overlay spelling deterministic and collision-free. */
export const savedSignInKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9._-]*$/u, "Use lowercase letters, numbers, dots, underscores or dashes");

const signInId = z.uuid();
const signInRevision = z.number().int().positive();

export const savedSignInReferenceSchema = z
  .string()
  .regex(
    /^signin:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[1-9][0-9]*$/u,
    "Expected an exact versioned saved sign-in reference",
  );

export const savedSignInMetadataSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: signInId,
    reference: savedSignInReferenceSchema,
    revision: signInRevision,
    projectId: z.string().min(1).max(256),
    appMapId: z.string().min(1).max(128),
    key: savedSignInKeySchema,
    name: z.string().min(1).max(128),
    kind: z.literal("username-password"),
    /** Optional person-supplied non-secret reminder. It is never derived from
     * the secret username and must never contain the password. */
    usernameHint: z.string().min(1).max(160).optional(),
    /** Phase-2 inbox identity metadata. No inbox or magic-link secret exists in Phase 1. */
    inboxKey: savedSignInKeySchema.optional(),
    createdAt: z.number().int().nonnegative(),
    createdBy: z.string().min(1).max(256),
    updatedAt: z.number().int().nonnegative(),
    updatedBy: z.string().min(1).max(256),
    expiresAt: z.number().int().positive().optional(),
    revokedAt: z.number().int().nonnegative().optional(),
    revokedBy: z.string().min(1).max(256).optional(),
  })
  .strict()
  .superRefine((signIn, context) => {
    if (signIn.reference !== `signin:${signIn.id}:${signIn.revision}`) {
      context.addIssue({
        code: "custom",
        path: ["reference"],
        message: "Saved sign-in reference must match its exact id and revision",
      });
    }
    if ((signIn.revokedAt === undefined) !== (signIn.revokedBy === undefined)) {
      context.addIssue({
        code: "custom",
        path: ["revokedAt"],
        message: "Saved sign-in revocation time and reviewer must be recorded together",
      });
    }
    if (signIn.updatedAt < signIn.createdAt) {
      context.addIssue({
        code: "custom",
        path: ["updatedAt"],
        message: "Saved sign-in update time cannot precede creation",
      });
    }
  });

export type SavedSignInMetadata = z.infer<typeof savedSignInMetadataSchema>;

/** Plaintext exists only inside the encrypted vault file and inside the
 * save/rotate request boundary. It is never an operation output. */
export const savedSignInSecretSchema = z
  .object({
    username: z.string().min(1).max(320),
    password: z.string().min(1).max(512),
  })
  .strict();

export type SavedSignInSecret = z.infer<typeof savedSignInSecretSchema>;

const mutableSecretFields = {
  username: savedSignInSecretSchema.shape.username,
  password: savedSignInSecretSchema.shape.password,
  usernameHint: z.string().trim().min(1).max(160).optional(),
  inboxKey: savedSignInKeySchema.optional(),
  expiresAt: z.number().int().positive().optional(),
} as const;

export const savedSignInOperationInputSchemas = {
  "sign-in.save": z
    .object({
      appMapId: z.string().trim().min(1).max(128),
      key: savedSignInKeySchema.optional(),
      name: z.string().trim().min(1).max(128),
      ...mutableSecretFields,
      confirm: z.literal(true),
    })
    .strict(),
  "sign-in.rotate": z
    .object({
      key: savedSignInKeySchema.optional(),
      ...mutableSecretFields,
      confirm: z.literal(true),
    })
    .strict(),
  "sign-in.list": z
    .object({
      appMapId: z.string().trim().min(1).max(128).optional(),
      key: savedSignInKeySchema.optional(),
    })
    .strict(),
  "sign-in.revoke": z
    .object({
      key: savedSignInKeySchema.optional(),
      confirm: z.literal(true),
    })
    .strict(),
  "sign-in.resolve-check": z.object({ key: savedSignInKeySchema.optional() }).strict(),
} as const;

export const savedSignInResolutionSchema = z
  .object({
    schemaVersion: z.literal(1),
    key: savedSignInKeySchema,
    status: z.enum([
      "ready",
      "missing",
      "revoked",
      "expired",
      "partial-environment",
      "unavailable",
    ]),
    source: z.enum(["environment", "local", "none"]),
    reference: savedSignInReferenceSchema.optional(),
    signIn: savedSignInMetadataSchema.optional(),
    detail: z.string().min(1).max(500),
    recovery: z.string().min(1).max(500),
    environment: z
      .object({
        usernameVariable: z.string().min(1).max(128),
        passwordVariable: z.string().min(1).max(128),
        missing: z.enum(["username", "password"]).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type SavedSignInResolution = z.infer<typeof savedSignInResolutionSchema>;

export const savedSignInOperationOutputSchemas = {
  "sign-in.save": z.object({ signIn: savedSignInMetadataSchema }).strict(),
  "sign-in.rotate": z.object({ signIn: savedSignInMetadataSchema }).strict(),
  "sign-in.list": z.object({ signIns: z.array(savedSignInMetadataSchema).max(256) }).strict(),
  "sign-in.revoke": z
    .object({
      key: savedSignInKeySchema,
      signIns: z.array(savedSignInMetadataSchema).max(256),
    })
    .strict(),
  "sign-in.resolve-check": z.object({ resolution: savedSignInResolutionSchema }).strict(),
} as const;
