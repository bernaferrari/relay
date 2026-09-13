import { describe, expect, it } from "vitest";
import { shouldRestorePersistedRun } from "./run-restore-gating";

describe("shouldRestorePersistedRun", () => {
  it("does not restore when the pointer is missing", () => {
    expect(shouldRestorePersistedRun(undefined, "run-1")).toBe(false);
    expect(shouldRestorePersistedRun(null, "run-1")).toBe(false);
  });

  it("does not restore when the pointer already names this Run", () => {
    expect(shouldRestorePersistedRun({ runId: "run-1" }, "run-1")).toBe(false);
  });

  it("restores only when a stored pointer names a different Run", () => {
    expect(shouldRestorePersistedRun({ runId: "run-other" }, "run-1")).toBe(true);
  });
});
