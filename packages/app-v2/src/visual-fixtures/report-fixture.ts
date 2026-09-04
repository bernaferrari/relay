import type { ProductRunReportOverview } from "../data/run-product-service";

export const failedReport: ProductRunReportOverview = {
  runId: "run-checkout",
  testId: "test-checkout",
  title: "Complete checkout",
  outcome: "harness-failure",
  targetName: "Golden Chromium",
  durationMs: 12_480,
  category: "Browser connection",
  cause:
    "page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:4173/checkout\nCall log:\n  - navigating to the saved app address, waiting until load",
  firstEvidence: {
    label: "Order confirmation was missing",
    detail:
      "Relay reached the final checkout step, but the saved confirmation text was not visible.",
  },
  timeline: [
    {
      id: "open-cart",
      index: 0,
      title: "Open the cart",
      state: "passed",
      durationMs: 1_100,
      evidenceCount: 1,
      framePaths: ["cart"],
    },
    {
      id: "submit-order",
      index: 1,
      title: "Submit the order",
      state: "passed",
      durationMs: 2_240,
      evidenceCount: 1,
    },
    {
      id: "confirmation",
      index: 2,
      title: "Check the order confirmation",
      state: "failed",
      durationMs: 9_140,
      evidenceCount: 2,
      framePaths: ["missing"],
    },
  ],
  evidence: [
    {
      id: "screenshot",
      label: "Screenshots",
      count: 4,
      detail: "4 screenshots",
      summary: "See the screens Relay captured while this Test ran.",
      inspectable: true,
      items: [
        { id: "cart", title: "Cart ready" },
        { id: "checkout", title: "Checkout submitted" },
        {
          id: "missing",
          title: "Confirmation missing",
          tone: "critical",
          media: {
            kind: "image",
            src: "/src/visual-fixtures/checkout-observed.svg",
            width: 320,
            height: 200,
          },
        },
      ],
    },
    {
      id: "logs",
      label: "Logs",
      count: 1,
      detail: "1 log message",
      summary: "Review the app and system messages captured during this Run.",
      inspectable: true,
      items: [{ id: "log", title: "Checkout completed without confirmation", tone: "warning" }],
    },
  ],
};
