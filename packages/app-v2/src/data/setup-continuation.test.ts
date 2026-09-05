import { describe, expect, it } from "vitest";
import { newTestSetupContinuation, readSetupContinuation } from "./setup-continuation";

describe("setup continuation", () => {
  it("round-trips the New Test draft context", () => {
    const token = newTestSetupContinuation("app checkout", "browser/one");
    expect(readSetupContinuation(token)).toEqual({
      kind: "record-test",
      returnTo: "/tests/new",
      appId: "app checkout",
      targetId: "browser/one",
    });
  });

  it("rejects malformed or unrelated continuation values", () => {
    expect(readSetupContinuation("not-json")).toBeUndefined();
    expect(
      readSetupContinuation(
        encodeURIComponent(JSON.stringify({ kind: "other", returnTo: "/home" })),
      ),
    ).toBeUndefined();
  });
});
