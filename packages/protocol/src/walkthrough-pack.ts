import * as z from "zod/v4";

const sha256 = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const imageSha256 = z.string().regex(/^[a-f0-9]{64}$/u);

export const walkthroughPackExportResponseSchema = z
  .object({
    pack: z
      .object({
        schemaVersion: z.literal(1),
        kind: z.literal("relay-walkthrough-pack"),
        digest: sha256,
        manifest: z
          .object({
            schemaVersion: z.literal(1),
            pinned: z
              .object({
                appMapId: z.string().min(1),
                appMapRevision: z.number().int(),
                runIds: z.array(z.string().min(1)).min(1),
                generatedAt: z.number(),
              })
              .strict(),
          })
          .catchall(z.unknown()),
        frames: z.array(
          z
            .object({
              runId: z.string().min(1),
              framePath: z.string().min(1),
              imageSha256,
              content: z.string().min(1),
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict();

export type WalkthroughPackExportResponse = z.output<typeof walkthroughPackExportResponseSchema>;

export function parseWalkthroughPackExportResponse(value: unknown): WalkthroughPackExportResponse {
  return walkthroughPackExportResponseSchema.parse(value);
}
