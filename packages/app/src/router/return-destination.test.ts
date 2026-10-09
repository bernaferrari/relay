import { describe, expect, it } from "vitest";
import { returnDestination } from "./return-destination";

describe("return destination", () => {
  it("restores source-owned query state and derives the label from the route", () => {
    expect(returnDestination("/review?item=run-1%3A%3Acapture-2&filter=new&app=grok")).toEqual({
      to: "/review",
      search: { item: "run-1::capture-2", filter: "new", app: "grok" },
      hash: "",
      label: "Review",
    });
    expect(returnDestination("/tests/test-1?view=definition&plan=daily")?.label).toBe("Test");
  });
  it("rejects external, malformed, and unknown destinations", () => {
    for (const input of [
      undefined,
      "https://example.com",
      "//example.com",
      "/\\example.com",
      "/not-a-route",
      "%bad",
    ]) {
      expect(returnDestination(input)).toBeUndefined();
    }
  });
});
