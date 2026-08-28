import * as z from "zod/v4";

export const repeatDimensionValuesSchema = z.union([
  z.literal("all"),
  z.literal("supported"),
  z.array(z.string().trim().min(1)).min(1).max(1_000),
]);

export const repeatDimensionSpecSchema = z
  .object({
    id: z.string().trim().min(1),
    values: repeatDimensionValuesSchema,
  })
  .strict();

export const repeatPilotSpecSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("representative") }).strict(),
  z.object({ mode: z.literal("first") }).strict(),
  z
    .object({
      mode: z.literal("specified"),
      case: z.record(z.string().trim().min(1), z.string().trim().min(1)),
    })
    .strict(),
]);

/**
 * The single public Repeat contract. Dimension order is meaningful for zip
 * and pairwise expansion and therefore survives every projection unchanged.
 * `supported` means the values Relay discovered and saved on that dimension;
 * it resolves to immutable ids before any target mutation.
 */
export const repeatSpecSchema = z
  .object({
    dimensions: z.array(repeatDimensionSpecSchema).min(1).max(8),
    strategy: z.enum(["cartesian", "zip", "pairwise"]).optional(),
    pilot: repeatPilotSpecSchema.optional(),
    resume: z.enum(["untouched", "failed", "all"]).optional(),
  })
  .strict()
  .superRefine((spec, context) => {
    const ids = spec.dimensions.map((dimension) => dimension.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: "custom", message: "Repeat dimensions must be unique" });
    }
    for (const [index, dimension] of spec.dimensions.entries()) {
      if (
        Array.isArray(dimension.values) &&
        new Set(dimension.values).size !== dimension.values.length
      ) {
        context.addIssue({
          code: "custom",
          message: "Repeat values must be unique within a dimension",
          path: ["dimensions", index, "values"],
        });
      }
    }
    if (spec.pilot?.mode === "specified") {
      const expected = new Set(ids);
      const actual = Object.keys(spec.pilot.case);
      if (
        actual.length !== expected.size ||
        actual.some((dimensionId) => !expected.has(dimensionId))
      ) {
        context.addIssue({
          code: "custom",
          message: "A specified pilot case must name every Repeat dimension exactly once",
          path: ["pilot", "case"],
        });
      }
    }
  });

export type RepeatDimensionValues = z.infer<typeof repeatDimensionValuesSchema>;
export type RepeatDimensionSpec = z.infer<typeof repeatDimensionSpecSchema>;
export type RepeatPilotSpec = z.infer<typeof repeatPilotSpecSchema>;
export type RepeatSpec = z.infer<typeof repeatSpecSchema>;
export type RepeatPolicySpec = Pick<RepeatSpec, "pilot" | "resume"> & {
  /** Distinguishes a requested supported set from all saved values. Explicit
   * lists remain canonical in AppMapCombine.selected. */
  valueModes?: Record<string, "all" | "supported">;
};

/** Exact ids resolved from one frozen App Map before campaign compilation. */
export type ResolvedRepeatSpec = {
  dimensions: Array<{ id: string; valueIds: string[] }>;
  strategy: "cartesian" | "zip" | "pairwise";
  pilot: RepeatPilotSpec;
  resume: "untouched" | "failed" | "all";
};

export function singleDimensionRepeatSpec(input: {
  dimensionId: string;
  valueIds: readonly string[];
}): RepeatSpec {
  return {
    dimensions: [{ id: input.dimensionId, values: [...input.valueIds] }],
    strategy: "zip",
    pilot: { mode: "representative" },
    resume: "untouched",
  };
}
