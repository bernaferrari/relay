import * as z from "zod/v4";

/**
 * Browser actuation steps the plain-English act loop can emit and authors can
 * write directly. They live in a sibling module because recipe-step-schema.ts
 * is at its source budget; the union there spreads these in. Every shape is a
 * browser-only physical interaction: native targets reject them at the
 * platform gate rather than silently no-oping.
 */

/** Bounded keyboard keys a recipe may press. Letter keys exist for shortcut
 * chords only; literal text entry belongs to `type` steps. */
export const pressKeyNameSchema = z.enum([
  "escape",
  "tab",
  "enter",
  "backspace",
  "delete",
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
  "home",
  "end",
  "pageup",
  "pagedown",
  "a",
  "c",
  "k",
  "v",
  "x",
  "z",
]);

/** `controlOrMeta` keeps an authored shortcut honest across host platforms:
 * the browser resolves it against the machine the page actually runs on. */
export const pressKeyModifierSchema = z.enum(["control", "meta", "shift", "alt", "controlOrMeta"]);

export function createActuationStepSchemas<StepTarget extends z.ZodTypeAny>(
  metadataShape: Record<string, z.ZodTypeAny>,
  stepTargetSchema: StepTarget,
) {
  const hoverStepSchema = z
    .object({
      ...metadataShape,
      kind: z.literal("hover"),
      target: stepTargetSchema,
    })
    .strict();
  const selectStepSchema = z
    .object({
      ...metadataShape,
      kind: z.literal("select"),
      target: stepTargetSchema,
      /** Visible option text of a native HTML select. */
      option: z.string().min(1),
    })
    .strict();
  const pressKeyStepSchema = z
    .object({
      ...metadataShape,
      kind: z.literal("press-key"),
      key: pressKeyNameSchema,
      modifiers: z.array(pressKeyModifierSchema).max(3).optional(),
    })
    .strict();
  return { hoverStepSchema, selectStepSchema, pressKeyStepSchema };
}
