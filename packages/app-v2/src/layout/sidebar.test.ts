import { describe, expect, it } from "vitest";
import { isSidebarItemActive } from "./sidebar";

describe("sidebar route ownership", () => {
  it("gives Apps an explicit stable destination", () => {
    const primaryItems = [
      "/home",
      "/apps",
      "/changes",
      "/tests",
      "/sessions",
      "/runs",
      "/devices",
    ] as const;
    const activeItems = primaryItems.filter((item) => isSidebarItemActive("/apps/app-1", item));

    expect(activeItems).toEqual(["/apps"]);
  });

  it("keeps each primary product area active for nested routes", () => {
    expect(isSidebarItemActive("/tests/test-1/run", "/tests")).toBe(true);
    expect(isSidebarItemActive("/sessions/session-1", "/sessions")).toBe(true);
    expect(isSidebarItemActive("/runs/run-1", "/runs")).toBe(true);
    expect(isSidebarItemActive("/devices/device-1", "/devices")).toBe(true);
  });
});
