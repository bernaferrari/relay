import * as z from "zod/v4";

export const MAX_FIXTURE_BYTES = 25 * 1024 * 1024;
export const MAX_FIXTURE_BASE64_CHARS = 4 * Math.ceil(MAX_FIXTURE_BYTES / 3);
export const fixtureNameSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._ -]*$/u, "Use a filename without folders or special characters");
export const managedFixtureSchema = z
  .object({
    file: z.string().regex(/^fixture:[a-f0-9]{64}\/[A-Za-z0-9][A-Za-z0-9._ -]{0,159}$/u),
    name: fixtureNameSchema,
    size: z.number().int().min(1).max(MAX_FIXTURE_BYTES),
  })
  .strict();
export type ManagedFixture = z.infer<typeof managedFixtureSchema>;

export const managedFixtureInputSchemas = {
  "fixture.import": z
    .object({
      name: fixtureNameSchema,
      base64: z.string().min(4).max(MAX_FIXTURE_BASE64_CHARS),
    })
    .strict(),
  "fixture.list": z.object({}).strict(),
} as const;
export const managedFixtureOutputSchemas = {
  "fixture.import": z.object({ fixture: managedFixtureSchema }).strict(),
  "fixture.list": z.object({ fixtures: z.array(managedFixtureSchema) }).strict(),
} as const;
