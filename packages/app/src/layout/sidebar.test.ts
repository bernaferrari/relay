import { describe, expect, it } from "vitest";
import { isSidebarItemActive } from "./sidebar";

describe("sidebar route ownership", () => {
  it("gives apps an explicit stable destination", () => {
    const primaryItems = ["/tests", "/runs", "/accounts", "/devices"] as const;
    const activeItems = primaryItems.filter((item) => isSidebarItemActive("/apps/app-1", item));

    expect(activeItems).toEqual([]);
  });

  it("keeps each primary product area active for nested routes", () => {
    expect(isSidebarItemActive("/tests/test-1", "/tests")).toBe(true);
    expect(isSidebarItemActive("/runs/run-1", "/runs")).toBe(true);
    expect(isSidebarItemActive("/devices/device-1", "/devices")).toBe(true);
    expect(isSidebarItemActive("/environments/profile-1", "/devices")).toBe(true);
    expect(isSidebarItemActive("/batches/batch-1", "/runs")).toBe(true);
    expect(isSidebarItemActive("/recordings/recording-1/review", "/tests")).toBe(true);
    expect(isSidebarItemActive("/accounts", "/accounts")).toBe(true);
  });

  it("keeps the focused screenshot review inside runs", () => {
    expect(isSidebarItemActive("/review", "/runs")).toBe(true);
    expect(isSidebarItemActive("/review", "/tests")).toBe(false);
  });

  it("folds plans into tests", () => {
    expect(isSidebarItemActive("/apps/app-1/suites/suite-1", "/tests")).toBe(true);
  });
});
