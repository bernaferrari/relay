import * as z from "zod/v4";

const fixtureId = z.uuid();
const fixtureRevision = z.number().int().positive();

export const browserAuthenticationFixtureReferenceSchema = z
  .string()
  .regex(
    /^authfx:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[1-9][0-9]*$/u,
    "Expected an exact versioned browser authentication fixture reference",
  );

export const browserAuthenticationFixtureSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: fixtureId,
    reference: browserAuthenticationFixtureReferenceSchema,
    revision: fixtureRevision,
    projectId: z.string().min(1).max(256),
    targetId: z.string().min(1).max(96),
    name: z.string().min(1).max(128),
    origins: z.array(z.string().min(1)).max(128),
    cookieCount: z.number().int().nonnegative(),
    createdAt: z.number().int().nonnegative(),
    createdBy: z.string().min(1).max(256),
    expiresAt: z.number().int().positive().optional(),
    revokedAt: z.number().int().nonnegative().optional(),
    revokedBy: z.string().min(1).max(256).optional(),
  })
  .strict()
  .superRefine((fixture, context) => {
    if (fixture.reference !== `authfx:${fixture.id}:${fixture.revision}`) {
      context.addIssue({
        code: "custom",
        path: ["reference"],
        message: "Fixture reference must match its exact id and revision",
      });
    }
    if ((fixture.revokedAt === undefined) !== (fixture.revokedBy === undefined)) {
      context.addIssue({
        code: "custom",
        path: ["revokedAt"],
        message: "Fixture revocation time and reviewer must be recorded together",
      });
    }
  });

export type BrowserAuthenticationFixture = z.infer<typeof browserAuthenticationFixtureSchema>;

export const browserAuthenticationFixtureOperationInputSchemas = {
  "target.browser-auth.save": z
    .object({
      targetId: z.string().min(1).max(96),
      name: z.string().min(1).max(128),
      expiresAt: z.number().int().positive().optional(),
      fixtureId: fixtureId.optional(),
      confirm: z.literal(true),
    })
    .strict(),
  "target.browser-auth.list": z.object({ targetId: z.string().min(1).max(96) }).strict(),
  "target.browser-auth.revoke": z
    .object({
      targetId: z.string().min(1).max(96),
      reference: browserAuthenticationFixtureReferenceSchema,
      confirm: z.literal(true),
    })
    .strict(),
} as const;
