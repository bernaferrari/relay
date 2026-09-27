import { describe, expect, it } from "vitest";
import { ApiError } from "@relay/client";
import { liveInputRecovery } from "./live-input-recovery";

describe("live input recovery", () => {
  it("does not ask for a reconnect when only the painted frame expired", () => {
    const recovery = liveInputRecovery(new ApiError(409, "stale", { code: "BROWSER_STALE_INPUT" }));
    expect(recovery.reconnect).toBe(false);
    expect(recovery.message).toContain("before the input was sent");
  });
  it("does not mistake a missing semantic control for a broken connection", () => {
    expect(
      liveInputRecovery(
        new ApiError(409, "no control", { code: "BROWSER_SEMANTIC_TARGET_REQUIRED" }),
      ).reconnect,
    ).toBe(false);
  });
  it("preserves uncertainty when transport loses the result", () => {
    const recovery = liveInputRecovery(new TypeError("Failed to fetch"));
    expect(recovery.reconnect).toBe(true);
    expect(recovery.message).toContain("Check the app before repeating");
    expect(recovery.message).not.toContain("not sent");
  });
});
