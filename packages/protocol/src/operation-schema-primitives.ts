/**
 * Shared Zod building blocks for Relay operation input schemas.
 *
 * Operation and Test schemas both describe the same device vocabulary, so these
 * primitives live with the canonical operation descriptor rather than being
 * copied by individual transports.
 */
import * as z from "zod/v4";

export const text = (description: string) => z.string().min(1).describe(description);
export const natural = (description: string) => z.number().nonnegative().describe(description);
export const identifier = (description: string) => text(description);
export const unknownRecord = z.record(z.string(), z.unknown());
export const empty = z.object({}).strict();
export const open = z.object({}).catchall(z.unknown());
const coordinate = z.coerce.number();
export const tapPoint = z.object({ x: coordinate, y: coordinate }).strict();

export const targetReference = {
  serial: identifier("Connected device or managed target identifier"),
};

export const sessionReference = {
  sessionId: identifier("Authoring session identifier"),
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

export const stepTarget = z
  .object({
    identifier: z.string().min(1).optional(),
    ref: z.string().min(1).optional(),
    label: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
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
    .object({ kind: z.literal("tap"), target: stepTarget, applied: z.boolean().optional() })
    .strict(),
  z
    .object({
      kind: z.literal("type"),
      text: z.string(),
      target: stepTarget.optional(),
      mode: z.enum(["append", "replace"]).optional(),
      applied: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("clipboard"),
      action: z.enum(["write", "read", "paste", "copy"]),
      text: z.string().optional(),
      target: stepTarget.optional(),
      expect: z.string().optional(),
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
      app: z.string().optional(),
      url: z.url().optional(),
      relaunch: z.boolean().optional(),
      artifact: z.string().optional(),
      as: z.string().optional(),
      version: z.string().optional(),
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
      key: z.enum(["back", "home"]),
      applied: z.boolean().optional(),
    })
    .strict(),
  z.object({ kind: z.literal("wait"), ms: natural("Wait duration in milliseconds") }).strict(),
  z.object({ kind: z.literal("observe"), label: z.string().optional() }).strict(),
  z.object({ kind: z.literal("screenshot"), label: z.string().optional() }).strict(),
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
      steps: z.array(unknownRecord),
      label: z.string().optional(),
    })
    .strict(),
]);

export const destination = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("new-screen"), title: z.string().optional() }).strict(),
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
