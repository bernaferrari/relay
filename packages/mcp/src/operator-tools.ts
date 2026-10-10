import * as z from "zod/v4";

type OperatorInputSchema = z.ZodType<Record<string, unknown>>;

export type RelayOperatorToolDescriptor = {
  readonly name: `relay_${string}`;
  readonly title: string;
  readonly description: string;
  readonly requiresConfirmation: boolean;
  readonly inputSchema: OperatorInputSchema;
  readonly annotations: {
    readonly readOnlyHint: boolean;
    readonly destructiveHint: boolean;
    readonly idempotentHint: boolean;
    readonly openWorldHint: false;
  };
};

const identifier = z.string().trim().min(1);
const point = z.object({ x: z.number(), y: z.number() }).strict();
/** Device or browser to drive; a saved sign-in picks its browser itself. */
const controlTargetFields = {
  targetId: identifier.optional().describe("Device or browser from relay_list_devices"),
  laneId: identifier.optional().describe("Saved browser sign-in to use instead of targetId"),
};
const ro = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false as const,
};
const rw = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false as const,
};

function verb(
  name: `relay_${string}`,
  title: string,
  description: string,
  inputSchema: OperatorInputSchema,
  annotations: RelayOperatorToolDescriptor["annotations"],
): RelayOperatorToolDescriptor {
  return Object.freeze({
    name,
    title,
    description,
    requiresConfirmation: false,
    inputSchema,
    annotations,
  });
}

function requireControlTarget(
  value: { targetId?: string; laneId?: string },
  context: z.RefinementCtx,
): void {
  if (!value.targetId && !value.laneId)
    context.addIssue({ code: "custom", message: "Provide targetId or laneId." });
  if (value.targetId && value.laneId)
    context.addIssue({ code: "custom", message: "Choose targetId or laneId, not both." });
}

const interactTarget = z
  .object({
    ...controlTargetFields,
    identifier: identifier.optional(),
    label: identifier.optional(),
    text: z.string().min(1).optional(),
    x: z.number().optional(),
    y: z.number().optional(),
  })
  .strict()
  .superRefine(requireControlTarget);

function requireTapTarget(
  value: {
    identifier?: string;
    label?: string;
    text?: string;
    x?: number;
    y?: number;
    from?: { x: number; y: number };
    to?: { y: number; x: number };
  },
  context: z.RefinementCtx,
  swipe = false,
): void {
  if (swipe && value.from && value.to) return;
  if (value.identifier || value.label || value.text) return;
  if (typeof value.x === "number" && typeof value.y === "number") return;
  context.addIssue({
    code: "custom",
    message: swipe
      ? "Provide from and to, or identifier/label/text/x+y"
      : "Provide identifier, label, text, or x and y",
  });
}

export const relayOperatorTools = Object.freeze([
  verb(
    "relay_screenshot",
    "Take a screenshot",
    "Capture the current screen of a device or browser as an image. Take one before and after each tap.",
    z
      .object({
        ...controlTargetFields,
        previewX: z.number().optional().describe("Mark this point on the image"),
        previewY: z.number().optional(),
      })
      .strict()
      .superRefine(requireControlTarget),
    ro,
  ),
  verb(
    "relay_preview",
    "Preview a tap or swipe",
    "Show where a tap or swipe would land, marked on a screenshot, without doing it.",
    interactTarget
      .safeExtend({ from: point.optional(), to: point.optional() })
      .superRefine((value, context) => requireTapTarget(value, context, true)),
    ro,
  ),
  verb(
    "relay_tap",
    "Tap",
    "Tap one control, found by identifier, label, visible text or x/y point (in that order of preference).",
    interactTarget.superRefine((value, context) => requireTapTarget(value, context)),
    rw,
  ),
  verb(
    "relay_type",
    "Type text",
    "Type text into the focused field, or into the field with this identifier or label.",
    z
      .object({
        ...controlTargetFields,
        text: z.string(),
        identifier: identifier.optional(),
        label: identifier.optional(),
      })
      .strict()
      .superRefine(requireControlTarget),
    rw,
  ),
  verb(
    "relay_swipe",
    "Swipe",
    "Swipe from one point to another to scroll or dismiss.",
    z
      .object({
        ...controlTargetFields,
        from: point,
        to: point,
        durationMs: z.number().int().positive().optional(),
      })
      .strict()
      .superRefine(requireControlTarget),
    rw,
  ),
  verb(
    "relay_press_key",
    "Press a key",
    "Press a system key: back, home, recents, enter or backspace.",
    z
      .object({
        ...controlTargetFields,
        key: z.enum(["back", "home", "recents", "enter", "backspace"]),
      })
      .strict()
      .superRefine(requireControlTarget),
    rw,
  ),
  verb(
    "relay_launch_app",
    "Launch an app",
    "Open an app on a phone or emulator by name, package or bundle id. Set relaunch to start it fresh.",
    z
      .object({
        targetId: identifier,
        app: identifier.describe("App name, package or bundle id"),
        relaunch: z.boolean().optional(),
      })
      .strict(),
    rw,
  ),
  verb(
    "relay_recover",
    "Reconnect a device",
    "Reconnect Relay to a device that stopped responding, without restarting it. Use it only when taps or screenshots fail.",
    z.object(controlTargetFields).strict().superRefine(requireControlTarget),
    rw,
  ),
] as const satisfies readonly RelayOperatorToolDescriptor[]);

export const relayOperatorToolNames = relayOperatorTools.map(({ name }) => name);
