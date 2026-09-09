/** @jsxImportSource react */
import type { RunTestStepEvidence } from "@relay/protocol";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProductRunReportOverview } from "../data/run-product-service";
import { RunWorkbench } from "./run-workbench";

vi.mock("../components/report-image", () => ({
  ReportImage: ({ media, ...props }: { media: { src: string } }) => (
    <img {...props} src={media.src} />
  ),
}));

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
  performance: [
    {
      name: "CPU (%)",
      points: [
        { at: 1500, value: 2 },
        { at: 3500, value: 90 },
      ],
    },
  ],
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
      startedAt: 1_000,
      finishedAt: 2_500,
      log: "opened cart",
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
      startedAt: 3_000,
      finishedAt: 4_000,
      log: "Confirmation text was not visible",
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
  it("links the performance peak to its step and saved screenshot", () => {
    const host = render();
    act(() =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "Performance")!
        .click(),
    );
    act(() =>
      host
        .querySelectorAll<SVGElement>('svg [role="button"]')[1]!
        .dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(host.textContent).toContain("Check the order confirmation");
    expect(host.querySelector('img[alt="Confirmation missing"]')).not.toBeNull();
    expect(host.textContent).toContain("not an exact frame at the sample time");
  });

  it("keeps the selected screenshot mounted while inspecting details and logs", () => {
    const host = render();
    const image = host.querySelector("img");
    for (const label of ["Checks", "Logs", "Steps"]) {
      const button = [...host.querySelectorAll("button")].find(
        (item) => item.textContent === label,
      )!;
      act(() => button.click());
      expect(host.querySelector("img")).toBe(image);
    }
  });

  it("moves through steps with arrow keys", () => {
    const host = render();
    const selected = host.querySelector('[aria-current="step"]')!;
    act(() =>
      selected.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })),
    );
    expect(host.querySelector('[aria-current="step"]')?.textContent).toContain("Submit the order");
    expect(host.querySelector('img[alt="Checkout submitted"]')).not.toBeNull();
  });

  it("shows unlinked artifacts for a legacy Run with no timeline", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    act(() =>
      root.render(
        <RunWorkbench
          report={{ ...report, timeline: [], stepEvidence: undefined }}
          selectedStepIndex={0}
          onSelectStep={() => {}}
        />,
      ),
    );
    expect(host.textContent).toContain("Available evidence");
    expect(host.textContent).toContain("cannot be attributed to a specific step");
    expect(host.querySelector("img")?.getAttribute("src")).toBe(
      report.evidence[0]?.items[0]?.media?.src,
    );
  });

  it("opens the selected frame for inspection and zooms without substituting media", async () => {
    const host = render(2);
    const selectedSource = host.querySelector("img")?.getAttribute("src");
    const inspect = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Inspect screenshot"),
    )!;
    await act(async () => {
      inspect.click();
    });
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.querySelector("img")?.getAttribute("src")).toBe(selectedSource);
    const zoom = dialog.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!;
    await act(async () => {
      zoom.click();
    });
    expect(dialog.textContent).toContain("100%");
    expect(dialog.querySelector("img")?.style.width).toBe("320px");
  });

  it("selects the first persisted step and its joined media", () => {
    const host = render();
    expect(host.querySelector('[aria-current="step"]')?.textContent).toContain("Open the cart");
    expect(host.querySelector('img[alt="Cart ready"]')).not.toBeNull();
    act(() =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "Checks")!
        .click(),
    );
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
    act(() =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "Checks")!
        .click(),
    );
    expect(host.textContent).toContain("Confirmation text and order number are visible");
    expect(host.textContent).toContain("Confirmation text was not visible");
    const secondFrame = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Screenshot 2: Confirmation error"]',
    );
    expect(secondFrame).toBeDefined();
    act(() => secondFrame!.click());
    expect(host.querySelector('img[alt="Confirmation error"]')).not.toBeNull();
  });

  it("shows checks and navigates between failures", () => {
    const failureReport = {
      ...report,
      timeline: [
        ...report.timeline,
        { ...report.timeline[1], id: "second-failure", index: 3, state: "failed" as const },
      ],
    };
    const selected: number[] = [];
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    act(() =>
      root.render(
        <RunWorkbench
          report={failureReport}
          selectedStepIndex={2}
          onSelectStep={(index) => selected.push(index)}
        />,
      ),
    );
    act(() =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "Checks")!
        .click(),
    );
    expect(host.textContent).not.toContain("Trace interval");
    expect(host.textContent).not.toContain("1970-01-01T00:00:03.000Z");
    expect(host.textContent).toContain("Confirmation text was not visible");
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Next failure"]')?.click());
    expect(selected).toEqual([3]);
    act(() =>
      root.render(
        <RunWorkbench
          report={failureReport}
          selectedStepIndex={3}
          onSelectStep={(index) => selected.push(index)}
        />,
      ),
    );
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Previous failure"]')?.click());
    expect(selected).toEqual([3, 2]);
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
