import * as z from "zod/v4";

export const artifactMediaOutputSchema = z
  .object({
    kind: z.enum([
      "image",
      "video",
      "structured-data",
      "log",
      "network",
      "performance",
      "crash",
      "audio",
      "binary",
      "unknown",
    ]),
    mime: z.string().optional(),
  })
  .strict();
export const artifactSourceOutputSchema = z.enum([
  "authoring-evidence",
  "recipe-evidence",
  "run-frame",
  "run-artifact",
  "external",
]);
export const artifactRefOutputSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    integrity: z
      .object({
        algorithm: z.literal("sha256"),
        sha256: z.string().regex(/^[a-f0-9]{64}$/u),
        bytes: z.number(),
      })
      .strict(),
    media: artifactMediaOutputSchema,
    capturedAt: z.number().optional(),
    provenance: z
      .object({
        source: artifactSourceOutputSchema,
        capture: z.enum(["recorded", "derived", "imported", "unknown"]),
      })
      .strict(),
    retention: z
      .object({
        scope: z.enum([
          "workspace-content-addressed",
          "recipe-content-addressed",
          "run-directory",
          "external",
        ]),
        recoverability: z.enum(["content-addressed", "best-effort", "external"]),
      })
      .strict(),
    locations: z.array(
      z
        .object({
          store: z.enum(["authoring-evidence", "recipe-evidence", "run", "external"]),
          opaque: z
            .string()
            .min(1)
            .refine(
              (value) => !value.startsWith("/") && !/^file:/iu.test(value),
              "must not expose a host path",
            ),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((artifact, context) => {
    if (artifact.id !== `sha256:${artifact.integrity.sha256}`) {
      context.addIssue({
        code: "custom",
        message: "artifact id must be its canonical SHA-256 identity",
        path: ["id"],
      });
    }
  });
export const artifactProjectionOutputSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("available"), artifact: artifactRefOutputSchema }).strict(),
  z
    .object({
      status: z.literal("redacted"),
      source: artifactSourceOutputSchema,
      media: artifactMediaOutputSchema,
      capturedAt: z.number().optional(),
      reason: z.literal("visual-evidence-policy"),
    })
    .strict(),
  z
    .object({
      status: z.literal("missing"),
      source: artifactSourceOutputSchema,
      media: artifactMediaOutputSchema,
      capturedAt: z.number().optional(),
    })
    .strict(),
]);
