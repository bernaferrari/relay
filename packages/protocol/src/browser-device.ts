import * as z from "zod/v4";
import { browserCaseProfileSchema, browserEnvironmentInputSchema } from "./browser-case-profile.js";
import { browserDeviceTelemetrySchema } from "./browser-device-telemetry.js";

const id = z.string().trim().min(1).max(256);
const natural = z.number().int().nonnegative();

/** The binary Browser Device envelope is a bounded resource, not an inline
 * operation response. Its first four bytes are a big-endian metadata length,
 * followed by strict JSON metadata and the JPEG payload. */
export const BROWSER_DEVICE_BINARY_FRAME_CONTENT_TYPE = "application/x-relay-browser-device-frame";
export const MAX_BROWSER_DEVICE_BINARY_FRAME_BYTES = 18 * 1024 * 1024;
export const MAX_BROWSER_DEVICE_BINARY_METADATA_BYTES = 512 * 1024;

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
    telemetry: browserDeviceTelemetrySchema.optional(),
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

/** Metadata carried alongside a binary Browser Device raster. The JPEG is
 * deliberately not represented here: transport clients receive it as raw
 * bytes and reconstruct the existing frame shape locally. Keeping the full
 * session projection in the metadata means page/status/profile changes are
 * not guessed from a prior poll. */
export const browserDeviceBinaryFrameMetadataSchema = z
  .object({
    schemaVersion: z.literal(1),
    transport: z.literal("binary"),
    session: browserDeviceSessionSchema,
    frame: browserDeviceFrameSchema.omit({ base64: true }),
    gap: z
      .object({ afterSequence: natural, currentSequence: natural, dropped: natural })
      .strict()
      .optional(),
  })
  .strict();

const browserDeviceSemanticRectSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
  })
  .strict();

/** A server-derived locator hint. It is descriptive only: the renderer never
 * receives a DOM handle or executable selector. */
export const browserDeviceSemanticLocatorSchema = z
  .object({
    strategy: z.enum(["identifier", "role-name", "label", "text"]),
    value: z.string().trim().min(1).max(256),
    role: z.string().trim().min(1).max(128).optional(),
    exact: z.boolean().optional(),
  })
  .strict();

/** One bounded semantic candidate painted over an exact Browser Device frame. */
export const browserDeviceSemanticCandidateSchema = z
  .object({
    id: id,
    role: z.string().trim().min(1).max(128),
    label: z.string().max(256).optional(),
    value: z.string().max(256).optional(),
    identifier: z.string().trim().min(1).max(256).optional(),
    rect: browserDeviceSemanticRectSchema,
    enabled: z.boolean(),
    selected: z.boolean(),
    focused: z.boolean(),
    locator: browserDeviceSemanticLocatorSchema.optional(),
    reasoning: z.string().trim().min(1).max(320),
  })
  .strict();

/**
 * Accessibility hints for a Browser Device frame. Every field that can
 * decorate pixels is tied to the same session, page, sequence, and visual
 * fingerprint as the raster observation. A newer frame must be inspected
 * again; it may never inherit old browser semantics.
 */
export const browserDeviceSemanticOverlaySchema = z
  .object({
    schemaVersion: z.literal(1),
    sessionId: id,
    pageId: id,
    sequence: natural,
    visualFingerprint: id,
    capturedAt: natural,
    candidates: z.array(browserDeviceSemanticCandidateSchema).max(128),
    truncated: z.boolean(),
  })
  .strict();

/** The bounded result of resolving one point against the exact painted frame.
 * A coordinate action is only accepted when the caller explicitly reviewed
 * the fallback; otherwise Browser Device input must use one deterministic
 * visible, enabled semantic locator. */
export const browserDeviceInputResolutionSchema = z
  .object({
    outcome: z.enum(["semantic", "coordinate-fallback"]),
    strategy: z.enum(["identifier", "role-name", "label", "text", "coordinate"]),
    candidateId: id.optional(),
    locator: browserDeviceSemanticLocatorSchema.optional(),
    reviewedCoordinateFallback: z.boolean(),
    reasoning: z.string().trim().min(1).max(320),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.outcome === "semantic") {
      if (value.strategy === "coordinate") {
        context.addIssue({ code: "custom", message: "Semantic resolution needs a stable locator" });
      }
      if (!value.candidateId) {
        context.addIssue({ code: "custom", message: "Semantic resolution needs a candidate id" });
      }
      if (!value.locator) {
        context.addIssue({ code: "custom", message: "Semantic resolution needs a locator" });
      } else if (value.locator.strategy !== value.strategy) {
        context.addIssue({ code: "custom", message: "Resolution strategy must match its locator" });
      }
      if (value.reviewedCoordinateFallback) {
        context.addIssue({
          code: "custom",
          message: "Semantic resolution cannot be a reviewed fallback",
        });
      }
      return;
    }
    if (
      value.strategy !== "coordinate" ||
      value.locator !== undefined ||
      value.candidateId !== undefined ||
      !value.reviewedCoordinateFallback
    ) {
      context.addIssue({
        code: "custom",
        message: "Coordinate fallback must be reviewed and must not carry a semantic locator",
      });
    }
  });

const frameBound = {
  sessionId: id,
  pageId: id,
  expectedSequence: natural,
} as const;

export const browserDeviceInputSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...frameBound,
      kind: z.literal("click"),
      x: z.number(),
      y: z.number(),
      /** Required when the click intentionally bypasses semantic targeting. */
      coordinateFallback: z.literal("reviewed").optional(),
    })
    .strict(),
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

export const browserDeviceInspectInputSchema = z
  .object({
    targetId: id,
    sessionId: id,
    pageId: id,
    expectedSequence: z.coerce.number().int().nonnegative(),
  })
  .strict();

export const browserDeviceControlInputSchema = z
  .object({ targetId: id, input: browserDeviceInputSchema })
  .strict();

export type BrowserDevicePage = z.infer<typeof browserDevicePageSchema>;
export type BrowserDeviceSession = z.infer<typeof browserDeviceSessionSchema>;
export type BrowserDeviceFrame = z.infer<typeof browserDeviceFrameSchema>;
export type BrowserDeviceBinaryFrameMetadata = z.infer<
  typeof browserDeviceBinaryFrameMetadataSchema
>;
export type BrowserDeviceSemanticLocator = z.infer<typeof browserDeviceSemanticLocatorSchema>;
export type BrowserDeviceSemanticCandidate = z.infer<typeof browserDeviceSemanticCandidateSchema>;
export type BrowserDeviceSemanticOverlay = z.infer<typeof browserDeviceSemanticOverlaySchema>;
export type BrowserDeviceInputResolution = z.infer<typeof browserDeviceInputResolutionSchema>;
export type BrowserDeviceInput = z.infer<typeof browserDeviceInputSchema>;
