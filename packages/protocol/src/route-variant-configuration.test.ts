import assert from "node:assert/strict";
import test from "node:test";
import { captureReviewSlotId } from "./capture-review.js";
import {
  RC23_SCREENSHOT_FIRST_PLATFORM_CONFIGURATION,
  materializeRc23ScreenshotFirstSlots,
} from "./rc23-screenshot-first.js";
import {
  ROUTE_VARIANT_CONFIGURATION_ASSUMPTION,
  captureReviewConfigurationForRoutePlatform,
  listDeclaredRouteVariantConfigurations,
  listRc23RouteVariantConfigurations,
  routeVariantConfigurationsFromPlatformWork,
  routeVariantQuotesShareATestAcrossPlatforms,
} from "./route-variant-configuration.js";

test("P0.4 lists Android vs iOS vs web dest-ends as separate configurations", () => {
  const quotes = listRc23RouteVariantConfigurations();
  assert.equal(quotes.length, 30);
  assert.equal(quotes.filter((quote) => quote.platform === "web").length, 10);
  assert.equal(quotes.filter((quote) => quote.platform === "android").length, 10);
  assert.equal(quotes.filter((quote) => quote.platform === "ios").length, 10);
  assert.equal(routeVariantQuotesShareATestAcrossPlatforms(quotes), false);
  const home = quotes.filter((quote) => quote.checkpointId === "home-chrome");
  assert.equal(home.length, 3);
  assert.deepEqual(home.map((quote) => quote.testId).sort(), [
    "test-grok-android-home-chrome",
    "test-grok-ios-home-chrome",
    "test-grok-web-signed-in-home",
  ]);
  assert.equal(new Set(home.map((quote) => quote.testId)).size, 3);
  const settings = quotes.filter((quote) => quote.checkpointId === "settings");
  assert.equal(settings.length, 3);
  assert.equal(
    settings.every((quote) => quote.checkpointId === "settings"),
    true,
  );
  const settingsSlots = materializeRc23ScreenshotFirstSlots().filter(
    (slot) => slot.checkpointId === "settings",
  );
  assert.equal(new Set(settingsSlots.map((slot) => captureReviewSlotId(slot))).size, 3);
  assert.deepEqual(
    captureReviewConfigurationForRoutePlatform("android"),
    RC23_SCREENSHOT_FIRST_PLATFORM_CONFIGURATION.android,
  );
  assert.deepEqual(
    captureReviewConfigurationForRoutePlatform("ios"),
    RC23_SCREENSHOT_FIRST_PLATFORM_CONFIGURATION.ios,
  );
  assert.deepEqual(
    captureReviewConfigurationForRoutePlatform("web"),
    RC23_SCREENSHOT_FIRST_PLATFORM_CONFIGURATION.web,
  );
  assert.match(ROUTE_VARIANT_CONFIGURATION_ASSUMPTION, /separate configurations/u);
  assert.match(ROUTE_VARIANT_CONFIGURATION_ASSUMPTION, /not one Test covering three platforms/u);
});

test("capacity JSON lists platform partitions as configurations, not a shared Test name", () => {
  const quotes = routeVariantConfigurationsFromPlatformWork({
    android: 3,
    ios: 12,
    browser: 8,
  });
  assert.deepEqual(
    quotes.map((quote) => [quote.platform, quote.workItems, quote.configuration]),
    [
      ["web", 8, { browser: "grok-com" }],
      ["android", 3, { app: "android" }],
      ["ios", 12, { app: "ai.x.GrokApp" }],
    ],
  );
  assert.equal(
    quotes.every((quote) => quote.testId === undefined),
    true,
  );
  const collapsed = listDeclaredRouteVariantConfigurations([
    {
      platform: "web",
      configuration: { browser: "grok-com" },
      testId: "Home chrome",
      role: "compiled",
    },
    {
      platform: "android",
      configuration: { app: "android" },
      testId: "Home chrome",
      role: "compiled",
    },
    {
      platform: "ios",
      configuration: { app: "ai.x.GrokApp" },
      testId: "Home chrome",
      role: "compiled",
    },
  ]);
  assert.equal(collapsed.length, 3);
  assert.equal(routeVariantQuotesShareATestAcrossPlatforms(collapsed), true);
});
