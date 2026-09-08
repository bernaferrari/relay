import * as z from "zod/v4";
import { empty, identifier, text } from "./operation-schema-primitives.js";

const targetSelector = z
  .object({
    platform: z.enum(["android", "ios", "browser"]).optional(),
    osVersion: z.string().optional(),
    deviceKind: z.string().optional(),
    tags: z.array(z.string()).optional(),
  })
  .catchall(z.unknown());

const presenceCursor = z.object({ x: z.number(), y: z.number() }).strict();
const presenceViewport = z
  .object({
    x: z.number(),
    y: z.number(),
    zoom: z.number().positive(),
    width: z.number().nonnegative(),
    height: z.number().nonnegative(),
  })
  .strict();

/** System, collaboration, project, build, and scheduling descriptors. */
export const workspaceOperationSchemas = {
  "system.audit.list": z.object({ limit: z.number().int().positive().optional() }).strict(),
  "system.health.get": empty,
  "event.stream": empty,
  "activity.list": z
    .object({
      limit: z.number().int().min(1).max(500).optional(),
      cursor: identifier("Opaque activity cursor").optional(),
    })
    .strict(),
  "activity.export": empty,
  "workspace.privacy.get": empty,
  "workspace.privacy.update": z.object({ enabled: z.boolean() }).strict(),
  "workspace.evidence.get": empty,
  "workspace.evidence.update": z
    .object({
      channel: z.enum(["audio", "crash", "network-body", "network-raw", "browser-trace"]),
      enabled: z.boolean(),
      reason: z.string().optional(),
    })
    .strict(),
  "workspace.change.inspect": z
    .object({ baseRef: z.string().trim().min(1).max(512).optional() })
    .strict(),
  "workspace.variables.get": empty,
  "workspace.apple-device.update": z
    .object({
      teamId: identifier("Apple developer Team ID"),
      bundleId: identifier("XCTest runner bundle identifier"),
      signingIdentity: z.string().optional(),
      provisioningProfile: z.string().optional(),
    })
    .strict(),
  "workspace.apple-live-preview.update": z
    .object({ backend: z.enum(["agent-device-png", "go-ios-auto", "go-ios-mjpeg"]) })
    .strict(),
  "presence.list": empty,
  "presence.upsert": z
    .object({
      actorId: identifier("Actor identifier").optional(),
      actorKind: z.enum(["human", "agent", "system"]).optional(),
      activity: z.enum(["editing", "recording", "running", "idle"]).optional(),
      displayName: z.string().optional(),
      cursor: presenceCursor.optional(),
      selection: z
        .object({ screenId: z.string().optional(), connectionId: z.string().optional() })
        .strict()
        .optional(),
      viewport: presenceViewport.optional(),
      ttlMs: z.number().int().positive().optional(),
    })
    .strict(),
  "presence.clear": z.object({ actorId: identifier("Actor identifier") }).strict(),
  "project.list": empty,
  "build.list": empty,
  "build.preflight": z
    .object({ buildId: identifier("Build identifier"), serial: z.string().optional() })
    .strict(),
  "build.install": z
    .object({
      buildId: identifier("Build identifier"),
      serial: identifier("Connected device serial"),
      launch: z.boolean().optional(),
      applicationId: z.string().optional(),
    })
    .strict(),
  "build.launch": z
    .object({
      buildId: identifier("Build identifier"),
      serial: identifier("Connected device serial"),
      applicationId: z.string().optional(),
    })
    .strict(),
  "device-pool.list": empty,
  "device-pool.preflight": z.object({ poolId: identifier("Device-pool identifier") }).strict(),
  "target-worker.list": empty,
  "target.actions.list": empty,
  "target.app.locales": z
    .object({
      serial: identifier("Connected device serial"),
      package: identifier("Application package identifier"),
    })
    .strict(),
  "target.app.list": z.object({ serial: identifier("Target serial") }).strict(),
  "target.app.locale.set": z
    .object({
      serial: identifier("Connected device serial"),
      package: identifier("Application package identifier"),
      locale: identifier("BCP-47 language tag, such as de, he, or pt-BR"),
    })
    .strict(),
  "target.scroll-survey.capture": z
    .object({
      serial: identifier("Connected device serial"),
      maxScrolls: z.number().int().min(1).max(12).optional(),
      restore: z.boolean().optional(),
      dir: text("Folder for sibling 00.png / 00.json frames and full.png").optional(),
      force: z.boolean().optional().describe("Overwrite a non-empty survey directory"),
    })
    .strict(),

  "target.stream.open": z
    .object({
      serial: identifier("Connected device serial"),
      fps: z.number().int().min(1).max(60).optional(),
      quality: z.number().int().min(1).max(100).optional(),
    })
    .strict(),
  "schedule.list": empty,
  "schedule.create": z
    .object({
      id: identifier("Schedule identifier").optional(),
      recipeId: identifier("Compiled execution-plan identifier"),
      targetKind: z.enum(["device", "browser"]),
      targetId: identifier("Exact target identifier"),
      platform: z.enum(["android", "ios", "browser"]),
      intervalMinutes: z.number().int().min(1).max(43_200),
      repetitions: z.number().int().min(1).max(20).optional(),
      enabled: z.boolean().optional(),
    })
    .strict(),
  "matrix.list": empty,
  "matrix.create": z
    .object({
      id: identifier("Compatibility matrix identifier"),
      name: text("Compatibility matrix name"),
      selectors: z.array(targetSelector),
    })
    .strict(),
  "matrix.update": z
    .object({
      matrixId: identifier("Compatibility matrix identifier"),
      name: z.string().optional(),
      selectors: z.array(targetSelector).optional(),
    })
    .strict(),
  "matrix.import": z
    .object({
      yaml: text("Compatibility matrix YAML"),
      conflict: z.enum(["reject", "replace"]).optional(),
    })
    .strict(),
} as const satisfies Readonly<Record<string, z.ZodObject>>;
