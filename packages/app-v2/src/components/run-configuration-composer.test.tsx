/** @jsxImportSource react */
import { describe, expect, it } from "vitest";
import { runConfigurationReady } from "./run-configuration-composer";

describe("run configuration", () => {
  it("is ready only when a target is present and blockers are resolved", () => {
    expect(
      runConfigurationReady({ values: { targetProfileId: "target-1" }, validated: true }),
    ).toBe(true);
    expect(
      runConfigurationReady({
        values: { targetProfileId: "target-1" },
        blockers: [{ id: "build", label: "Build unavailable" }],
      }),
    ).toBe(false);
    expect(runConfigurationReady({ values: {} })).toBe(false);
  });
});
