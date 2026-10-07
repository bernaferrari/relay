import * as z from "zod/v4";

export const namedControlResolutionSchema = z
  .object({
    method: z.enum(["identifier", "label", "text", "relation", "point"]),
    point: z.object({ x: z.number(), y: z.number() }).strict(),
    bounds: z
      .object({
        x: z.number(),
        y: z.number(),
        width: z.number().positive(),
        height: z.number().positive(),
      })
      .strict(),
    activation: z.literal("snapshot-point").optional(),
  })
  .strict();

export const interactPreviewResolutionStateSchema = z.enum([
  "resolved",
  "ambiguous",
  "unresolved",
  "unavailable",
]);

export type InteractPreviewResolutionState = z.infer<typeof interactPreviewResolutionStateSchema>;

/** Legacy previews may omit state. An authoritative selection state cannot
 * contradict the presence or absence of its location. */
export const interactPreviewSelectionSchema = z
  .object({
    resolutionState: interactPreviewResolutionStateSchema.optional(),
    resolution: namedControlResolutionSchema.optional(),
  })
  .strict()
  .refine(
    (selection) =>
      selection.resolutionState === undefined ||
      (selection.resolutionState === "resolved"
        ? selection.resolution !== undefined
        : selection.resolution === undefined),
    "Preview selection state must agree with its resolution",
  );

export type InteractPreviewSelection = z.infer<typeof interactPreviewSelectionSchema>;
