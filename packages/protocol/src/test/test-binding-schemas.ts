import * as z from "zod/v4";
import { plainEnglishBindingFields } from "../everyday-operation-output-schemas.js";
import { identifier, natural, stepTarget, text } from "../operation/operation-schema-primitives.js";

export const testBindingCandidate = z
  .object({
    kind: z.enum(["connection", "screen", "routine"]),
    id: identifier("Candidate entity identifier"),
    label: text("Candidate label"),
  })
  .strict();

export const unresolvedTestBinding = z
  .object({
    status: z.literal("unresolved"),
    reason: text("Why this Test step is not bound"),
    candidates: z.array(testBindingCandidate).max(12).optional(),
    ...plainEnglishBindingFields,
  })
  .strict()
  .superRefine((binding, context) => {
    if (!binding.candidates) return;
    const ids = binding.candidates.map(({ id }) => id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        message: "Binding candidates must use unique entity IDs",
        path: ["candidates"],
      });
    }
  });

export const assertionSpec = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("screen"), screenId: identifier("Expected screen identifier") })
    .strict(),
  z
    .object({
      kind: z.literal("target"),
      target: stepTarget,
      condition: z.enum(["visible", "gone"]),
      timeoutMs: natural("Optional assertion timeout in milliseconds").optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("layout"),
      relation: z.literal("non-overlap"),
      first: stepTarget,
      second: stepTarget,
      timeoutMs: natural("Optional assertion timeout in milliseconds").optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("content"),
      input: text("Observed or extracted value"),
      expected: z.string(),
      match: z.enum(["exact", "equals", "contains", "not-contains", "number-equals", "field"]),
      field: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("visual"),
      criteria: z.array(text("Visual criterion")).min(1).max(20),
      requireAgreement: z.boolean().optional(),
      provider: z.string().min(1).optional(),
      model: z.string().min(1).optional(),
      secondProvider: z.string().min(1).optional(),
      secondModel: z.string().min(1).optional(),
      region: z
        .object({
          x: z.number(),
          y: z.number(),
          width: z.number().positive(),
          height: z.number().positive(),
        })
        .strict()
        .optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("semantic"),
      input: text("Extracted or observed reply to judge"),
      criteria: z.array(text("Semantic criterion")).min(1).max(20),
      requireAgreement: z.boolean().optional(),
      provider: z.string().min(1).optional(),
      model: z.string().min(1).optional(),
      secondProvider: z.string().min(1).optional(),
      secondModel: z.string().min(1).optional(),
    })
    .strict(),
]);

export const validationRecipeStep = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("expect"),
      target: stepTarget,
      condition: z.enum(["visible", "gone"]),
      timeoutMs: natural("Optional assertion timeout in milliseconds").optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("expect-set"),
      identifierPrefix: z.string().min(1).optional(),
      scope: stepTarget.optional(),
      labels: z.array(z.string()).min(1),
      timeoutMs: natural("Optional assertion timeout in milliseconds").optional(),
      extras: z.enum(["forbid", "allow"]).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("assert-content"),
      input: text("Observed or extracted value"),
      expected: z.string(),
      match: z.enum(["exact", "equals", "contains", "not-contains", "number-equals", "field"]),
      field: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("assert-layout"),
      relation: z.literal("non-overlap"),
      first: stepTarget,
      second: stepTarget,
      timeoutMs: natural("Optional assertion timeout in milliseconds").optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("wait-response"),
      target: stepTarget,
      busyTarget: stepTarget.optional(),
      idleTarget: stepTarget.optional(),
      timeoutMs: natural("Optional response timeout in milliseconds")
        .min(1_000)
        .max(900_000)
        .optional(),
      stableForMs: natural("Optional response stability window in milliseconds")
        .min(500)
        .max(30_000)
        .optional(),
      maxMs: natural("Optional maximum acceptable response duration in milliseconds")
        .min(1)
        .max(900_000)
        .optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("extract"),
      as: text("Variable name for the remembered reply"),
      target: stepTarget,
      role: z.enum(["user", "assistant", "system"]).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("evaluate-semantic"),
      input: text("Observed or extracted value"),
      criteria: z.array(text("Semantic criterion")).min(1).max(20),
      threshold: z.number().min(0).max(1).optional(),
      provider: z.string().optional(),
      model: z.string().optional(),
      requireAgreement: z.boolean().optional(),
      secondProvider: z.string().optional(),
      secondModel: z.string().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("evaluate-visual"),
      criteria: z.array(text("Visual criterion")).min(1).max(20),
      threshold: z.number().min(0).max(1).optional(),
      provider: z.string().optional(),
      model: z.string().optional(),
      requireAgreement: z.boolean().optional(),
      secondProvider: z.string().optional(),
      secondModel: z.string().optional(),
      region: z
        .object({
          x: z.number(),
          y: z.number(),
          width: z.number().positive(),
          height: z.number().positive(),
        })
        .strict()
        .optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("identity-ignore"),
      region: z
        .object({
          x: z.number(),
          y: z.number(),
          width: z.number().positive(),
          height: z.number().positive(),
        })
        .strict(),
      name: text("Human name for the ignored region").optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("screenshot"),
      caption: z.string().optional(),
      review: z
        .object({
          mode: z.literal("later"),
          lookFor: z.string().optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("upload"),
      file: z.string().min(1),
      target: stepTarget.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("download"),
      file: z.string().min(1),
      target: stepTarget,
    })
    .strict(),
  z
    .object({
      kind: z.literal("media-check"),
      file: z.string().min(1),
      media: z.enum(["image", "video", "audio"]),
      width: z.number().optional(),
      height: z.number().optional(),
      minDurationMs: z.number().optional(),
      minBytes: z.number().optional(),
      sourceFile: z.string().optional(),
      relation: z.enum(["edited", "upscaled", "extended"]).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("audio-record"),
      target: stepTarget,
      file: z.string().min(1),
      durationMs: z.number(),
    })
    .strict(),
]);

