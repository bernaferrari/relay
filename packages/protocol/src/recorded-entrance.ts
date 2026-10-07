import { z } from "zod";

const text = z.string().min(1).max(512);
const time = z.number().finite().nonnegative();
const viewport = z
  .object({ width: z.number().int().positive(), height: z.number().int().positive() })
  .strict();
export const recordedEntranceProfileSchema = z
  .object({
    id: text,
    targetId: text,
    platform: z.literal("ios"),
    viewport,
    model: text.optional(),
    osVersion: text.optional(),
    capabilities: z.tuple([z.literal("snapshot"), z.literal("screenshot")]),
  })
  .strict();
export const recordedEntranceRequestSchema = z
  .object({
    identifiers: z.array(text).max(32),
    labels: z.array(text).max(32),
  })
  .strict();
const identity = {
  schemaVersion: z.literal(1),
  takeId: text,
  takeRevision: z.number().int().positive(),
  actionId: text,
  stepDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
};
/** Historical, incomplete selector availability. It never authorizes a native tap. */
export const recordedEntranceSchema = z.discriminatedUnion("status", [
  z.object({ ...identity, status: z.literal("unavailable") }).strict(),
  z
    .object({
      ...identity,
      status: z.literal("captured"),
      observationId: text,
      scope: z.literal("requested-selector-catalog"),
      targetId: text,
      profile: recordedEntranceProfileSchema,
      originApplication: text,
      actionStartedAt: time,
      actionFinishedAt: time,
      capturedAt: time,
      request: recordedEntranceRequestSchema,
      rawTree: z
        .object({
          id: text,
          uri: text,
          sha256: z.string().regex(/^[a-f0-9]{64}$/u),
          mime: z.literal("application/json"),
          bytes: z.number().int().positive(),
        })
        .strict(),
    })
    .strict(),
]);
export type RecordedEntrance = z.infer<typeof recordedEntranceSchema>;
export type RecordedEntranceProfile = z.infer<typeof recordedEntranceProfileSchema>;
export type RecordedEntranceRequest = z.infer<typeof recordedEntranceRequestSchema>;

/** Capture diagnostics retained with an observation so a later optimizer can
 * distinguish a real semantic tree from an unavailable, rebound, or
 * pixels-only capture without reconnecting the device. */
export type AuthoringCaptureContext = {
  snapshotSource?: "sdk" | "android-system" | "pixels-only";
  inspectable?: boolean;
  inspectionState?: "active" | "keyguard" | "asleep" | "unavailable" | "unknown";
  bindingState?: "matched" | "rebound" | "unavailable";
  treeApp?: string;
  visualFingerprint?: string;
  selectorEntrance?: {
    schemaVersion: 1;
    request: RecordedEntranceRequest;
    profile: RecordedEntranceProfile;
  };
};
