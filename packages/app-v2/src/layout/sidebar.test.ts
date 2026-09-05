import { describe, expect, it } from "vitest";
import { isSidebarItemActive } from "./sidebar";

describe("sidebar route ownership", () => {
  it("gives Apps an explicit stable destination", () => {
    const primaryItems = ["/home", "/changes", "/tests", "/sessions", "/runs", "/devices"] as const;
    const activeItems = primaryItems.filter((item) => isSidebarItemActive("/apps/app-1", item));

    expect(activeItems).toEqual([]);
  });

  it("keeps each primary product area active for nested routes", () => {
    expect(isSidebarItemActive("/tests/test-1/run-across", "/tests")).toBe(true);
    expect(isSidebarItemActive("/sessions/session-1", "/sessions")).toBe(true);
    expect(isSidebarItemActive("/runs/run-1", "/runs")).toBe(true);
    expect(isSidebarItemActive("/devices/device-1", "/devices")).toBe(true);
    expect(isSidebarItemActive("/suites", "/tests")).toBe(true);
    expect(isSidebarItemActive("/apps/app-1/suites/suite-1", "/tests")).toBe(true);
    expect(isSidebarItemActive("/batches/batch-1", "/runs")).toBe(true);
    expect(isSidebarItemActive("/debug", "/sessions")).toBe(true);
    expect(isSidebarItemActive("/environments/profile-1", "/devices")).toBe(true);
    expect(isSidebarItemActive("/recordings/recording-1/review", "/tests")).toBe(true);
  });
});
