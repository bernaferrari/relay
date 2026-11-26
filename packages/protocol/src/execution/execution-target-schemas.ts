import * as z from "zod/v4";
import { browserCaseProfileSchema } from "../browser/browser-case-profile.js";

export const targetCapabilitySchema = z.enum([
  "snapshot",
  "screenshot",
  "stream",
  "recording",
  "tap",
  "type",
  "scroll",
  "clipboard",
  "network",
  "logs",
  "permissions",
  "location",
  "rotation",
  "lock-screen",
  "app-switcher",
  "install",
  "launch",
]);
export const targetProfileSchema = z
  .object({
    id: z.string(),
    targetId: z.string(),
    source: z.enum(["device", "browser"]),
    platform: z.enum(["android", "ios", "browser"]),
    name: z.string(),
    model: z.string().optional(),
    androidAvdName: z.string().optional(),
    osVersion: z.string().optional(),
    viewport: z.object({ width: z.number(), height: z.number() }).strict().optional(),
    browserCaseProfile: browserCaseProfileSchema.optional(),
    capabilities: z.array(targetCapabilitySchema),
    observedAt: z.number(),
  })
  .strict();

const localDeviceExecutionTargetShape = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("local-device"),
    provider: z
      .object({ key: z.literal("relay.local.agent-device"), scope: z.literal("local") })
      .strict(),
    targetId: z.string(),
    platform: z.enum(["android", "ios"]),
    identity: z.object({ kind: z.literal("device-serial"), value: z.string() }).strict(),
  })
  .strict();

export const localAgentDeviceAdmissionTargetSchema = localDeviceExecutionTargetShape
  .safeExtend({
    targetId: z
      .string()
      .refine((value) => value.trim().length > 0, "Target identifier must not be blank"),
    identity: z
      .object({
        kind: z.literal("device-serial"),
        value: z
          .string()
          .refine((value) => value.trim().length > 0, "Target identity must not be blank"),
      })
      .strict(),
  })
  .refine(({ targetId, identity }) => targetId === identity.value, {
    path: ["identity", "value"],
    message: "Target identifier must match the device serial",
  });

export const executionTargetSchema = z.discriminatedUnion("kind", [
  localDeviceExecutionTargetShape,
  z
    .object({
      schemaVersion: z.literal(1),
      kind: z.literal("local-browser"),
      provider: z
        .object({ key: z.literal("relay.local.browser"), scope: z.literal("local") })
        .strict(),
      targetId: z.string(),
      platform: z.literal("browser"),
      identity: z.object({ kind: z.literal("browser-target"), value: z.string() }).strict(),
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(1),
      kind: z.literal("provider-session"),
      provider: z.object({ key: z.string(), scope: z.literal("remote") }).strict(),
      targetId: z.string(),
      platform: z.enum(["android", "ios"]),
      identity: z.object({ kind: z.literal("provider-session"), value: z.string() }).strict(),
    })
    .strict(),
]);

/** Full jobs intentionally evolve with evidence collectors and runner payloads. */
export const executionJobSchema = z
  .object({
    id: z.string(),
    workflowId: z.string().optional(),
    action: z.string(),
    status: z.string(),
    queuedAt: z.number(),
    startedAt: z.number().optional(),
    finishedAt: z.number().optional(),
    error: z.string().optional(),
    batchId: z.string().optional(),
  })
  .passthrough();

export const actorSchema = z
  .object({ id: z.string(), kind: z.enum(["human", "agent", "system"]) })
  .strict();
export const runReviewSchema = z
  .object({
    schemaVersion: z.literal(1),
    status: z.enum(["pending", "approved", "rejected"]),
    capability: z.string(),
    reason: z.string(),
    requestedAt: z.number(),
    requestedBy: actorSchema.optional(),
    decidedAt: z.number().optional(),
    decidedBy: actorSchema.optional(),
    note: z.string().optional(),
  })
  .strict();
