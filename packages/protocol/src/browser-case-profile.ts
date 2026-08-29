import * as z from "zod/v4";

/** Engines are part of the frozen case identity. A request for one engine must
 * never be silently served by another engine. */
export const BROWSER_ENGINES = ["chromium", "firefox", "webkit"] as const;
export type BrowserEngine = (typeof BROWSER_ENGINES)[number];
export const browserEngineSchema = z.enum(BROWSER_ENGINES);

/** Playwright browser channels are intentionally allow-listed. A channel is a
 * Chromium concern; Firefox and WebKit cases use their bundled engine. */
export const BROWSER_CHANNELS = ["chrome", "msedge"] as const;
export type BrowserChannel = (typeof BROWSER_CHANNELS)[number];

export const BROWSER_COLOR_SCHEMES = ["light", "dark", "no-preference"] as const;
export type BrowserColorScheme = (typeof BROWSER_COLOR_SCHEMES)[number];

export const BROWSER_REDUCED_MOTION = ["reduce", "no-preference"] as const;
export type BrowserReducedMotion = (typeof BROWSER_REDUCED_MOTION)[number];

const viewportShape = {
  width: z.number().int().min(1).max(8_192),
  height: z.number().int().min(1).max(8_192),
} as const;

/** Viewport and input capabilities are frozen with the browser case rather
 * than read from a mutable target at execution time. */
export const browserViewportSchema = z.object(viewportShape).strict();
export type BrowserViewport = z.infer<typeof browserViewportSchema>;

export const browserScreenSchema = z.object(viewportShape).strict();
export type BrowserScreen = z.infer<typeof browserScreenSchema>;

/** Playwright's permission names are intentionally bounded at the protocol
 * boundary. Unknown names are not passed through to a browser host. */
export const BROWSER_PERMISSIONS = [
  "accelerometer",
  "accessibility-events",
  "ambient-light-sensor",
  "background-sync",
  "camera",
  "clipboard-read",
  "clipboard-write",
  "geolocation",
  "gyroscope",
  "magnetometer",
  "microphone",
  "midi",
  "midi-sysex",
  "notifications",
  "payment-handler",
  "persistent-storage",
  "push",
  "screen-wake-lock",
  "storage-access",
  "top-level-storage-access",
  "window-management",
] as const;
export type BrowserPermission = (typeof BROWSER_PERMISSIONS)[number];

export type BrowserAuthenticationFixtureRef = string;

const reference = z.string().trim().min(1).max(128);
const browserEnvironmentRevision = z.string().trim().min(1).max(128);
const geolocation = z
  .object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
  })
  .strict();

const browserCaseProfileFields = {
  schemaVersion: z.literal(1),
  engine: browserEngineSchema,
  channel: z.enum(BROWSER_CHANNELS).optional(),
  /** Browser build identity, when the host has resolved one. */
  revision: z.string().trim().min(1).max(128).optional(),
  viewport: browserViewportSchema,
  screen: browserScreenSchema.optional(),
  deviceScaleFactor: z.number().finite().min(0.1).max(4),
  mobile: z.boolean(),
  touch: z.boolean(),
  userAgent: z.string().trim().min(1).max(512).optional(),
  locale: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{2,8})*$/u, "must be a BCP-47-like locale tag"),
  timezoneId: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^(?:UTC|GMT|[A-Za-z0-9_+.-]+(?:\/[A-Za-z0-9_+.-]+)+)$/u, "must be an IANA timezone"),
  colorScheme: z.enum(BROWSER_COLOR_SCHEMES),
  reducedMotion: z.enum(BROWSER_REDUCED_MOTION),
  geolocation: geolocation.optional(),
  permissions: z.array(z.enum(BROWSER_PERMISSIONS)).max(32),
  offline: z.boolean(),
  networkProfile: reference.optional(),
  /** Reference only. Credentials never belong in a case profile. */
  authenticationFixtureId: reference.optional(),
  featureFlagFixtureId: reference.optional(),
  environmentRevision: browserEnvironmentRevision,
} as const;

/** Strict, serializable, run-frozen browser environment. Optional values are
 * deliberately absent only where Playwright can resolve the host revision. */
export const browserCaseProfileSchema = z
  .object(browserCaseProfileFields)
  .strict()
  .superRefine((profile, context) => {
    if (profile.channel !== undefined && profile.engine !== "chromium") {
      context.addIssue({
        code: "custom",
        path: ["channel"],
        message: "browser channels are only valid for the chromium engine",
      });
    }
    if (profile.mobile && profile.engine === "firefox") {
      context.addIssue({
        code: "custom",
        path: ["mobile"],
        message: "Firefox does not support mobile emulation",
      });
    }
    if (profile.mobile && !profile.touch) {
      context.addIssue({
        code: "custom",
        path: ["touch"],
        message: "mobile browser cases must explicitly enable touch",
      });
    }
    if (new Set(profile.permissions).size !== profile.permissions.length) {
      context.addIssue({
        code: "custom",
        path: ["permissions"],
        message: "browser permissions must be unique",
      });
    }
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: profile.timezoneId }).format();
    } catch {
      context.addIssue({
        code: "custom",
        path: ["timezoneId"],
        message: "must be a recognized IANA timezone",
      });
    }
  });
