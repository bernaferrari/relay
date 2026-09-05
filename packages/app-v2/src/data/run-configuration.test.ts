import { describe, expect, it } from "vitest";
import { projectRunConfiguration } from "./run-configuration";

describe("projectRunConfiguration", () => {
  it("keeps persisted context frozen without inventing current availability", () => {
    expect(projectRunConfiguration({ sourceRevision: { sha: "abc" }, buildId: "build-1" })).toEqual(
      {
        values: { sourceRevision: "abc", buildId: "build-1" },
        frozen: true,
      },
    );
  });
});
