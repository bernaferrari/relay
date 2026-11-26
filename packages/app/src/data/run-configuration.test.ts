import { describe, expect, it } from "vitest";
import { registerCaptureReviewAccountIdentityExclusion } from "@relay/protocol";
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

  it("does not present a lane or fixture name as the account", () => {
    const unregister = registerCaptureReviewAccountIdentityExclusion(
      (key) => key === "super grok" || key.startsWith("supergrok") || key.startsWith("grok-"),
    );
    try {
      expect(
        projectRunConfiguration({
          account: { id: "acct-member", name: "SuperGrok" },
        }).values.accountName,
      ).toBeUndefined();
      expect(
        projectRunConfiguration({
          account: { id: "acct-member", name: "Member" },
        }).values,
      ).toEqual({ accountId: "acct-member", accountName: "Member" });
    } finally {
      unregister();
    }
  });
});
