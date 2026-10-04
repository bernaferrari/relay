import * as z from "zod/v4";
import { browserEnvironmentInputSchema, browserViewportSchema } from "./browser-case-profile.js";
import {
  browserDeviceControlInputSchema,
  browserDeviceFrameInputSchema,
  browserDeviceInspectInputSchema,
  browserDeviceOpenInputSchema,
} from "./browser-device.js";
import { browserAuthenticationFixtureReferenceSchema } from "./browser-authentication-fixture.js";
import {
  empty,
  identifier,
  tapPoint,
  targetReference,
  text,
} from "./operation-schema-primitives.js";

export const targetOperationInputSchemas = {
  "target.create": z
    .object({
      id: identifier("Optional stable target identifier").optional(),
      name: text("Human-readable target name"),
      startUrl: z.url(),
      headless: z.boolean().optional(),
      viewport: browserViewportSchema.optional(),
      environment: browserEnvironmentInputSchema.optional(),
      profileRetention: z.enum(["retain", "ephemeral"]).optional(),
    })
    .strict(),
  "target.delete": z.object({ targetId: identifier("Managed target identifier") }).strict(),
  "target.preflight": z.object({ targetId: identifier("Managed target identifier") }).strict(),
  "target.open": z
    .object({
      targetId: identifier("Managed browser target identifier"),
      laneId: identifier("Saved Lane whose cookie jar this tab uses").optional(),
      authenticationFixtureReference: browserAuthenticationFixtureReferenceSchema.optional(),
      signedOut: z.literal(true).optional(),
      presentation: z.enum(["embedded", "external"]).optional(),
    })
    .strict()
    .superRefine((value, context) => {
      if (value.authenticationFixtureReference && value.signedOut) {
        context.addIssue({
          code: "custom",
          message: "Choose an account fixture or attested signed-out, not both.",
          path: ["signedOut"],
        });
      }
    }),
  "target.browser-device.open": browserDeviceOpenInputSchema,
  "target.browser-device.frame": browserDeviceFrameInputSchema,
  "target.browser-device.frame-binary": browserDeviceFrameInputSchema,
  "target.browser-device.inspect": browserDeviceInspectInputSchema,
  "target.browser-device.control": browserDeviceControlInputSchema,
  "system.doctor.get": empty,
  "target.list": empty,
  "target.devices.list": z
    .object({
      phase: z
        .enum(["android", "ios"])
        .optional()
        .describe("Optional platform filter. Omit to list iOS, Android, and browsers."),
      targetKind: z
        .enum(["device", "browser"])
        .optional()
        .describe("Explicit target kind. Browser inventory does not scan physical hardware."),
      targetId: identifier("Exact target identifier to list").optional(),
    })
    .strict(),
  "target.avds.list": empty,
  "target.avd.boot": z
    .object({
      avdName: identifier("Exact configured Android AVD name"),
      timeoutMs: z.number().int().min(1_000).max(300_000).optional(),
      headless: z.boolean().optional(),
    })
    .strict(),
  "target.boot": z.object(targetReference).strict(),
  "target.authorize": z.object(targetReference).strict(),
  "lease.list": z.object({ status: z.enum(["active", "all"]).optional() }).strict(),
  "target.app.launch": z
    .object({
      ...targetReference,
      app: text("App name, package, or bundle identifier"),
      relaunch: z.boolean().optional(),
    })
    .strict(),
  "target.interact": z
    .object({
      serial: identifier("Connected device or managed target identifier").optional(),
      laneId: identifier("Saved Lane whose overlay the server applies").optional(),
      kind: z.enum([
        "label",
        "identifier",
        "point",
        "ref",
        "find",
        "text-match",
        "swipe",
        "type",
        "key",
        "replace",
      ]),
      preview: z.boolean().optional().describe("If true, resolve or annotate only — no commit tap"),
      identifier: z
        .string()
        .min(1)
        .optional()
        .describe("Required when kind is 'identifier': accessibility identifier to tap"),
      label: z
        .string()
        .min(1)
        .optional()
        .describe("Required when kind is 'label': accessibility label to tap"),
      heading: z
        .string()
        .min(1)
        .optional()
        .describe(
          "Unique nearby heading that scopes an otherwise ambiguous label (Build Mode vs Finance Dismiss)",
        ),
      match: z
        .string()
        .min(1)
        .optional()
        .describe("Required when kind is 'text-match': visible text to match and tap"),
      text: z
        .string()
        .optional()
        .describe(
          "Required when kind is 'type' or 'replace': text to type (type) or replace the target's content with (replace)",
        ),
      x: z
        .number()
        .optional()
        .describe("Required when kind is 'point': x coordinate in captured viewport pixels"),
      y: z
        .number()
        .optional()
        .describe("Required when kind is 'point': y coordinate in captured viewport pixels"),
      from: tapPoint
        .optional()
        .describe("Required when kind is 'swipe': swipe start point { x, y }"),
      to: tapPoint.optional().describe("Required when kind is 'swipe': swipe end point { x, y }"),
      durationMs: z.number().int().positive().optional(),
      ref: z.string().min(1).optional(),
      point: tapPoint
        .optional()
        .describe(
          "Optional observed center for kind 'label'/'identifier': disambiguates duplicate labels by matching the observed control's bounds",
        ),
      query: z.string().min(1).optional(),
      key: z
        .enum(["enter", "backspace", "back", "home", "recents"])
        .optional()
        .describe("Required when kind is 'key': which system key to send"),
      target: z
        .object({
          identifier: z.string().min(1).optional(),
          ref: z.string().min(1).optional(),
          label: z.string().min(1).optional(),
          text: z.string().min(1).optional(),
          point: tapPoint.optional(),
        })
        .strict()
        .optional(),
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
  "target.ground": z
    .object({
      ...targetReference,
      target: z
        .union([
          text("Accessibility label, identifier, or natural-language control name"),
          z
            .object({
              kind: z.enum([
                "label",
                "identifier",
                "point",
                "ref",
                "find",
                "text-match",
                "swipe",
                "type",
                "key",
                "replace",
              ]),
            })
            .catchall(z.unknown()),
        ])
        .describe("Text to resolve, or a full InteractInput to passthrough"),
      screenshot: z
        .object({
          base64: text("PNG/JPEG base64 screenshot for vision fallback"),
          mime: z.string().optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
  "target.do": z
    .object({
      ...targetReference,
      target: z
        .union([
          text("Accessibility label, identifier, or natural-language control name"),
          z
            .object({
              kind: z.enum([
                "label",
                "identifier",
                "point",
                "ref",
                "find",
                "text-match",
                "swipe",
                "type",
                "key",
                "replace",
              ]),
            })
            .catchall(z.unknown()),
        ])
        .describe("Text to ground then tap, or a full InteractInput"),
    })
    .strict(),
  "target.ui.describe": z.object(targetReference).strict(),
  "target.ui.back": z
    .object({
      ...targetReference,
      parentTitles: z.array(z.string()).optional(),
    })
    .strict(),
  "target.ui.scrollCollect": z
    .object({
      ...targetReference,
      maxScrolls: z.number().int().min(0).max(8).optional(),
      allowSensitive: z.boolean().optional(),
    })
    .strict(),
  "target.touch": z
    .object({
      ...targetReference,
      action: z.enum(["down", "move", "up", "cancel"]),
      x: z.number(),
      y: z.number(),
    })
    .strict(),
  "target.key": z
    .object({
      ...targetReference,
      kind: z.enum(["text", "key"]),
      text: z.string().optional(),
      key: z.enum(["enter", "backspace"]).optional(),
    })
    .strict(),
  "target.scroll": z
    .object({
      ...targetReference,
      x: z.number(),
      y: z.number(),
      scrollX: z.number(),
      scrollY: z.number(),
    })
    .strict(),
  "target.video.start": z
    .object({ ...targetReference, action: z.enum(["start", "stop"]) })
    .strict(),
} as const;
