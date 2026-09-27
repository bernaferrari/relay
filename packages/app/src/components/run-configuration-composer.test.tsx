/** @jsxImportSource react */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runConfigurationReady } from "./run-configuration-composer";

const here = dirname(fileURLToPath(import.meta.url));

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

  it("is the shared setup composer for Test, Suite, and dataset setup surfaces", () => {
    const surfaces = [
      "../routes/test-page.tsx",
      "../routes/suite-page.tsx",
      "../routes/run-across-page.tsx",
    ];
    for (const relative of surfaces) {
      const source = readFileSync(join(here, relative), "utf8");
      expect(source).toContain("RunConfigurationComposer");
      expect(source).toContain("run-configuration-composer");
    }
  });
});
