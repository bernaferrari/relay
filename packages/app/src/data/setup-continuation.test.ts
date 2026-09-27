import { describe, expect, it } from "vitest";
import {
  newTestSetupContinuation,
  readSetupContinuation,
  runSetupContinuation,
} from "./setup-continuation";

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

  it("round-trips the pending Run setup context for sign-in repair", () => {
    const token = runSetupContinuation("settings-language-arabic");
    expect(readSetupContinuation(token)).toEqual({
      kind: "run-setup",
      returnTo: "/tests",
      testId: "settings-language-arabic",
    });
  });

  it("rejects malformed or unrelated continuation values", () => {
    expect(readSetupContinuation("not-json")).toBeUndefined();
    expect(
      readSetupContinuation(
        encodeURIComponent(JSON.stringify({ kind: "other", returnTo: "/home" })),
      ),
    ).toBeUndefined();
    expect(
      readSetupContinuation(
        encodeURIComponent(JSON.stringify({ kind: "run-setup", returnTo: "/tests" })),
      ),
    ).toBeUndefined();
  });
});
