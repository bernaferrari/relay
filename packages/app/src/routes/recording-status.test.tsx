/** @jsxImportSource react */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RecordingProblem } from "./recording-shared";

const recovery = {
  code: "mutation-outcome-unknown",
  title: "Internal status",
  detail: "Pending confirmation",
  recovery: "Inspect again",
  retryable: true,
};

describe("recording confirmation status", () => {
  it("keeps background checking passive without a retry button", () => {
    const html = renderToStaticMarkup(
      <RecordingProblem recovery={recovery} checking onRetry={() => {}} />,
    );
    expect(html).toContain("Checking step status…");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Internal status");
  });

  it("keeps the manual check label stable while its request is pending", () => {
    for (const retrying of [false, true]) {
      const html = renderToStaticMarkup(
        <RecordingProblem recovery={recovery} retrying={retrying} onRetry={() => {}} />,
      );
      expect(html).toContain("Check status");
      expect(html).toContain("This does not repeat the device action.");
      expect(html).not.toContain("Trying again");
      expect(html).not.toContain("Checking step status");
    }
  });
});