export type BrowserCaseProfile = z.infer<typeof browserCaseProfileSchema>;

/** Input accepted by the deterministic compiler. This is not a frozen profile
 * and may omit values that receive stable defaults. */
export const browserEnvironmentInputSchema = z
  .object({
    schemaVersion: z.literal(1).optional(),
    engine: browserEngineSchema.optional(),
    channel: z.enum(BROWSER_CHANNELS).optional(),
    revision: z.string().trim().min(1).max(128).optional(),
    viewport: z.object(viewportShape).strict().optional(),
    screen: z.object(viewportShape).strict().optional(),
    deviceScaleFactor: z.number().finite().min(0.1).max(4).optional(),
    mobile: z.boolean().optional(),
    touch: z.boolean().optional(),
    userAgent: z.string().trim().min(1).max(512).optional(),
    locale: browserCaseProfileFields.locale.optional(),
    timezoneId: browserCaseProfileFields.timezoneId.optional(),
    colorScheme: z.enum(BROWSER_COLOR_SCHEMES).optional(),
    reducedMotion: z.enum(BROWSER_REDUCED_MOTION).optional(),
    geolocation: geolocation.optional(),
    permissions: z.array(z.enum(BROWSER_PERMISSIONS)).max(32).optional(),
    offline: z.boolean().optional(),
    networkProfile: reference.optional(),
    authenticationFixtureId: reference.optional(),
    featureFlagFixtureId: reference.optional(),
    environmentRevision: browserEnvironmentRevision.optional(),
  })
  .strict();
export const browserEnvironmentSchema = browserEnvironmentInputSchema;
export type BrowserEnvironmentInput = z.input<typeof browserEnvironmentInputSchema>;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

/** Parse an already-frozen profile and reject unknown fields or incompatible
 * engine/channel combinations. The returned value is immutable. */
export function parseBrowserCaseProfile(value: unknown): BrowserCaseProfile {
  return deepFreeze(browserCaseProfileSchema.parse(value));
}

/** Compile partial case/environment input into a deterministic profile. No
 * timestamps, host paths, or mutable target state enter the result. */
export function compileBrowserEnvironment(input: BrowserEnvironmentInput = {}): BrowserCaseProfile {
  const parsed = browserEnvironmentInputSchema.parse(input);
  const viewport = parsed.viewport;
  return parseBrowserCaseProfile({
    schemaVersion: 1,
    engine: parsed.engine ?? "chromium",
    ...(parsed.channel === undefined ? {} : { channel: parsed.channel }),
    ...(parsed.revision === undefined ? {} : { revision: parsed.revision }),
    viewport: {
      width: viewport?.width ?? 1_280,
      height: viewport?.height ?? 800,
    },
    ...(parsed.screen === undefined ? {} : { screen: parsed.screen }),
    deviceScaleFactor: parsed.deviceScaleFactor ?? 1,
    mobile: parsed.mobile ?? false,
    touch: parsed.touch ?? false,
    ...(parsed.userAgent === undefined ? {} : { userAgent: parsed.userAgent }),
    locale: parsed.locale ?? "en-US",
    timezoneId: parsed.timezoneId ?? "UTC",
    colorScheme: parsed.colorScheme ?? "light",
    reducedMotion: parsed.reducedMotion ?? "no-preference",
    ...(parsed.geolocation === undefined ? {} : { geolocation: parsed.geolocation }),
    permissions: parsed.permissions ?? [],
    offline: parsed.offline ?? false,
    ...(parsed.networkProfile === undefined ? {} : { networkProfile: parsed.networkProfile }),
    ...(parsed.authenticationFixtureId === undefined
      ? {}
      : { authenticationFixtureId: parsed.authenticationFixtureId }),
    ...(parsed.featureFlagFixtureId === undefined
      ? {}
      : { featureFlagFixtureId: parsed.featureFlagFixtureId }),
    environmentRevision: parsed.environmentRevision ?? "relay.browser-environment.v1",
  });
}

/** Descriptive alias for callers that compile an environment into a frozen
 * case profile. */
export function compileBrowserCaseProfile(input: BrowserEnvironmentInput = {}): BrowserCaseProfile {
  return compileBrowserEnvironment(input);
}

export type BrowserEnvironmentValidation =
  | { ok: true; profile: BrowserCaseProfile }
  | { ok: false; errors: readonly string[] };

/** Non-throwing validation for target/preflight surfaces. Error paths are
 * sorted so the same malformed input has the same diagnostic order. */
export function validateBrowserEnvironment(input: unknown): BrowserEnvironmentValidation {
  const result = browserEnvironmentInputSchema.safeParse(input);
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues
        .map((issue) => `${issue.path.join(".") || "profile"}: ${issue.message}`)
        .sort((left, right) => left.localeCompare(right)),
    };
  }
  try {
    return { ok: true, profile: compileBrowserEnvironment(result.data) };
  } catch (error) {
    return {
      ok: false,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}
