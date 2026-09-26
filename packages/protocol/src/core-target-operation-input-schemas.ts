import * as z from "zod/v4";
import { identifier, queryBoolean, targetReference } from "./operation-schema-primitives.js";

export const executionTargetInputSchema = z.discriminatedUnion("kind", [
  z
    .object({
      schemaVersion: z.literal(1),
      kind: z.literal("local-device"),
      provider: z
        .object({ key: z.literal("relay.local.agent-device"), scope: z.literal("local") })
        .strict(),
      targetId: identifier("Target identifier"),
      platform: z.enum(["android", "ios"]),
      identity: z
        .object({ kind: z.literal("device-serial"), value: identifier("Device serial") })
        .strict(),
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(1),
      kind: z.literal("local-browser"),
      provider: z
        .object({ key: z.literal("relay.local.browser"), scope: z.literal("local") })
        .strict(),
      targetId: identifier("Target identifier"),
      platform: z.literal("browser"),
      identity: z
        .object({ kind: z.literal("browser-target"), value: identifier("Browser target") })
        .strict(),
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(1),
      kind: z.literal("provider-session"),
      provider: z.object({ key: identifier("Provider key"), scope: z.literal("remote") }).strict(),
      targetId: identifier("Target identifier"),
      platform: z.enum(["android", "ios"]),
      identity: z
        .object({ kind: z.literal("provider-session"), value: identifier("Provider session") })
        .strict(),
    })
    .strict(),
]);

/** Exact schemas for core target observations and the generic execution entry point. */
export const coreTargetOperationInputSchemas = {
  "target.snapshot.capture": z
    .object({
      serial: identifier("Connected device or managed target identifier").optional(),
      laneId: identifier("Saved Lane whose overlay the server applies").optional(),
      full: queryBoolean
        .optional()
        .describe("Return the full accessibility tree. Default is a digest."),
      interactiveOnly: queryBoolean
        .optional()
        .describe("Return only interactive controls for a compact live overlay."),
      visual: queryBoolean
        .optional()
        .describe(
          "Default true when the tree is missing: one PNG for visualFingerprint/proposedRows. Pass false to skip. Do not retry snapshot.",
        ),
    })
    .strict()
    .superRefine((input, context) => {
      if (!input.serial && !input.laneId) {
        context.addIssue({
          code: "custom",
          message: "serial or laneId is required",
          path: ["serial"],
        });
      }
    }),
  "target.screenshot.capture": z
    .object({
      serial: identifier("Connected device or managed target identifier").optional(),
      laneId: identifier("Saved Lane whose exact fixture overlay the pixels come from").optional(),
      previewX: z.coerce.number().optional(),
      previewY: z.coerce.number().optional(),
      caption: z.string().min(1).optional(),
      jobId: z.string().min(1).optional(),
      ephemeral: queryBoolean.optional(),
    })
    .strict()
    .superRefine((input, context) => {
      if (!input.serial && !input.laneId) {
        context.addIssue({
          code: "custom",
          message: "serial or laneId is required",
          path: ["serial"],
        });
      }
    }),
  "target.observation.capture": z.object(targetReference).strict(),
  "target.health.get": z.object(targetReference).strict(),
  "target.input.reconcile": z
    .object({
      ...targetReference,
      mutationId: identifier("Uncertain mutation identifier"),
      resolutionId: identifier("Idempotent reconciliation attempt identifier").optional(),
      outcome: z.enum(["applied", "not-applied", "ambiguous"]),
      reconcilePending: z.boolean().optional(),
    })
    .strict(),
  "target.input.receipt.get": z
    .object({
      ...targetReference,
      mutationId: identifier("Reconciled mutation identifier").optional(),
      resolutionId: identifier("Durable reconciliation receipt identifier").optional(),
    })
    .strict()
    .superRefine((value, context) => {
      if (!value.mutationId && !value.resolutionId) {
        context.addIssue({
          code: "custom",
          message: "Provide a resolutionId or mutationId.",
          path: ["resolutionId"],
        });
      }
    }),
  "target.recover": z
    .object({
      ...targetReference,
      force: z.boolean().optional(),
      reason: z.enum(["connect", "observe", "control", "record", "auto"]).optional(),
      recoveryFenceAssignmentId: identifier("Interrupted durable assignment identifier").optional(),
    })
    .strict(),
  "job.start": z
    .object({
      recipe: identifier("Private compiled Test or action identifier"),
      serial: z.string().optional(),
      executionTarget: executionTargetInputSchema.optional(),
    })
    .catchall(z.unknown()),
} as const satisfies Readonly<Record<string, z.ZodType>>;
