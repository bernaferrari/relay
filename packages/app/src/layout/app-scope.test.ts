import { describe, expect, it } from "vitest";
import {
  appContextDestination,
  appScopeDetailsForLocation,
  appScopeDisplayName,
  appScopeForLocation,
  safeDecodeURIComponent,
} from "./app-scope";

describe("App scope", () => {
  it("decodes valid route segments and ignores malformed segments safely", () => {
    expect(safeDecodeURIComponent("app%2F1")).toBe("app/1");
    expect(safeDecodeURIComponent("%E0%A4%A")).toBeUndefined();
    expect(
      appScopeDetailsForLocation({
        pathname: "/apps/%E0%A4%A",
        search: { app: "stale-app" },
      }),
    ).toEqual({ kind: "unavailable" });
  });

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

  it("keeps the creation route scoped to its selected app", () => {
    expect(
      appScopeDetailsForLocation({ pathname: "/tests/new", search: { app: "app-7" } }),
    ).toEqual({ kind: "single", appId: "app-7" });
    expect(appScopeDetailsForLocation({ pathname: "/tests/new", search: {} })).toEqual({
      kind: "all",
    });
  });

  it("prefers canonical detail ownership over a stale collection filter", () => {
    expect(
      appScopeForLocation({
        pathname: "/tests/test-1/edit",
        search: { app: "stale-app" },
        tests: [{ id: "test-1", appMapId: "owned-app" }],
      }),
    ).toBe("owned-app");
  });

  it("resolves recordings and changes from their resource ownership", () => {
    expect(
      appScopeForLocation({
        pathname: "/recordings/recording-1/review",
        search: {},
        recordings: [{ id: "recording-1", appMapId: "app-4" }],
      }),
    ).toBe("app-4");
    expect(
      appScopeForLocation({
        pathname: "/changes/change-1",
        search: {},
        changes: [{ id: "change-1", appIds: ["app-5"] }],
      }),
    ).toBe("app-5");
  });

  it("represents multi-App batches and changes honestly", () => {
    expect(
      appScopeDetailsForLocation({
        pathname: "/batches/batch-1",
        search: {},
        batches: [{ id: "batch-1", appMapId: "grok-web" }],
      }),
    ).toEqual({ kind: "single", appId: "grok-web" });
    expect(
      appScopeDetailsForLocation({
        pathname: "/batches/batch-1",
        search: {},
        runs: [
          { id: "run-1", batchId: "batch-1", appMapId: "app-1" },
          { id: "run-2", batchId: "batch-1", appMapId: "app-2" },
        ],
      }),
    ).toEqual({ kind: "multiple", appIds: ["app-1", "app-2"] });
    expect(
      appScopeDetailsForLocation({
        pathname: "/changes/change-1",
        search: {},
        changes: [{ id: "change-1", appIds: ["app-2", "app-1", "app-2"] }],
      }),
    ).toEqual({ kind: "multiple", appIds: ["app-2", "app-1"] });
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
      appContextDestination({
        pathname: "/tests/test-1/run-across",
        search: { app: "old-app" },
        appId: "new-app",
      }),
    ).toBe("/tests?app=new-app");
    expect(
      appContextDestination({
        pathname: "/accounts",
        search: { app: "old-app" },
        appId: "new-app",
      }),
    ).toBe("/accounts");
    expect(
      appContextDestination({ pathname: "/apps/old-app/versions", search: {}, appId: "new/app" }),
    ).toBe("/versions");
  });

  it("does not let workspace-only resources inherit a stale app filter", () => {
    expect(appScopeDetailsForLocation({ pathname: "/accounts", search: { app: "app-1" } })).toEqual(
      { kind: "workspace" },
    );
    expect(appScopeDetailsForLocation({ pathname: "/suites", search: { app: "app-1" } })).toEqual({
      kind: "single",
      appId: "app-1",
    });
  });

  it("resolves session ownership and never labels unresolved ownership as All apps", () => {
    expect(
      appScopeDetailsForLocation({
        pathname: "/sessions/session-1",
        search: {},
        sessions: [{ id: "session-1", appMapId: "app-9" }],
      }),
    ).toEqual({ kind: "single", appId: "app-9" });
    expect(
      appScopeDetailsForLocation({
        pathname: "/sessions/session-1",
        search: {},
      }),
    ).toEqual({ kind: "loading" });
    expect(
      appScopeDetailsForLocation({
        pathname: "/sessions/session-1",
        search: {},
        sessions: [],
      }),
    ).toEqual({ kind: "unavailable" });
    expect(appScopeDetailsForLocation({ pathname: "/devices", search: {} })).toEqual({
      kind: "workspace",
    });
    expect(
      appScopeDetailsForLocation({
        pathname: "/tests/missing",
        search: {},
        tests: [],
      }),
    ).toEqual({ kind: "unavailable" });
  });

  it("does not call a missing app id All apps after the catalog has loaded", () => {
    expect(appScopeDisplayName({ kind: "single", appId: "missing-app" }, undefined, false)).toBe(
      "Loading app",
    );
    expect(appScopeDisplayName({ kind: "single", appId: "missing-app" }, [], true)).toBe(
      "App not found",
    );
    expect(
      appScopeDisplayName(
        { kind: "single", appId: "app-1" },
        [{ id: "app-1", name: "Acme" }],
        true,
      ),
    ).toBe("Acme");
    expect(appScopeDisplayName({ kind: "all" })).toBe("All apps");
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

it("preserves a run's owning app in its walkthrough, including direct links", () => {
  const location = { pathname: "/runs/run-1/walkthrough", search: { app: "wrong-app" } };
  expect(appScopeDetailsForLocation(location)).toEqual({ kind: "loading" });
  expect(
    appScopeDetailsForLocation({ ...location, runs: [{ id: "run-1", appMapId: "owned-app" }] }),
  ).toEqual({ kind: "single", appId: "owned-app" });
  expect(appScopeDetailsForLocation({ ...location, runs: [] })).toEqual({ kind: "unavailable" });
});
