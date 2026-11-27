import * as z from "zod/v4";

export const captureReviewActorKindSchema = z.enum(["human", "agent", "system"]);
export const captureReviewActorSchema = z
  .object({ id: z.string().min(1), kind: captureReviewActorKindSchema })
  .strict();

export const normalizedCaptureRegionSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
    name: z.string().optional(),
  })
  .strict()
  .superRefine((region, context) => {
    if (region.x + region.width > 1.000_001 || region.y + region.height > 1.000_001) {
      context.addIssue({
        code: "custom",
        message: "region must fit inside normalized image bounds",
      });
    }
  });

export const captureReferenceComparisonSchema = z
  .object({
    state: z.enum(["match", "changed", "new", "incomparable"]),
    comparedAt: z.number(),
    referenceId: z.string().optional(),
    referenceRunId: z.string().optional(),
    referenceApprovedAt: z.number().optional(),
    referenceApprovedBy: z
      .object({ id: z.string(), kind: captureReviewActorKindSchema })
      .strict()
      .optional(),
    changeRatio: z.number().optional(),
    consideredPixels: z.number().optional(),
    ignoredPixels: z.number().optional(),
    changedPixels: z.number().optional(),
    pixelThreshold: z.number().optional(),
    changeThreshold: z.number().optional(),
    changedBounds: normalizedCaptureRegionSchema.optional(),
    sizeChanged: z.boolean().optional(),
    ignoreRegions: z.array(normalizedCaptureRegionSchema).optional(),
  })
  .strict();

export const captureReviewDecisionOutputSchema = z
  .object({
    captureId: z.string().min(1),
    action: z.enum(["accept", "accept-as-reference", "report-issue", "need-more-evidence"]),
    decidedAt: z.number(),
    decidedBy: captureReviewActorSchema,
    imageSha256: z.string().optional(),
    note: z.string().optional(),
    requestId: z.string().optional(),
    reviewVersion: z.number().int().nonnegative().optional(),
    referenceBaseId: z.string().nullable().optional(),
  })
  .strict();
