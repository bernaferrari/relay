import * as z from "zod/v4";
import { namedControlResolutionSchema } from "./interact-preview-selection.js";
import { targetReference } from "./operation-schema-primitives.js";

const point = z.object({ x: z.number(), y: z.number() }).strict();
const nonEmpty = z.string().min(1);

const composerTarget = z
  .object({
    identifier: nonEmpty.optional(),
    ref: nonEmpty.optional(),
    label: nonEmpty.optional(),
    text: nonEmpty.optional(),
    point: point.optional(),
  })
  .strict()
  .describe("Composer field; defaults to the focused editable field, else the lowest visible one");

const sendTarget = z
  .union([
    z.enum(["enter", "none"]),
    z.object({ identifier: nonEmpty.optional(), label: nonEmpty.optional() }).strict(),
  ])
  .describe('Send control; defaults to the nearest Send/Submit control, else "enter"');

const deviceDisplay = z.enum(["on", "asleep", "locked", "unknown"]);
const deviceConnectivity = z.enum(["online", "offline", "airplane", "unknown"]);

export const targetDeviceControlInputSchemas = {
  "target.prompt": z
    .object({
      ...targetReference,
      text: z.string().min(1).max(4_096).describe("Prompt to type and send"),
      composer: composerTarget.optional(),
      send: sendTarget.optional(),
      wait: z.boolean().optional().describe("Wait for the reply to settle (default true)"),
      timeoutMs: z.number().int().min(1_000).max(300_000).optional(),
      stableForMs: z.number().int().min(250).max(30_000).optional(),
    })
    .strict(),
  "target.network.set": z
    .object({
      ...targetReference,
      mode: z
        .enum(["airplane", "wifi-off", "data-off", "restore"])
        .describe("restore returns radios to their state before Relay's first change"),
    })
    .strict(),
  "target.display.set": z
    .object({
      ...targetReference,
      mode: z
        .enum(["wake", "keep-awake", "release"])
        .describe("keep-awake holds the screen on while plugged in; release restores the setting"),
    })
    .strict(),
} as const;

export const targetDeviceControlOutputSchemas = {
  "target.prompt": z
    .object({
      composer: namedControlResolutionSchema.optional(),
      sent: z.discriminatedUnion("method", [
        z
          .object({ method: z.literal("control"), label: z.string(), point: point.optional() })
          .strict(),
        z.object({ method: z.literal("enter") }).strict(),
        z.object({ method: z.literal("none") }).strict(),
      ]),
      reply: z
        .object({
          status: z.enum(["idle", "timeout", "not-waited"]),
          waitedMs: z.number().nonnegative(),
          samples: z.number().int().nonnegative(),
          newText: z.array(z.string()),
        })
        .strict(),
    })
    .strict(),
  "target.network.set": z
    .object({
      connectivity: deviceConnectivity,
      airplane: z.boolean(),
      wifi: z.boolean(),
      data: z.boolean(),
    })
    .strict(),
  "target.display.set": z.object({ display: deviceDisplay, stayAwake: z.boolean() }).strict(),
} as const;
