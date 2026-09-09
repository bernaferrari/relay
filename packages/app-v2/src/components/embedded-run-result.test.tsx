import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { EmbeddedRunResult } from "./embedded-run-result";
import type { ProductRunReportOverview } from "../data/run-report-model";

function render(cause: string) {
  return renderToStaticMarkup(
    <EmbeddedRunResult
      report={
        {
          outcome: "failed",
          cause,
          timeline: [],
          evidence: [],
        } as unknown as ProductRunReportOverview
      }
    />,
  );
}

it("distinguishes unavailable inspection from a verified screen mismatch", () => {
  const html = render("screen-inspection-unavailable: no controls after bounded re-observation");
  expect(html).toContain("Screen inspection unavailable");
  expect(html).toContain("Reconnect the device");
  expect(html).not.toContain("Screen didn’t match");
  expect(render("expect-screen: on Internet, not Settings")).toContain("Screen didn’t match");
});
