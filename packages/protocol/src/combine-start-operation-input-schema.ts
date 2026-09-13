import * as z from "zod/v4";
import { sourceRevisionSchema, testCapturePolicy } from "./app-map-test-operation-schemas.js";
import { combineProfileTargetInputSchema } from "./combine-profile-target-schema.js";
import { executionTargetInputSchema } from "./core-target-operation-input-schemas.js";
import { identifier, unknownRecord } from "./operation-schema-primitives.js";

export const combineStartOperationInputSchemas = {
  "job.combine.start": z
    .object({
      appMapId: identifier("App Map identifier"),
      testId: identifier("Test identifier to run once").optional(),
      combineId: identifier("Saved Combine identifier").optional(),
      variableIds: z.array(identifier("Variable identifier")).optional(),
      selected: z.record(z.string(), z.array(z.string())).optional(),
      strategy: z.enum(["zip", "cartesian", "pairwise"]).optional(),
      serial: identifier("Connected device serial").optional(),
      platform: z.enum(["android", "ios"]).optional(),
      targetKind: z.enum(["device", "browser"]).optional(),
      browserTargetId: identifier("Managed browser target identifier").optional(),
      title: z.string().optional(),
      seed: z.number().int().optional(),
      capture: testCapturePolicy.optional(),
      executionMode: z.enum(["pilot", "all"]).optional(),
      sourceRevision: sourceRevisionSchema.optional(),
      pilotCaseIndex: z.number().int().nonnegative().optional(),
      selectedCellIds: z.array(identifier("Combine cell identifier")).optional(),
      cell: identifier("World or Combine cell selector").optional(),
      cellRuntimeProfiles: z
        .array(
          z
            .object({
              testId: identifier("Test identifier"),
              values: z.record(z.string(), z.string()),
              targetProfileId: identifier("Saved runtime profile identifier"),
            })
            .strict(),
        )
        .optional(),
      cellTargetBindings: z
        .array(
          z
            .object({
              testId: identifier("Test identifier"),
              values: z.record(z.string(), z.string()),
              target: executionTargetInputSchema,
            })
            .strict(),
        )
        .optional(),
      localAdmission: z
        .object({
          deadlineMs: z.number().nonnegative(),
          durationEvidence: z.array(unknownRecord),
          setupHeadroomMs: z.number().nonnegative().optional(),
          recoveryHeadroomMs: z.number().nonnegative().optional(),
        })
        .strict()
        .optional(),
      surfaceCapture: z
        .object({ forceRecaptureScreenIds: z.array(identifier("Screen identifier")) })
        .strict()
        .optional(),
      defaultTargetProfileId: identifier("Default target profile identifier").optional(),
      profileTargets: z.array(combineProfileTargetInputSchema).max(64).optional(),
    })
    .strict()
    .superRefine((input, context) => {
      if (!input.testId && !input.combineId) {
        context.addIssue({
          code: "custom",
          message: "Choose exactly one testId or combineId",
          path: ["testId"],
        });
      }
      if ([input.testId, input.combineId].filter(Boolean).length > 1) {
        context.addIssue({
          code: "custom",
          message: "Choose only one testId or combineId",
          path: ["testId"],
        });
      }
      if (
        !input.serial &&
        !input.browserTargetId &&
        !input.cellTargetBindings?.length &&
        !input.profileTargets?.length
      ) {
        context.addIssue({
          code: "custom",
          message: "Choose serial, browserTargetId, or explicit cell target bindings",
          path: ["serial"],
        });
      }
      if (input.serial && input.browserTargetId) {
        context.addIssue({
          code: "custom",
          message: "Choose only one serial or browserTargetId",
          path: ["serial"],
        });
      }
      if (input.serial && input.targetKind === "browser") {
        context.addIssue({
          code: "custom",
          message: "A serial target must use targetKind device",
          path: ["targetKind"],
        });
      }
      if (input.browserTargetId && input.targetKind === "device") {
        context.addIssue({
          code: "custom",
          message: "A browserTargetId must use targetKind browser",
          path: ["targetKind"],
        });
      }
      input.profileTargets?.forEach((item, index) => {
        if (item.engine && !item.account) {
          context.addIssue({
            code: "custom",
            message: "A paired engine requires an account fixture or attested signed-out state",
            path: ["profileTargets", index, "account"],
          });
        }
        if (item.account && !item.engine) {
          context.addIssue({
            code: "custom",
            message: "A paired account requires a browser engine",
            path: ["profileTargets", index, "engine"],
          });
        }
      });
    }),
} as const;
