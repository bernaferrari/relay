import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import type { Platform } from "../platform/types";
import { createAppRouter } from "./create-router";

const platform: Platform = {
  platform: "web",
  getServerUrl: () => "http://127.0.0.1:8787",
  storage: { get: () => null, set: () => undefined },
};

const deepLinks = [
  "/apps",
  "/apps/app-1",
  "/versions",
  "/accounts",
  "/apps/app-1/map",
  "/tests",
  "/tests/new",
  "/tests/test-1",
  "/tests/test-1/edit",
  "/apps/app-1/suites/suite-1",
  "/environments",
  "/environments/chrome-staging",
  "/sessions",
  "/sessions/session-1",
  "/recordings/recording-1",
  "/recordings/recording-1/review",
  "/runs",
  "/runs/run-1",
  "/batches/batch-1",
  "/devices",
  "/devices/device-1",
  "/settings/general",
  "/settings/evidence",
  "/settings/integrations",
  "/settings/appearance",
  "/settings/advanced",
  "/settings/about",
] as const;

function testRouter(initialEntries: string[]) {
  return createAppRouter({
    platform,
    queryClient: new QueryClient(),
    history: createMemoryHistory({ initialEntries }),
  });
}

describe("React router", () => {
  it.each(deepLinks)("resolves the canonical deep link %s", async (path) => {
    const router = testRouter([path]);
    await router.load();
    expect(router.state.location.pathname).toBe(path);
    expect(router.state.status).toBe("idle");
    expect(router.state.matches).toHaveLength(2);
  });

  it.each(["/"])("opens Tests as home from %s", async (path) => {
    const router = testRouter([path]);
    await router.load();
    expect(router.state.location.pathname).toBe("/tests");
    expect(router.state.status).toBe("idle");
  });

  it("redirects the retired Evidence tab to Results", async () => {
    const router = testRouter(["/evidence"]);
    await router.load();
    expect(router.state.location.pathname).toBe("/runs");
  });

  it("uses the injected history for navigation and Back", async () => {
    const router = testRouter(["/tests"]);
    await router.load();
    await router.navigate({ to: "/runs/$runId", params: { runId: "run-1" } });
    expect(router.state.location.pathname).toBe("/runs/run-1");
    router.history.back();
    await router.load();
    expect(router.state.location.pathname).toBe("/tests");
  });

  it("uses hash history by default", async () => {
    window.location.hash = "#/runs/run-1";
    const router = createAppRouter({ platform, queryClient: new QueryClient() });
    await router.load();
    expect(router.state.location.pathname).toBe("/runs/run-1");
    expect(window.location.hash).toBe("#/runs/run-1");
  });
});
