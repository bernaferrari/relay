/** @jsxImportSource react */
import type { RunTestStepEvidence } from "@relay/protocol";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { ProductRunReportOverview } from "../data/run-product-service";
import { RunWorkbench } from "./run-workbench";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
});

const stepEvidence: readonly RunTestStepEvidence[] = [
  {
    schemaVersion: 1,
    testStepId: "open-cart",
    recipeId: "test-checkout",
    recipeStepId: "open-cart",
    traceStepId: "trace-cart",
    traceStepIndex: 0,
    occurrence: 1,
    evidence: { framePaths: ["cart"], eventSequences: [1], artifactKinds: ["screenshot"] },
  },
  {
    schemaVersion: 1,
    testStepId: "submit-order",
    recipeId: "test-checkout",
    recipeStepId: "submit-order",
    traceStepId: "trace-submit",
    traceStepIndex: 1,
    occurrence: 1,
    evidence: { framePaths: ["checkout"], eventSequences: [2], artifactKinds: ["screenshot"] },
  },
  {
    schemaVersion: 1,
    testStepId: "confirmation",
    recipeId: "test-checkout",
    recipeStepId: "confirmation",
    traceStepId: "trace-confirmation",
    traceStepIndex: 2,
    occurrence: 1,
    evidence: {
      framePaths: ["missing", "confirmation-error"],
      eventSequences: [3, 4],
      artifactKinds: ["screenshot"],
    },
  },
];

const report: ProductRunReportOverview = {
  runId: "run-checkout",
  testId: "test-checkout",
  title: "Complete checkout",
  outcome: "harness-failure",
  timeline: [
    {
      id: "open-cart",
      index: 0,
      title: "Open the cart",
      state: "passed",
      evidenceCount: 1,
      expected: "Cart is visible",
      observed: "Cart is visible",
    },
    {
      id: "submit-order",
      index: 1,
      title: "Submit the order",
      state: "passed",
      evidenceCount: 1,
      expected: "Order submission completes",
      observed: "Order submission completed",
    },
    {
      id: "confirmation",
      index: 2,
      title: "Check the order confirmation",
      state: "failed",
      evidenceCount: 2,
      expected: "Confirmation text and order number are visible",
      observed: "Confirmation text was not visible",
    },
  ],
  stepEvidence,
  evidence: [
    {
      id: "screenshot",
      label: "Screenshots",
      count: 4,
      detail: "4 screenshots",
      summary: "Persisted run screenshots",
      inspectable: true,
      items: [
        {
          id: "cart",
          title: "Cart ready",
          media: { kind: "image", src: "/cart.png", width: 320, height: 200 },
        },
        {
          id: "checkout",
          title: "Checkout submitted",
          media: { kind: "image", src: "/checkout.png", width: 320, height: 200 },
        },
        {
          id: "missing",
          title: "Confirmation missing",
          media: { kind: "image", src: "/missing.png", width: 320, height: 200 },
        },
        {
          id: "confirmation-error",
          title: "Confirmation error",
          media: { kind: "image", src: "/confirmation-error.png", width: 320, height: 200 },
        },
      ],
    },
  ],
};

function render(selectedStepIndex = 0) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const onSelectStep = (index: number) => {
    root.render(
      <RunWorkbench report={report} selectedStepIndex={index} onSelectStep={onSelectStep} />,
    );
  };
  act(() => {
    root.render(
      <RunWorkbench
        report={report}
        selectedStepIndex={selectedStepIndex}
        onSelectStep={onSelectStep}
      />,
    );
  });
  return host;
}

describe("RunWorkbench", () => {
  it("selects the first persisted step and its joined media", () => {
    const host = render();
    expect(host.querySelector('[aria-current="step"]')?.textContent).toContain("Open the cart");
    expect(host.querySelector('img[alt="Cart ready"]')).not.toBeNull();
    expect(host.textContent).toContain("Expected");
    expect(host.textContent).toContain("Cart is visible");
  });

  it("switches steps and frames using persisted media IDs", () => {
    const host = render();
    const stepButton = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("Check the order confirmation"),
    );
    expect(stepButton).toBeDefined();
    act(() => stepButton!.click());
    expect(host.querySelector('img[alt="Confirmation missing"]')).not.toBeNull();
    expect(host.textContent).toContain("Confirmation text and order number are visible");
    expect(host.textContent).toContain("Confirmation text was not visible");
    const secondFrame = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Screenshot 2: Confirmation error"]',
    );
    expect(secondFrame).toBeDefined();
    act(() => secondFrame!.click());
    expect(host.querySelector('img[alt="Confirmation error"]')).not.toBeNull();
  });

  it("explains missing joined media and retained media failures", () => {
    const missingReport = {
      ...report,
      stepEvidence: report.stepEvidence?.map((item) =>
        item.testStepId === "submit-order"
          ? { ...item, evidence: { ...item.evidence, framePaths: ["not-retained"] } }
          : item,
      ),
    };
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    act(() =>
      root.render(
        <RunWorkbench report={missingReport} selectedStepIndex={1} onSelectStep={() => {}} />,
      ),
    );
    expect(host.textContent).toContain("No screenshot for this step");

    act(() =>
      root.render(<RunWorkbench report={report} selectedStepIndex={2} onSelectStep={() => {}} />),
    );
    const image = host.querySelector("img");
    expect(image).toBeDefined();
    act(() => image!.dispatchEvent(new Event("error")));
    expect(host.textContent).toContain("Screenshot unavailable");
    expect(host.textContent).toContain("The saved image could not be loaded");
  });
});