export const instructionBinding = z.union([
  unresolvedTestBinding,
  z
    .object({
      status: z.literal("resolved"),
      kind: z.literal("connections"),
      connectionIds: z.array(identifier("Connection identifier")).min(1),
    })
    .strict(),
]);
export const validationBinding = z.union([
  unresolvedTestBinding,
  z
    .object({
      status: z.literal("resolved"),
      kind: z.literal("assertion"),
      assertion: assertionSpec,
    })
    .strict(),
  z
    .object({
      status: z.literal("resolved"),
      kind: z.literal("recipe-step"),
      step: validationRecipeStep,
    })
    .strict(),
]);
export const extractionBinding = z.union([
  unresolvedTestBinding,
  z
    .object({
      status: z.literal("resolved"),
      kind: z.literal("extract"),
      as: identifier("Extraction variable name"),
      target: stepTarget,
      role: z.enum(["user", "assistant", "system"]).optional(),
    })
    .strict(),
]);
export const manualBinding = z.union([
  unresolvedTestBinding,
  z
    .object({
      status: z.literal("resolved"),
      kind: z.literal("pause"),
      message: text("Human checkpoint message"),
      reason: z
        .enum([
          "authentication",
          "consent",
          "verification",
          "captcha",
          "permission",
          "review",
          "other",
        ])
        .optional(),
      resumeLabel: z.string().optional(),
      timeoutMs: natural("Optional checkpoint timeout in milliseconds").optional(),
      verifyAfter: z
        .object({
          target: stepTarget,
          condition: z.enum(["visible", "gone"]).optional(),
          timeoutMs: natural("Optional verification timeout in milliseconds").optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
]);
export const moduleBinding = z.union([
  unresolvedTestBinding,
  z
    .object({
      status: z.literal("resolved"),
      kind: z.literal("routine"),
      routineId: identifier("Routine identifier"),
      bindings: z.record(z.string(), z.string()).optional(),
    })
    .strict(),
]);
export const decisionBinding = z.union([
  unresolvedTestBinding,
  z
    .object({
      status: z.literal("resolved"),
      kind: z.literal("condition"),
      input: text("Value used by the condition"),
      operator: z.enum(["exists", "equals", "not-equals", "contains"]),
      expected: z.string().optional(),
    })
    .strict(),
]);
export const loopBinding = z.union([
  unresolvedTestBinding,
  z
    .object({
      status: z.literal("resolved"),
      kind: z.literal("repeat"),
      count: z.number().int().min(1).max(20),
    })
    .strict(),
]);
export const scriptBinding = z.union([
  unresolvedTestBinding,
  z
    .object({
      status: z.literal("resolved"),
      kind: z.literal("script"),
      source: text("Canonical Relay script source").max(20_000),
    })
    .strict(),
]);

export const anyTestBinding = z.union([
  instructionBinding,
  validationBinding,
  extractionBinding,
  manualBinding,
  moduleBinding,
  decisionBinding,
  loopBinding,
  scriptBinding,
]);

export const resolvedRouteBinding = anyTestBinding.refine(
  (binding): binding is Extract<z.output<typeof anyTestBinding>, { status: "resolved" }> =>
    binding.status === "resolved",
  "Route variants require resolved bindings",
);
