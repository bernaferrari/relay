import * as z from "zod/v4";

const id = z.string().min(1);
const at = z.number();

const appMapEntityShape = {
  id,
  organizationId: id,
  projectId: id,
  appMapId: id,
  createdAt: at,
  updatedAt: at,
} as const;
import { stepTargetSchema } from "../recipe/recipe-step-schema.js";

export const variableNavStepSchema = z.union([
  z
    .object({
      kind: z.literal("tap"),
      target: z
        .object({
          identifier: z.string().optional(),
          label: z.string().optional(),
          text: z.string().optional(),
        })
        .strict(),
      fallbackTargets: z
        .array(
          z
            .object({
              identifier: z.string().optional(),
              label: z.string().optional(),
              text: z.string().optional(),
            })
            .strict(),
        )
        .optional(),
    })
    .strict(),
  z.object({ kind: z.literal("back") }).strict(),
  z.object({ kind: z.literal("wait"), ms: z.number() }).strict(),
  z
    .object({
      kind: z.literal("scroll"),
      direction: z.enum(["up", "down"]),
      amount: z.number().optional(),
    })
    .strict(),
  z.object({ kind: z.literal("relaunch") }).strict(),
  z
    .object({
      kind: z.literal("openApp"),
      app: z.string(),
      relaunch: z.boolean().optional(),
    })
    .strict(),
]);

export const variableApplySchema = z.union([
  z.object({ kind: z.literal("input"), inputId: id }).strict(),
  z
    .object({
      kind: z.literal("list"),
      inConnectionId: id.optional(),
      outConnectionId: id.optional(),
      listScreenId: id.optional(),
      pickStepId: z.string().optional(),
      entryPath: z.array(variableNavStepSchema).optional(),
      pickerPath: z.array(variableNavStepSchema).optional(),
      exitPath: z.array(variableNavStepSchema).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("appLocale"),
      app: z.string(),
      relaunch: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("toggle"),
      target: stepTargetSchema,
      on: z.object({ identifier: z.string().optional(), label: z.string().optional() }).strict(),
      off: z.object({ identifier: z.string().optional(), label: z.string().optional() }).strict(),
    })
    .strict(),
]);

export const appMapVariableSchema = z
  .object({
    ...appMapEntityShape,
    name: z.string(),
    kind: z.enum([
      "language",
      "location",
      "account",
      "theme",
      "workspace",
      "build",
      "toggle",
      "custom",
    ]),
    apply: variableApplySchema,
    options: z.array(
      z
        .object({
          id,
          value: z.string().optional(),
          identifier: z.string().optional(),
          label: z.string().optional(),
          text: z.string().optional(),
        })
        .strict(),
    ),
    restoreId: id.optional(),
    screenshotEach: z.boolean().optional(),
  })
  .strict();
