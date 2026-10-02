import { act } from "react";
import { createRoot } from "react-dom/client";
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

it("unphased result thumb drops leftover Transition executed / Inspect setup skipped", () => {
  const html = renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <EmbeddedRunResult
        report={
          {
            outcome: "passed",
            timeline: [],
            captureReview: {
              items: [
                {
                  captureId: "frames/002.png::transition",
                  caption: "after · Transition executed",
                  status: "pending",
                  framePath: "frames/002.png",
                },
                {
                  captureId: "frames/003.png::observe",
                  caption: "Observe",
                  status: "pending",
                  framePath: "frames/003.png",
                  lookFor: "What should we explore?",
                  policy: "fast",
                },
                {
                  captureId: "frames/004.png::inspect",
                  caption: "after · Inspect setup skipped — already on this view",
                  status: "pending",
                  framePath: "frames/004.png",
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
                count: 3,
                detail: "",
                summary: "",
                inspectable: true,
                items: [
                  {
                    id: "frames/002.png",
                    title: "after · Transition executed",
                    media: { kind: "image", src: "/transition-executed.png" },
                  },
                  {
                    id: "frames/003.png",
                    title: "Observe",
                    media: { kind: "image", src: "/dest-wait-for.png" },
                  },
                  {
                    id: "frames/004.png",
                    title: "after · Inspect setup skipped — already on this view",
                    media: { kind: "image", src: "/inspect-setup-skipped.png" },
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
  expect(html).not.toContain("/transition-executed.png");
  expect(html).not.toContain("/inspect-setup-skipped.png");
});

it("unphased result thumb drops opener Tap beside leftover Transition", () => {
  const html = renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <EmbeddedRunResult
        report={
          {
            outcome: "passed",
            timeline: [],
            captureReview: {
              items: [
                {
                  captureId: "frames/001.png::tap",
                  caption: "before · Tap identifier sidebar.open.button",
                  status: "pending",
                  framePath: "frames/001.png",
                },
                {
                  captureId: "frames/002.png::transition",
                  caption: "after · Transition executed",
                  status: "pending",
                  framePath: "frames/002.png",
                },
                {
                  captureId: "frames/003.png::observe",
                  caption: "step:step-action:Sidebar open-close",
                  status: "pending",
                  framePath: "frames/003.png",
                  lookFor: "Automations",
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
                count: 3,
                detail: "",
                summary: "",
                inspectable: true,
                items: [
                  {
                    id: "frames/001.png",
                    title: "before · Tap identifier sidebar.open.button",
                    media: { kind: "image", src: "/opener-tap.png" },
                  },
                  {
                    id: "frames/002.png",
                    title: "after · Transition executed",
                    media: { kind: "image", src: "/transition-executed.png" },
                  },
                  {
                    id: "frames/003.png",
                    title: "step:step-action:Sidebar open-close",
                    media: { kind: "image", src: "/dest-wait-for.png" },
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
  expect(html).not.toContain("/opener-tap.png");
  expect(html).not.toContain("/transition-executed.png");
});

it("labels the captured result separately and shows the selected step image during investigation", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  const root = createRoot(host);
  const client = new QueryClient();
  const report = {
    outcome: "passed",
    timeline: [
      {
        id: "start",
        index: 0,
        title: "Reach Start",
        state: "passed",
        evidenceCount: 1,
        framePaths: ["start.png"],
      },
    ],
    captureReview: {
      items: [
        {
          captureId: "dest",
          framePath: "dest.png",
          status: "pending",
          phase: "dest",
          policy: "fast",
        },
      ],
    },
    evidence: [
      {
        id: "screenshot",
        items: [
          { id: "start.png", media: { kind: "image", src: "/start.png" } },
          { id: "dest.png", media: { kind: "image", src: "/dest.png" } },
        ],
      },
    ],
  } as unknown as ProductRunReportOverview;
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <EmbeddedRunResult report={report} />
        </QueryClientProvider>,
      ),
    );
    expect(host.querySelector("img")?.getAttribute("src")).toBe("/dest.png");
    expect(host.textContent).toContain("Captured result");
    expect(host.querySelector('[aria-label="Run steps"]')?.textContent).toContain("Reach Start");
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("Reach Start"))!
        .click(),
    );
    expect(host.querySelector("img")?.getAttribute("src")).toBe("/start.png");
    expect(host.textContent).toContain("Reach Start");
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent?.trim() === "Captured result")!
        .click(),
    );
    expect(host.querySelector("img")?.getAttribute("src")).toBe("/dest.png");
  } finally {
    await act(async () => root.unmount());
    client.clear();
  }
});

it("uses the final executed screen when every step has a review capture", async () => {
  const html = renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <EmbeddedRunResult
        report={
          {
            outcome: "passed",
            timeline: [
              { id: "home", index: 0, title: "Sign in", state: "passed", framePaths: ["home.png"] },
              {
                id: "settings",
                index: 1,
                title: "Settings",
                state: "passed",
                framePaths: ["settings.png"],
              },
            ],
            captureReview: {
              items: [
                { captureId: "home", framePath: "home.png", status: "pending", policy: "fast" },
                {
                  captureId: "settings",
                  framePath: "settings.png",
                  status: "pending",
                  policy: "fast",
                },
              ],
            },
            evidence: [
              {
                id: "screenshot",
                items: [
                  { id: "settings.png", media: { kind: "image", src: "/settings.png" } },
                  { id: "home.png", media: { kind: "image", src: "/home.png" } },
                ],
              },
            ],
          } as unknown as ProductRunReportOverview
        }
      />
    </QueryClientProvider>,
  );
  expect(html).toContain('src="/settings.png"');
  expect(html).not.toContain('src="/home.png"');
});
