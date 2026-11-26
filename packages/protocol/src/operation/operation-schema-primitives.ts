/**
 * Shared Zod building blocks for Relay operation input schemas.
 *
 * Operation and Test schemas both describe the same device vocabulary, so these
 * primitives live with the canonical operation descriptor rather than being
 * copied by individual transports.
 */
import * as z from "zod/v4";
import { browserDeviceInputResolutionSchema } from "../browser/browser-device.js";
import { recipeStepSchema } from "../recipe/recipe-step-schema.js";

export const text = (description: string) => z.string().min(1).describe(description);
export const natural = (description: string) => z.number().nonnegative().describe(description);
export const finiteNumericInput = z
  .union([z.number(), z.string().trim().min(1).transform(Number)])
  .pipe(z.number());
export const queryNumber = finiteNumericInput.pipe(z.number().int().positive());
export const explicitQueryBoolean = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .transform((value) => value === true || value === "true");
export const queryBoolean = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
  .transform((value) => value === true || value === "true" || value === "1");
export const identifier = (description: string) => text(description);
export const unknownRecord = z.record(z.string(), z.unknown());
export const empty = z.object({}).strict();
const coordinate = z.coerce.number();
export const tapPoint = z.object({ x: coordinate, y: coordinate }).strict();

export const targetReference = {
  serial: identifier("Connected device or managed target identifier"),
};

export const sessionReference = {
  sessionId: identifier("Authoring session identifier").refine(
    (value) => value.trim().length > 0,
    "Must not be blank",
  ),
};

export const authoringTarget = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("device"),
      platform: z.enum(["android", "ios"]),
      targetId: identifier("Connected device serial"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("browser"),
      platform: z.literal("browser"),
      targetId: identifier("Managed browser target identifier"),
      authenticationFixtureId: z.string().trim().min(1).max(256).optional(),
      liveSessionId: identifier("Prepared live browser session").optional(),
    })
    .strict(),
]);

export const pointAnchorTarget = z
  .object({
    identifier: z.string().min(1).optional(),
    ref: z.string().min(1).optional(),
    label: z.string().min(1).optional(),
    role: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
  })
  .strict()
  .refine(
    ({ identifier: targetId, ref, label, text: targetText }) =>
      Boolean(targetId || ref || label || targetText),
    "Element-relative point needs a semantic anchor",
  );

export const point = z
  .object({
    x: coordinate,
    y: coordinate,
    anchor: z
      .object({
        horizontal: z.enum(["left", "center", "right"]),
        vertical: z.enum(["top", "center", "bottom"]),
      })
      .strict()
      .optional(),
    referenceBounds: z
      .object({ width: z.number().positive(), height: z.number().positive() })
      .strict()
      .optional(),
    relativeTo: z
      .object({
        target: pointAnchorTarget,
        xRatio: z.number().min(0).max(1),
        yRatio: z.number().min(0).max(1),
      })
      .strict()
      .optional()
      .describe("Re-find an element and tap this fractional position inside its live bounds"),
  })
  .strict();

export const finiteInputPoint = point.extend({ x: finiteNumericInput, y: finiteNumericInput });

export const stepTarget = z
  .object({
    identifier: z.string().min(1).optional(),
    ref: z.string().min(1).optional(),
    label: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
    role: z.string().min(1).optional(),
    relation: z
      .object({
        kind: z.literal("following-row"),
        anchor: pointAnchorTarget,
      })
      .strict()
      .optional()
      .describe("Activate the unique actionable row immediately following a stable heading"),
    point: point.optional(),
  })
  .strict()
  .refine(
    ({ identifier, ref, label, text: targetText, relation, point: targetPoint }) =>
      Boolean(identifier || ref || label || targetText || relation || targetPoint),
    "Target needs an identifier, ref, label, text, semantic relation, or point",
  )
  .describe("Semantic selector, accessibility reference, or point");

