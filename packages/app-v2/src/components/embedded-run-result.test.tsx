import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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

it("dest-end result thumb is dest wait-for, not leftover Close last-frame", () => {
  const html = renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <EmbeddedRunResult
        report={
          {
            outcome: "passed",
            timeline: [
              {
                id: "leftover",
                index: 1,
                title: "after · Run saved Test",
                state: "passed",
                evidenceCount: 1,
                framePaths: ["frames/004.png"],
              },
            ],
            captureReview: {
              items: [
                {
                  captureId: "frames/003.png::dest",
                  caption: "Observe",
                  status: "pending",
                  framePath: "frames/003.png",
                  phase: "dest",
                  policy: "fast",
                },
              ],
              summary: {
                captured: 1,
                missing: 0,
                pending: 1,
                accepted: 0,
                issue: 0,
                needMoreEvidence: 0,
              },
            },
            evidence: [
              {
                id: "screenshot",
                label: "Screenshots",
                count: 2,
                detail: "",
                summary: "",
                inspectable: true,
                items: [
                  {
                    id: "frames/003.png",
                    title: "Observe",
                    media: { kind: "image", src: "/dest-wait-for.png" },
                  },
                  {
                    id: "frames/004.png",
                    title: "after · Run saved Test",
                    media: { kind: "image", src: "/leftover-close.png" },
                  },
                ],
              },
            ],
          } as unknown as ProductRunReportOverview
        }
      />
    </QueryClientProvider>,
  );
  expect(html).toContain("/dest-wait-for.png");
  expect(html).not.toContain("/leftover-close.png");
});
