import * as z from "zod/v4";
import { testCapturePolicy } from "./app-map-test-operation-schemas.js";
import { combineAccountBindingSchema } from "./combine-profile-target-schema.js";
import { identifier } from "./operation-schema-primitives.js";

/** Who and where a Test, Plan, or preview should run. Account credentials stay
 * in the fixture; a Lane only names the overlay. */
export const laneTargetSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("browser"),
      browserTargetId: identifier("Managed browser target identifier"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("device"),
      serial: identifier("Connected device serial"),
      platform: z.enum(["android", "ios"]),
    })
    .strict(),
]);

export const laneAccountSchema = combineAccountBindingSchema;

const laneFields = {
  id: identifier("Lane identifier"),
  appMapId: identifier("App Map identifier"),
  target: laneTargetSchema,
  targetProfileId: identifier("Saved runtime profile identifier").optional(),
  engine: z.enum(["chromium", "firefox", "webkit"]).optional(),
  account: combineAccountBindingSchema.optional(),
  actorId: identifier("Actor that owns runs on this Lane").optional(),
  capture: testCapturePolicy.optional(),
} as const;

function refineLaneEngineAccount(
  input: {
    target: { kind: string };
    engine?: unknown;
    account?: unknown;
  },
  context: z.RefinementCtx,
): void {
  if (input.target.kind === "device") {
    if (input.engine !== undefined) {
      context.addIssue({
        code: "custom",
        message: "engine only applies to browser Lanes",
        path: ["engine"],
      });
    }
    if (input.account !== undefined) {
      context.addIssue({
        code: "custom",
        message: "account only applies to browser Lanes",
        path: ["account"],
      });
    }
    return;
  }
  if (input.engine && !input.account) {
    context.addIssue({
      code: "custom",
      message: "A paired engine requires an account fixture or attested signed-out state",
      path: ["account"],
    });
  }
  if (input.account && !input.engine) {
    context.addIssue({
      code: "custom",
      message: "A paired account requires a browser engine",
      path: ["engine"],
    });
  }
}

/** Body of `lane.save`. Project and timestamps are server-owned. */
export const laneSaveInputSchema = z
  .object(laneFields)
  .strict()
  .superRefine(refineLaneEngineAccount);

export const laneSchema = z
  .object({
    ...laneFields,
    projectId: identifier("Project identifier"),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine(refineLaneEngineAccount);

export type LaneTarget = z.infer<typeof laneTargetSchema>;
export type LaneAccount = z.infer<typeof laneAccountSchema>;
export type LaneSaveInput = z.infer<typeof laneSaveInputSchema>;
export type Lane = z.infer<typeof laneSchema>;
