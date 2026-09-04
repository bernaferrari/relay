import { describe, expect, it } from "vitest";
import { isSidebarItemActive } from "./sidebar";

describe("sidebar route ownership", () => {
  it("keeps App detail in Home context instead of implying it is a Change", () => {
    const primaryItems = ["/home", "/changes", "/tests", "/runs", "/devices"] as const;
    const activeItems = primaryItems.filter((item) => isSidebarItemActive("/apps/app-1", item));

    expect(activeItems).toEqual(["/home"]);
  });

  it("keeps each primary product area active for nested routes", () => {
    expect(isSidebarItemActive("/tests/test-1/run", "/tests")).toBe(true);
    expect(isSidebarItemActive("/runs/run-1", "/runs")).toBe(true);
    expect(isSidebarItemActive("/devices/device-1", "/devices")).toBe(true);
  });
});
