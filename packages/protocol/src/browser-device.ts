import * as z from "zod/v4";
import { browserCaseProfileSchema, browserEnvironmentInputSchema } from "./browser-case-profile.js";

const id = z.string().trim().min(1).max(256);
const natural = z.number().int().nonnegative();

export const browserDevicePageSchema = z
  .object({
    id,
    kind: z.enum(["page", "popup"]),
    title: z.string().max(512),
    url: z.string().max(4_096),
    active: z.boolean(),
    closed: z.boolean(),
  })
  .strict();

export const browserDeviceSessionSchema = z
  .object({
    schemaVersion: z.literal(1),
    sessionId: id,
    targetId: id,
    status: z.enum(["starting", "streaming", "degraded", "crashed", "closed"]),
    ownership: z.enum(["controlled", "available", "occupied"]),
    sequence: natural,
    activePageId: id,
    pages: z.array(browserDevicePageSchema),
    profile: browserCaseProfileSchema,
    startedAt: natural,
    frameCapturedAt: natural.optional(),
    issue: z.string().trim().min(1).max(480).optional(),
  })
  .strict();

export const browserDeviceFrameSchema = z
  .object({
    sessionId: id,
    sequence: natural,
    pageId: id,
    pageUrl: z.string().max(4_096),
    visualFingerprint: id,
    capturedAt: natural,
    mime: z.literal("image/jpeg"),
    base64: z.string().max(24 * 1024 * 1024),
    bytes: natural,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();

const frameBound = {
  sessionId: id,
  pageId: id,
  expectedSequence: natural,
} as const;

export const browserDeviceInputSchema = z.discriminatedUnion("kind", [
  z.object({ ...frameBound, kind: z.literal("click"), x: z.number(), y: z.number() }).strict(),
  z
    .object({
      ...frameBound,
      kind: z.literal("wheel"),
      x: z.number(),
      y: z.number(),
      deltaX: z.number(),
      deltaY: z.number(),
    })
    .strict(),
  z.object({ ...frameBound, kind: z.literal("text"), text: z.string().max(16_384) }).strict(),
  z
    .object({
      ...frameBound,
      kind: z.literal("key"),
      key: z.enum([
        "Enter",
        "Backspace",
        "Escape",
        "Tab",
        "Delete",
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
        "PageUp",
        "PageDown",
      ]),
    })
    .strict(),
  z.object({ ...frameBound, kind: z.literal("navigate"), url: z.url() }).strict(),
  z
    .object({
      ...frameBound,
      kind: z.literal("history"),
      direction: z.enum(["back", "forward", "reload"]),
    })
    .strict(),
  z.object({ ...frameBound, kind: z.literal("page.activate"), targetPageId: id }).strict(),
  z.object({ ...frameBound, kind: z.literal("page.close"), targetPageId: id }).strict(),
]);

export const browserDeviceOpenInputSchema = z
  .object({
    targetId: id,
    environment: browserEnvironmentInputSchema.optional(),
  })
  .strict();

export const browserDeviceFrameInputSchema = z
  .object({ targetId: id, afterSequence: z.coerce.number().int().nonnegative().optional() })
  .strict();

export const browserDeviceControlInputSchema = z
  .object({ targetId: id, input: browserDeviceInputSchema })
  .strict();

export type BrowserDevicePage = z.infer<typeof browserDevicePageSchema>;
export type BrowserDeviceSession = z.infer<typeof browserDeviceSessionSchema>;
export type BrowserDeviceFrame = z.infer<typeof browserDeviceFrameSchema>;
export type BrowserDeviceInput = z.infer<typeof browserDeviceInputSchema>;
