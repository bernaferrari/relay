import assert from "node:assert/strict";
import test from "node:test";
import {
  ROUTE_VARIANT_CONFIGURATION_ASSUMPTION,
  captureReviewConfigurationForRoutePlatform,
  listDeclaredRouteVariantConfigurations,
  routeVariantConfigurationsFromPlatformWork,
  routeVariantQuotesShareATestAcrossPlatforms,
} from "./route-variant-configuration.js";

test("route variants list Android, iOS, and web as separate generic configurations", () => {
  const quotes = listDeclaredRouteVariantConfigurations([
    {
      platform: "web",
      configuration: captureReviewConfigurationForRoutePlatform("web"),
      testId: "web-home",
      checkpointId: "home",
      role: "compiled",
    },
    {
      platform: "android",
      configuration: captureReviewConfigurationForRoutePlatform("android"),
      testId: "android-home",
      checkpointId: "home",
      role: "compiled",
    },
    {
      platform: "ios",
      configuration: captureReviewConfigurationForRoutePlatform("ios"),
      testId: "ios-home",
      checkpointId: "home",
      role: "compiled",
    },
  ]);
  assert.equal(quotes.length, 3);
  assert.deepEqual(
    quotes.map((quote) => [quote.platform, quote.testId, quote.configuration]),
    [
      ["web", "web-home", { browser: "browser" }],
      ["android", "android-home", { app: "android" }],
      ["ios", "ios-home", { app: "ios" }],
    ],
  );
  assert.equal(routeVariantQuotesShareATestAcrossPlatforms(quotes), false);
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
      ["web", 8, { browser: "browser" }],
      ["android", 3, { app: "android" }],
      ["ios", 12, { app: "ios" }],
    ],
  );
  assert.equal(
    quotes.every((quote) => quote.testId === undefined),
    true,
  );
  const collapsed = listDeclaredRouteVariantConfigurations([
    {
      platform: "web",
      configuration: { browser: "browser" },
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
      configuration: { app: "ios" },
      testId: "Home chrome",
      role: "compiled",
    },
  ]);
  assert.equal(collapsed.length, 3);
  assert.equal(routeVariantQuotesShareATestAcrossPlatforms(collapsed), true);
});
