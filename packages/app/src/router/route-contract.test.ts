import { ROUTE_DEFINITIONS, type RoutePattern } from "@relay/product/routes";
import { findProductAdvancedVocabulary } from "../../../../scripts/product-contract.mjs";
import { describe, expect, it } from "vitest";
import { assertAllowedRouteSearch, parentPathForPath, routeContracts } from "./route-contract";

const expectedPaths = {
  "/apps": "/apps",
  "/accounts": "/accounts",
  "/apps/:appId/map": "/apps/$appId/map",
  "/tests": "/tests",
  "/tests/new": "/tests/new",
  "/tests/:testId": "/tests/$testId",
  "/apps/:appId/suites/:suiteId": "/apps/$appId/suites/$suiteId",
  "/environments": "/environments",
  "/environments/:profileId": "/environments/$profileId",
  "/recordings/:recordingId": "/recordings/$recordingId",
  "/recordings/:recordingId/review": "/recordings/$recordingId/review",
  "/review": "/review",
  "/runs": "/runs",
  "/runs/:runId": "/runs/$runId",
  "/batches/:batchId": "/batches/$batchId",
  "/devices": "/devices",
  "/devices/:deviceId": "/devices/$deviceId",
  "/settings/general": "/settings/general",
  "/settings/evidence": "/settings/evidence",
  "/settings/integrations": "/settings/integrations",
  "/settings/appearance": "/settings/appearance",
  "/settings/advanced": "/settings/advanced",
  "/settings/about": "/settings/about",
} as const satisfies Record<RoutePattern, string>;

describe("React route contract", () => {
  it("adapts every canonical product route exactly once", () => {
    expect(routeContracts).toHaveLength(ROUTE_DEFINITIONS.length);
    expect(new Set(routeContracts.map((route) => route.id)).size).toBe(routeContracts.length);
    for (const route of routeContracts) expect(route.path).toBe(expectedPaths[route.id]);
  });

  it("inherits product nouns rather than defining a second vocabulary", () => {
    expect(routeContracts.find((route) => route.id === "/batches/:batchId")?.primaryObject).toBe(
      "Report",
    );
    expect(
      routeContracts.find((route) => route.id === "/settings/about")?.primaryObject,
    ).toBeNull();
  });

  it("keeps route presentation copy inside the public vocabulary boundary", () => {
    expect(
      routeContracts.flatMap((route) => findProductAdvancedVocabulary(route.description)),
    ).toEqual([]);
  });

  it("rejects search keys outside the canonical route registry", () => {
    expect(() =>
      assertAllowedRouteSearch("/recordings/draft-1", { workflow: "workflow-1" }),
    ).toThrow(/workflow is not supported/u);
    expect(() => assertAllowedRouteSearch("/recordings/draft-1", { screen: "home" })).not.toThrow();
  });

  it.each(["", "fixture:admin"])(
    "accepts website recording links with the explicit account %j",
    (account) => {
      expect(() =>
        assertAllowedRouteSearch("/tests/new", {
          site: "http://127.0.0.1:8794/",
          account,
        }),
      ).not.toThrow();
    },
  );

  it("builds semantic parent locations for direct-entry navigation", () => {
    expect(parentPathForPath("/tests/test-1")).toBe("/tests");
    expect(parentPathForPath("/apps/app%201/map")).toBe("/tests");
    expect(parentPathForPath("/tests")).toBeUndefined();
  });

  it("accepts a device recording link with its exact app context", () => {
    expect(() =>
      assertAllowedRouteSearch("/tests/new", {
        target: "RQCY104BG8X",
        targetKind: "device",
        originApplication: "ai.x.grok",
      }),
    ).not.toThrow();
  });

  it("keeps recording chrome standard so sidebar and Activity stay available", () => {
    const recording = routeContracts.find((route) => route.id === "/recordings/:recordingId");
    const review = routeContracts.find((route) => route.id === "/recordings/:recordingId/review");
    expect(recording && "chrome" in recording ? recording.chrome : undefined).toBeUndefined();
    expect(review && "chrome" in review ? review.chrome : undefined).toBeUndefined();
  });
});

it("accepts restored report tabs and captures", () => {
  expect(() =>
    assertAllowedRouteSearch("/runs/run-1", { reportView: "captures", capture: "2" }),
  ).not.toThrow();
});

it("allows a test to retain its source plan when switching views", () => {
  expect(() =>
    assertAllowedRouteSearch("/tests/test-one", {
      plan: "daily",
      planApp: "grok",
      view: "definition",
    }),
  ).not.toThrow();
});