export const authoringInteraction = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("tap"),
      target: stepTarget,
      expectedApp: z.string().optional(),
      applied: z.boolean().optional(),
      browserResolution: browserDeviceInputResolutionSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("type"),
      text: z.string().min(1),
      target: stepTarget.optional(),
      mode: z.enum(["append", "replace"]).optional(),
      applied: z.boolean().optional(),
    })
    .strict()
    .refine(({ mode, target }) => mode !== "replace" || target !== undefined, {
      path: ["target"],
      message: "Target is required in replace mode",
    }),
  z
    .object({
      kind: z.literal("clipboard"),
      action: z.enum(["write", "read", "paste", "copy"]),
      text: z.string().min(1).optional(),
      target: stepTarget.optional(),
      expect: z.string().min(1).optional(),
      match: z.enum(["exact", "contains"]).optional(),
      applied: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("app"),
      action: z.enum([
        "open",
        "close",
        "switcher",
        "inspect",
        "assert-installed",
        "assert-not-installed",
        "install",
        "update",
        "uninstall",
      ]),
      app: z.string().min(1).optional(),
      url: z.url().optional(),
      relaunch: z.boolean().optional(),
      artifact: z.string().min(1).optional(),
      as: z.string().min(1).optional(),
      version: z.string().min(1).optional(),
      versionMatch: z.enum(["exact", "contains"]).optional(),
      applied: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("device"),
      action: z.enum(["lock", "unlock", "keyboard-dismiss", "keyboard-enter"]),
      applied: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("rotate"),
      orientation: z.enum([
        "portrait",
        "portrait-upside-down",
        "landscape-left",
        "landscape-right",
      ]),
      applied: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("swipe"),
      from: point,
      to: point,
      durationMs: natural("Gesture duration in milliseconds").optional(),
      applied: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("key"),
      key: z.enum(["back", "home", "recents"]),
      applied: z.boolean().optional(),
    })
    .strict(),
  z.object({ kind: z.literal("wait"), ms: natural("Wait duration in milliseconds") }).strict(),
  z.object({ kind: z.literal("observe"), label: z.string().min(1).optional() }).strict(),
  z
    .object({
      kind: z.literal("screenshot"),
      label: z.string().min(1).optional(),
      fullPage: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("reusable"),
      recipeId: identifier("Reusable action identifier"),
      bindings: z.record(z.string(), z.string()).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("steps"),
      steps: z.array(recipeStepSchema),
      label: z.string().min(1).optional(),
      applied: z.boolean().optional(),
    })
    .strict(),
]);

export const authoringRecordingEdit = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("clip"),
      fromMs: natural("Clip start in milliseconds").optional(),
      toMs: natural("Clip end in milliseconds").optional(),
    })
    .strict()
    .refine(
      ({ fromMs, toMs }) => fromMs === undefined || toMs === undefined || fromMs <= toMs,
      "Clip start must not exceed clip end",
    ),
  z
    .object({
      kind: z.literal("restore"),
      sourceRevision: z.number().int().nonnegative().describe("Earlier Take revision to restore"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("remove"),
      actionIds: z.array(identifier("Authoring action identifier")).min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("reorder"),
      actionIds: z.array(identifier("Authoring action identifier")).min(1),
    })
    .strict(),
  z
    .object({
      kind: z.enum(["replace", "insert-before"]),
      actionId: identifier("Authoring action identifier"),
      interaction: authoringInteraction,
    })
    .strict(),
  z
    .object({
      kind: z.literal("merge"),
      actionIds: z.array(identifier("Authoring action identifier")).min(2),
      intent: z.string().trim().min(1).max(240).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("split"),
      actionId: identifier("Authoring action identifier"),
      atStep: z.number().int().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("rename"),
      actionId: identifier("Authoring action identifier"),
      intent: z.string().trim().min(1).max(240),
    })
    .strict(),
]);

export const destination = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("new-screen"), title: z.string().min(1).optional() }).strict(),
  z
    .object({ kind: z.literal("screen"), screenId: identifier("Destination screen identifier") })
    .strict(),
  z.object({ kind: z.literal("end") }).strict(),
]);

export const connectionDestination = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("screen"), screenId: identifier("Destination screen identifier") })
    .strict(),
  z.object({ kind: z.literal("end") }).strict(),
]);
