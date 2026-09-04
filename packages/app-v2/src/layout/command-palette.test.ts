import { describe, expect, it } from "vitest";
import { commandMatches } from "./command-palette";

describe("command palette search", () => {
  const command = {
    label: "Review failed Runs",
    detail: "Open failure-first Run history",
    keywords: "reports failures",
  };

  it("matches labels, supporting copy, and synonyms without case sensitivity", () => {
    expect(commandMatches(command, "FAILED")).toBe(true);
    expect(commandMatches(command, "history")).toBe(true);
    expect(commandMatches(command, "reports")).toBe(true);
    expect(commandMatches(command, "devices")).toBe(false);
  });
});
