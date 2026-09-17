/** @jsxImportSource react */
import type { RunTestStepEvidence } from "@relay/protocol";
import { act, type ComponentProps } from "react";
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
      beforeFramePath: "cart",
      actionBounds: { x: 10, y: 20, width: 50, height: 30 },
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

function render(
  selectedStepIndex = 0,
  value = report,
  onReviewCapture?: ComponentProps<typeof RunWorkbench>["onReviewCapture"],
) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const onSelectStep = (index: number) => {
    root.render(
      <RunWorkbench
        report={value}
        selectedStepIndex={index}
        onSelectStep={onSelectStep}
        onReviewCapture={onReviewCapture}
      />,
    );
  };
  act(() => {
    root.render(
      <RunWorkbench
        report={value}
        onReviewCapture={onReviewCapture}
        selectedStepIndex={selectedStepIndex}
        onSelectStep={onSelectStep}
      />,
    );
  });
  return host;
}

describe("RunWorkbench", () => {
  it("shows unlinked captures without assigning them to a step", () => {
    const value = {
      ...report,
      stepEvidence: [],
      timeline: report.timeline.map((step) => ({ ...step, framePaths: [] })),
    };
    const host = render(0, value);
    expect(host.textContent).toContain("Capture 1 of");
    const steps = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.startsWith("Steps"),
    )!;
    act(() => steps.click());
    expect(host.textContent).toContain("View all captures");
    expect(host.querySelector('img[alt="Cart"]')).toBeNull();
  });

  it("keeps Steps available when the run has no captures", () => {
    const host = render(0, { ...report, stepEvidence: [], evidence: [] });
    expect(host.textContent).toContain("Open the cart");
    expect(host.textContent).not.toContain("Capture 1 of");
  });

  it("defaults to the result and keeps the tap target on the explicit before frame", () => {
    const host = render(1);
    expect(host.querySelector('img[alt="Checkout submitted"]')).not.toBeNull();
    const before = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Before",
    )!;
    act(() => before.click());
    expect(host.querySelector('img[alt="Before action · previous saved frame"]')).not.toBeNull();
    const after = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "After",
    )!;
    act(() => after.click());
    expect(host.querySelector('img[alt="Checkout submitted"]')).not.toBeNull();
  });

  it("prefers an explicit after capture over an earlier before capture", () => {
    const screenshots = report.evidence.find((section) => section.id === "screenshot")!;
    const cart = screenshots.items.find((item) => item.id === "cart")!;
    const original = { ...cart };
    const step = report.timeline[0];
    const originalPaths = step.framePaths;
    Object.assign(cart, { phase: "before" });
    const after = { ...cart, id: "cart-after", title: "Cart after", phase: "after" as const };
    const items = screenshots.items as (typeof cart)[];
    items.push(after);
    step.framePaths = ["cart", "cart-after"];
    const joined = stepEvidence[0].evidence.framePaths as string[];
    joined.push("cart-after");
    try {
      const host = render(0);
      expect(host.querySelector('img[alt="Cart after"]')).not.toBeNull();
    } finally {
      items.pop();
      joined.pop();
      Object.assign(cart, original);
      delete cart.phase;
      step.framePaths = originalPaths;
    }
  });

  it("plays saved steps and pauses without running the device", () => {
    vi.useFakeTimers();
    try {
      const host = render();
      act(() => host.querySelector<HTMLButtonElement>('[aria-label="Play steps"]')!.click());
      act(() => vi.advanceTimersByTime(1000));
      expect(host.querySelector('[aria-current="step"]')?.textContent).toContain(
        "Submit the order",
      );
      act(() =>
        host.querySelector<HTMLButtonElement>('[aria-label="Pause step playback"]')!.click(),
      );
      act(() => vi.advanceTimersByTime(2000));
      expect(host.querySelector('[aria-current="step"]')?.textContent).toContain(
        "Submit the order",
      );
    } finally {
      vi.useRealTimers();
    }
  });

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
      const button = [...host.querySelectorAll("button")].find((item) =>
        item.textContent?.startsWith(label),
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
    const inspect = [...host.querySelectorAll("button")].find(
      (button) => button.getAttribute("aria-label") === "Inspect screenshot",
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
    expect(host.textContent).toContain("No capture linked to this step");
    expect(host.textContent).toContain("Other captures are available in this run.");

    act(() =>
      root.render(<RunWorkbench report={report} selectedStepIndex={2} onSelectStep={() => {}} />),
    );
    const image = host.querySelector("img");
    expect(image).toBeDefined();
    act(() => image!.dispatchEvent(new Event("error")));
    expect(host.textContent).toContain("Screenshot unavailable");
    expect(host.textContent).toContain("The saved image could not be loaded");
  });

  it("moves review with arrow keys and sends the image toolbar decision for the selected capture", async () => {
    const value: ProductRunReportOverview = {
      ...report,
      captureReview: {
        items: [
          {
            captureId: "english",
            caption: "Member · Desktop · English",
            status: "pending",
            framePath: "cart",
            lookFor: "Save is visible",
          },
          {
            captureId: "arabic",
            caption: "Member · Compact · Arabic",
            status: "pending",
            framePath: "checkout",
            lookFor: "Save is visible",
          },
        ],
        summary: {
          captured: 2,
          missing: 0,
          pending: 2,
          accepted: 0,
          issue: 0,
          needMoreEvidence: 0,
        },
      },
    };
    const review = vi.fn(async () => undefined);
    const host = render(0, value, review);
    expect(host.querySelector('[role="tablist"][aria-label="Step views"]')).not.toBeNull();
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Captures");
    expect(host.querySelector('[role="tabpanel"]')).not.toBeNull();
    expect(host.textContent).toContain("2/2 captured");
    expect(host.textContent).toContain("2 pending review");
    expect(host.textContent).not.toContain("passed");
    const previous = host.querySelector<HTMLButtonElement>('[aria-label="Previous capture"]')!;
    const next = host.querySelector<HTMLButtonElement>('[aria-label="Next capture"]')!;
    expect(previous.disabled).toBe(true);
    act(() => next.click());
    expect(host.textContent).toContain("Capture 2 of 2");
    expect(next.disabled).toBe(true);
    act(() => previous.click());
    expect(host.textContent).toContain("Capture 1 of 2");
    const sheet = host.querySelector<HTMLElement>('[aria-label="Screenshot review"]')!;
    expect(host.querySelector("p.text-sm.font-semibold")?.textContent).toBe(
      "Member · Desktop · English",
    );
    act(() => {
      sheet.focus();
      sheet.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(host.querySelector("p.text-sm.font-semibold")?.textContent).toBe(
      "Member · Compact · Arabic",
    );
    const bar = host.querySelector(
      '.relay-evidence-image-frame [aria-label="Screenshot review decision"]',
    )!;
    expect(host.querySelectorAll('[aria-label="Screenshot review decision"]')).toHaveLength(1);
    expect(
      host.querySelector('[aria-label="Screenshot review"] img[alt="Checkout submitted"]'),
    ).toBeNull();
    const accept = [...bar.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Looks correct"),
    )!;
    await act(async () => accept.click());
    expect(review).toHaveBeenCalledWith({ captureId: "arabic", action: "accept" });
    act(() =>
      [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
        .find((item) => item.textContent === "Logs")!
        .click(),
    );
    expect(host.querySelector(".relay-evidence-image-frame img")?.getAttribute("alt")).toBe(
      "Checkout submitted",
    );
    expect(host.querySelector('[aria-label="Screenshot review decision"]')).not.toBeNull();
    for (const label of ["Steps", "Logs"]) {
      const tab = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((item) =>
        item.textContent?.startsWith(label),
      )!;
      act(() => tab.click());
      const decision = [
        ...host.querySelectorAll<HTMLButtonElement>(".relay-evidence-image-frame button"),
      ].find((item) => item.textContent?.includes("Looks correct"))!;
      expect(decision).toBeDefined();
      await act(async () => decision.click());
      expect(review).toHaveBeenLastCalledWith({ captureId: "english", action: "accept" });
    }
  });
});
