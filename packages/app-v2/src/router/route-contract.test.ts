import { ROUTE_DEFINITIONS, type RoutePattern } from "@relay/product/routes";
import { describe, expect, it } from "vitest";
import { assertAllowedRouteSearch, routeContracts } from "./route-contract";

const expectedPaths = {
  "/home": "/home",
  "/apps": "/apps",
  "/apps/:appId": "/apps/$appId",
  "/apps/:appId/versions": "/apps/$appId/versions",
  "/apps/:appId/accounts": "/apps/$appId/accounts",
  "/apps/:appId/map": "/apps/$appId/map",
  "/tests": "/tests",
  "/tests/new": "/tests/new",
  "/tests/:testId": "/tests/$testId",
  "/tests/:testId/edit": "/tests/$testId/edit",
  "/tests/:testId/record": "/tests/$testId/record",
  "/tests/:testId/run-across": "/tests/$testId/run-across",
  "/recordings/:recordingId/review": "/recordings/$recordingId/review",
  "/runs": "/runs",
  "/runs/:runId": "/runs/$runId",
  "/batches/:batchId": "/batches/$batchId",
  "/changes": "/changes",
  "/changes/:changeId": "/changes/$changeId",
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

  it("rejects search keys outside the canonical route registry", () => {
    expect(() =>
      assertAllowedRouteSearch("/tests/draft-1/record", { workflow: "workflow-1" }),
    ).toThrow(/workflow is not supported/u);
    expect(() =>
      assertAllowedRouteSearch("/tests/draft-1/record", { screen: "home" }),
    ).not.toThrow();
  });
});
