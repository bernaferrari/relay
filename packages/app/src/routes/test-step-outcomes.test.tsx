/** @jsxImportSource react */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { ProductRunReportOverview } from "../data/run-report-model";
import { LatestRunBanner, StepOutcomeMark, StepOutcomesProvider } from "./test-step-outcomes";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <a href="/runs/run-7">{children}</a>,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
});

const join = (index: number, testStepId: string) => ({
  schemaVersion: 1 as const,
  testStepId,
  recipeId: "r",
  recipeStepId: testStepId,
  traceStepId: `t${index}`,
  traceStepIndex: index,
  occurrence: 1,
  evidence: { framePaths: [], eventSequences: [], artifactKinds: [] },
});

const report = {
  runId: "run-7",
  title: "Checkout",
  outcome: "product-failure",
  timeline: [
    { id: "t0", index: 0, title: "Open the cart", state: "passed", durationMs: 1_100 },
    {
      id: "t1",
      index: 1,
      title: "Confirm the total",
      state: "failed",
      durationMs: 2_000,
      observed: "the total is $25",
    },
  ],
  stepEvidence: [join(0, "open"), join(1, "total")],
  evidence: [],
} as unknown as ProductRunReportOverview;

async function render(runId: string) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <StepOutcomesProvider runId={runId} report={report}>
        <LatestRunBanner stepTitle={(id) => (id === "total" ? "Confirm the total" : undefined)} />
        <div data-step="open">
          <StepOutcomeMark stepId="open" />
        </div>
        <div data-step="total">
          <StepOutcomeMark stepId="total" />
        </div>
      </StepOutcomesProvider>,
    ),
  );
  return host;
}

it("puts the latest run's outcome on each step and explains a failure once", async () => {
  const host = await render("run-7");
  expect(
    host.querySelector('[data-step="open"] [aria-label="Last run: passed"]')?.textContent,
  ).toBe("1.1s");
  expect(host.querySelector('[data-step="total"] [aria-label="Last run: failed"]')).not.toBeNull();
  expect(host.textContent).toContain("Last run failed at “Confirm the total”");
  expect(host.textContent).toContain("The total is $25");
  expect(host.textContent).toContain("Open report");
});

it("ignores a report that belongs to a different run than the header shows", async () => {
  const host = await render("run-8");
  expect(host.querySelector('[aria-label^="Last run:"]')).toBeNull();
  expect(host.textContent).not.toContain("Last run failed");
});
