/** @jsxImportSource react */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProductRunReportOverview } from "../data/run-product-service";
import { TestStepEvidencePreview } from "./test-step-evidence-preview";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
    <a {...props}>{children}</a>
  ),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.replaceChildren();
});

const baseReport: ProductRunReportOverview = {
  runId: "run-1",
  title: "Checkout",
  timeline: [],
  stepEvidence: [
    {
      schemaVersion: 1,
      testStepId: "step-2",
      recipeId: "test-1",
      recipeStepId: "step-2",
      traceStepId: "trace-2",
      traceStepIndex: 1,
      occurrence: 1,
      evidence: { framePaths: ["frame-2"], eventSequences: [], artifactKinds: ["screenshot"] },
    },
  ],
  evidence: [
    {
      id: "screenshot",
      label: "Screenshots",
      count: 2,
      detail: "2 screenshots",
      summary: "Persisted screenshots",
      inspectable: true,
      items: [
        {
          id: "frame-1",
          title: "Wrong positional frame",
          media: { kind: "image", src: "/wrong.png", width: 100, height: 80 },
        },
        {
          id: "frame-2",
          title: "Selected step frame",
          media: { kind: "image", src: "/right.png", width: 100, height: 80 },
        },
      ],
    },
  ],
};

function render(report: ProductRunReportOverview | undefined = baseReport) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <TestStepEvidencePreview
          step={{ id: "step-2", intent: "Verify checkout" }}
          report={report}
          hasRuns
          loading={false}
        />
      </QueryClientProvider>,
    ),
  );
  return host;
}

describe("TestStepEvidencePreview", () => {
  it("keeps legacy reports visible instead of leaving a blank panel", () => {
    const host = render({ ...baseReport, stepEvidence: undefined });
    expect(host.textContent).toContain("no step-level evidence mapping");
    expect(host.textContent).toContain("Open report");
  });

  it("joins retained media by the authoritative frame id", () => {
    const host = render();
    expect(host.querySelector('img[src="/right.png"]')).not.toBeNull();
    expect(host.querySelector('img[src="/wrong.png"]')).toBeNull();
  });

  it("shows the final linked capture instead of the earlier transition frame", () => {
    const host = render({
      ...baseReport,
      stepEvidence: baseReport.stepEvidence!.map((item) => ({
        ...item,
        evidence: { ...item.evidence, framePaths: ["frame-1", "frame-2"] },
      })),
    });
    expect(host.querySelector('img[src="/right.png"]')).not.toBeNull();
    expect(host.querySelector('img[src="/wrong.png"]')).toBeNull();
  });

  it("keeps bookkeeping-only occurrences from replacing the captured screen", () => {
    const host = render({
      ...baseReport,
      stepEvidence: [
        ...baseReport.stepEvidence!,
        {
          ...baseReport.stepEvidence![0]!,
          occurrence: 2,
          traceStepId: "completion",
          evidence: { framePaths: [], eventSequences: [2], artifactKinds: ["completion"] },
        },
      ],
    });
    expect(host.querySelector('img[src="/right.png"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Occurrence 2"]')).toBeNull();
    expect(host.querySelector("details")).toBeNull();
    expect(host.querySelector('[aria-label="Capture details"]')).not.toBeNull();
  });

  it("shows the trace outcome when timeline indexes are unavailable", () => {
    const host = render({
      ...baseReport,
      timeline: [
        { id: "trace-2", index: 9, title: "Verify checkout", state: "failed", evidenceCount: 1 },
      ],
    });
    expect(host.textContent).toContain("Failed");
    expect(host.textContent).not.toContain("Recorded");
  });

  it("explains a referenced frame that is no longer retained", () => {
    const host = render({
      ...baseReport,
      stepEvidence: baseReport.stepEvidence?.map((item) => ({
        ...item,
        evidence: { ...item.evidence, framePaths: ["expired-frame"] },
      })),
    });
    expect(host.textContent).toContain("Screenshot not retained");
  });
});
