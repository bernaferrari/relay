import * as z from "zod/v4";
import type { CaptureReviewConfiguration } from "./capture-review.js";
import {
  RC23_SCREENSHOT_FIRST_CHECKPOINT_IDS,
  RC23_SCREENSHOT_FIRST_PLATFORM_CONFIGURATION,
  RC23_SCREENSHOT_FIRST_PLATFORMS,
  RC23_SCREENSHOT_FIRST_TESTS,
  type Rc23ScreenshotFirstPlatform,
} from "./rc23-screenshot-first.js";

/**
 * Plan / compile / capacity JSON lists Android vs iOS vs web as separate
 * configurations. Dest-end captions ("Home chrome", "Settings") are display
 * text — not one Test covering three platforms by name.
 */
export const ROUTE_VARIANT_CONFIGURATION_ASSUMPTION =
  "Android, iOS, and web route variants are separate configurations, not one Test covering three platforms by name.";

export const ROUTE_VARIANT_PLATFORMS = RC23_SCREENSHOT_FIRST_PLATFORMS;
export type RouteVariantPlatform = Rc23ScreenshotFirstPlatform;

export const ROUTE_VARIANT_PLATFORM_CONFIGURATION = RC23_SCREENSHOT_FIRST_PLATFORM_CONFIGURATION;

export type RouteVariantConfigurationQuote = {
  platform: RouteVariantPlatform;
  configuration: CaptureReviewConfiguration;
  testId?: string;
  checkpointId?: string;
  role?: "compiled" | "companion";
  workItems?: number;
  capacityFile?: string;
};

const captureReviewConfigurationSchema = z
  .object({
    app: z.string().optional(),
    account: z.string().optional(),
    browser: z.string().optional(),
    viewport: z.string().optional(),
    locale: z.string().optional(),
    build: z.string().optional(),
  })
  .strict();

export const routeVariantConfigurationQuoteSchema = z
  .object({
    platform: z.enum(ROUTE_VARIANT_PLATFORMS),
    configuration: captureReviewConfigurationSchema,
    testId: z.string().optional(),
    checkpointId: z.string().optional(),
    role: z.enum(["compiled", "companion"]).optional(),
    workItems: z.number().optional(),
    capacityFile: z.string().optional(),
  })
  .strict();

export function routeVariantPlatformFromTarget(
  platform?: "android" | "ios" | "browser",
): RouteVariantPlatform | undefined {
  if (platform === "browser") return "web";
  if (platform === "android" || platform === "ios") return platform;
  return undefined;
}

export function captureReviewConfigurationForRoutePlatform(
  platform: RouteVariantPlatform,
): CaptureReviewConfiguration {
  return structuredClone(ROUTE_VARIANT_PLATFORM_CONFIGURATION[platform]);
}

function quoteKey(quote: RouteVariantConfigurationQuote): string {
  return [
    quote.platform,
    quote.testId ?? "",
    quote.checkpointId ?? "",
    quote.role ?? "",
    quote.capacityFile ?? "",
  ].join("\0");
}

/** Stable Plan / compile / capacity listing. Same caption does not merge. */
export function listDeclaredRouteVariantConfigurations(
  members: readonly RouteVariantConfigurationQuote[],
): RouteVariantConfigurationQuote[] {
  const seen = new Set<string>();
  const quotes: RouteVariantConfigurationQuote[] = [];
  for (const platform of ROUTE_VARIANT_PLATFORMS) {
    for (const member of members) {
      if (member.platform !== platform) continue;
      const key = quoteKey(member);
      if (seen.has(key)) continue;
      seen.add(key);
      quotes.push({
        platform: member.platform,
        configuration: structuredClone(member.configuration),
        ...(member.testId ? { testId: member.testId } : {}),
        ...(member.checkpointId ? { checkpointId: member.checkpointId } : {}),
        ...(member.role ? { role: member.role } : {}),
        ...(member.workItems !== undefined ? { workItems: member.workItems } : {}),
        ...(member.capacityFile ? { capacityFile: member.capacityFile } : {}),
      });
    }
  }
  return quotes;
}

export function routeVariantConfigurationsFromPlatformWork(
  workItemsByPlatform?: Partial<Record<"android" | "ios" | "browser", number>>,
): RouteVariantConfigurationQuote[] {
  if (!workItemsByPlatform) return [];
  const members: RouteVariantConfigurationQuote[] = [];
  const order: Array<[RouteVariantPlatform, "android" | "ios" | "browser"]> = [
    ["web", "browser"],
    ["android", "android"],
    ["ios", "ios"],
  ];
  for (const [platform, capacity] of order) {
    const workItems = workItemsByPlatform[capacity];
    if (workItems === undefined) continue;
    members.push({
      platform,
      configuration: captureReviewConfigurationForRoutePlatform(platform),
      workItems,
    });
  }
  return listDeclaredRouteVariantConfigurations(members);
}

/** RC-23 dest-ends already exist per platform. Captions are not Test identity. */
export function listRc23RouteVariantConfigurations(): RouteVariantConfigurationQuote[] {
  const members: RouteVariantConfigurationQuote[] = [];
  for (const checkpointId of RC23_SCREENSHOT_FIRST_CHECKPOINT_IDS) {
    for (const platform of ROUTE_VARIANT_PLATFORMS) {
      const testId = RC23_SCREENSHOT_FIRST_TESTS[checkpointId][platform];
      if (!testId) continue;
      members.push({
        platform,
        configuration: captureReviewConfigurationForRoutePlatform(platform),
        testId,
        checkpointId,
        role: "compiled",
      });
    }
  }
  return listDeclaredRouteVariantConfigurations(members);
}

/** True when one Test id is listed on more than one platform. */
export function routeVariantQuotesShareATestAcrossPlatforms(
  quotes: readonly RouteVariantConfigurationQuote[],
): boolean {
  const platformsByTest = new Map<string, Set<RouteVariantPlatform>>();
  for (const quote of quotes) {
    const testId = quote.testId?.trim();
    if (!testId) continue;
    const platforms = platformsByTest.get(testId) ?? new Set();
    platforms.add(quote.platform);
    platformsByTest.set(testId, platforms);
  }
  return [...platformsByTest.values()].some((platforms) => platforms.size > 1);
}
