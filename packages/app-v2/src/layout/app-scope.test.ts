import { describe, expect, it } from "vitest";
import { appContextDestination, appScopeForLocation } from "./app-scope";

describe("App scope", () => {
  it("resolves scope from list filters and owned detail records", () => {
    expect(appScopeForLocation({ pathname: "/tests", search: { app: "app-1" } })).toBe("app-1");
    expect(
      appScopeForLocation({
        pathname: "/tests/test-1/edit",
        search: {},
        tests: [{ id: "test-1", appMapId: "app-2" }],
      }),
    ).toBe("app-2");
    expect(
      appScopeForLocation({
        pathname: "/runs/run-1",
        search: {},
        runs: [{ id: "run-1", appMapId: "app-3" }],
      }),
    ).toBe("app-3");
  });

  it("preserves the active workspace and its supported filters", () => {
    expect(
      appContextDestination({
        pathname: "/runs",
        search: { view: "failed", app: "old-app" },
        appId: "new-app",
      }),
    ).toBe("/runs?view=failed&app=new-app");
    expect(
      appContextDestination({ pathname: "/apps/old-app/versions", search: {}, appId: "new/app" }),
    ).toBe("/apps/new%2Fapp/versions");
  });

  it("returns detail screens to the matching scoped collection", () => {
    expect(
      appContextDestination({
        pathname: "/recordings/workflow-1/review",
        search: {},
        appId: "app-2",
      }),
    ).toBe("/tests?app=app-2");
    expect(appContextDestination({ pathname: "/runs/run-1", search: {}, appId: undefined })).toBe(
      "/runs",
    );
  });
});
