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
    expect(host.textContent).toContain("has no saved link to this step");
    expect(host.textContent).toContain("Open report");
  });

  it("prefers dest wait-for pixels over leftover run saved test last-frame", () => {
    const host = render({
      ...baseReport,
      captureReview: {
        items: [
          {
            captureId: "frames/003.png::dest",
            caption: "step:step-observe:Observe",
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
      timeline: [
        {
          id: "trace-module",
          index: 4,
          title: "Captured result",
          state: "passed",
          evidenceCount: 1,
          framePaths: ["frames/004.png"],
        },
        {
          id: "trace-dest",
          index: 8,
          title: "Observe",
          state: "passed",
          evidenceCount: 1,
          framePaths: ["frames/003.png"],
        },
      ],
      stepEvidence: [
        {
          schemaVersion: 1,
          testStepId: "step-2",
          recipeId: "root",
          recipeStepId: "relay-test-step-observe-1",
          traceStepId: "trace-module",
          traceStepIndex: 4,
          occurrence: 1,
          evidence: {
            framePaths: ["frames/004.png"],
            eventSequences: [],
            artifactKinds: ["screenshot"],
          },
        },
        {
          schemaVersion: 1,
          testStepId: "step-2",
          recipeId: "observe-flow",
          recipeStepId: "relay-test-step-observe-dest",
          traceStepId: "trace-dest",
          traceStepIndex: 8,
          occurrence: 5,
          evidence: {
            framePaths: ["frames/003.png"],
            eventSequences: [],
            artifactKinds: ["capture-review"],
          },
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
              id: "frames/004.png",
              title: "after · Run saved test",
              media: { kind: "image", src: "/leftover.png", width: 100, height: 80 },
            },
            {
              id: "frames/003.png",
              title: "step:step-observe:Observe",
              media: { kind: "image", src: "/dest.png", width: 100, height: 80 },
            },
          ],
        },
      ],
    });
    expect(host.querySelector('img[src="/dest.png"]')).not.toBeNull();
    expect(host.querySelector('img[src="/leftover.png"]')).toBeNull();
  });

  it("unphased step thumb drops leftover Transition executed / Inspect setup skipped", () => {
    const host = render({
      ...baseReport,
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
      timeline: [
        {
          id: "trace-transition",
          index: 2,
          title: "after · Transition executed",
          state: "passed",
          evidenceCount: 1,
          framePaths: ["frames/002.png"],
        },
        {
          id: "trace-dest",
          index: 8,
          title: "Observe",
          state: "passed",
          evidenceCount: 1,
          framePaths: ["frames/003.png", "frames/004.png"],
        },
      ],
      stepEvidence: [
        {
          schemaVersion: 1,
          testStepId: "step-2",
          recipeId: "root",
          recipeStepId: "relay-test-step-transition",
          traceStepId: "trace-transition",
          traceStepIndex: 2,
          occurrence: 1,
          evidence: {
            framePaths: ["frames/002.png"],
            eventSequences: [],
            artifactKinds: ["screenshot"],
          },
        },
        {
          schemaVersion: 1,
          testStepId: "step-2",
          recipeId: "observe-flow",
          recipeStepId: "relay-test-step-observe-dest",
          traceStepId: "trace-dest",
          traceStepIndex: 8,
          occurrence: 2,
          evidence: {
            framePaths: ["frames/003.png", "frames/004.png"],
            eventSequences: [],
            artifactKinds: ["capture-review"],
          },
        },
      ],
      evidence: [
        {
          id: "screenshot",
          label: "Screenshots",
          count: 3,
          detail: "3 screenshots",
          summary: "Persisted screenshots",
          inspectable: true,
          items: [
            {
              id: "frames/002.png",
              title: "after · Transition executed",
              media: { kind: "image", src: "/transition-executed.png", width: 100, height: 80 },
            },
            {
              id: "frames/003.png",
              title: "Observe",
              media: { kind: "image", src: "/dest-wait-for.png", width: 100, height: 80 },
            },
            {
              id: "frames/004.png",
              title: "after · Inspect setup skipped — already on this view",
              media: { kind: "image", src: "/inspect-setup-skipped.png", width: 100, height: 80 },
            },
          ],
        },
      ],
    });
    expect(host.querySelector('img[src="/dest-wait-for.png"]')).not.toBeNull();
    expect(host.querySelector('img[src="/transition-executed.png"]')).toBeNull();
    expect(host.querySelector('img[src="/inspect-setup-skipped.png"]')).toBeNull();
  });

  it("unphased step thumb drops opener Tap beside leftover Transition", () => {
    const host = render({
      ...baseReport,
      // No captureReview dest-phase — fallback capture selection must not pick opener.
      timeline: [
        {
          id: "trace-opener",
          index: 1,
          title: "before · Tap identifier sidebar.open.button",
          state: "passed",
          evidenceCount: 1,
          framePaths: ["frames/001.png"],
        },
        {
          id: "trace-transition",
          index: 2,
          title: "after · Transition executed",
          state: "passed",
          evidenceCount: 1,
          framePaths: ["frames/002.png"],
        },
        {
          id: "trace-dest",
          index: 8,
          title: "Observe",
          state: "passed",
          evidenceCount: 1,
          framePaths: ["frames/003.png"],
        },
      ],
      stepEvidence: [
        {
          schemaVersion: 1,
          testStepId: "step-2",
          recipeId: "root",
          recipeStepId: "relay-test-step-opener",
          traceStepId: "trace-opener",
          traceStepIndex: 1,
          occurrence: 1,
          evidence: {
            framePaths: ["frames/001.png"],
            eventSequences: [],
            artifactKinds: ["screenshot"],
          },
        },
        {
          schemaVersion: 1,
          testStepId: "step-2",
          recipeId: "root",
          recipeStepId: "relay-test-step-transition",
          traceStepId: "trace-transition",
          traceStepIndex: 2,
          occurrence: 2,
          evidence: {
            framePaths: ["frames/002.png"],
            eventSequences: [],
            artifactKinds: ["screenshot"],
          },
        },
        {
          schemaVersion: 1,
          testStepId: "step-2",
          recipeId: "observe-flow",
          recipeStepId: "relay-test-step-observe-dest",
          traceStepId: "trace-dest",
          traceStepIndex: 8,
          occurrence: 3,
          evidence: {
            framePaths: ["frames/003.png"],
            eventSequences: [],
            artifactKinds: ["screenshot"],
          },
        },
      ],
      evidence: [
        {
          id: "screenshot",
          label: "Screenshots",
          count: 3,
          detail: "3 screenshots",
          summary: "Persisted screenshots",
          inspectable: true,
          items: [
            {
              id: "frames/001.png",
              title: "before · Tap identifier sidebar.open.button",
              media: { kind: "image", src: "/opener-tap.png", width: 100, height: 80 },
            },
            {
              id: "frames/002.png",
              title: "after · Transition executed",
              media: { kind: "image", src: "/transition-executed.png", width: 100, height: 80 },
            },
            {
              id: "frames/003.png",
              title: "Observe",
              media: { kind: "image", src: "/dest-wait-for.png", width: 100, height: 80 },
            },
          ],
        },
      ],
    });
    expect(host.querySelector('img[src="/dest-wait-for.png"]')).not.toBeNull();
    expect(host.querySelector('img[src="/opener-tap.png"]')).toBeNull();
    expect(host.querySelector('img[src="/transition-executed.png"]')).toBeNull();
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
    expect(host.querySelector('[aria-label="Capture 2"]')).toBeNull();
    expect(host.querySelector("details")).toBeNull();
    expect(host.querySelector('[aria-label="Capture details"]')).not.toBeNull();
  });

  it("numbers intentional captures consecutively and omits incidental action previews", () => {
    const host = render({
      ...baseReport,
      timeline: [
        { id: "a", index: 0, title: "Screenshot · Individual", state: "passed", evidenceCount: 1 },
        { id: "b", index: 1, title: "Tap Business", state: "passed", evidenceCount: 1 },
        { id: "c", index: 2, title: "Screenshot · Business", state: "passed", evidenceCount: 1 },
      ],
      stepEvidence: ["a", "b", "c"].map((traceStepId, index) => ({
        ...baseReport.stepEvidence![0]!,
        traceStepId,
        occurrence: index + 2,
      })),
    });
    expect(host.querySelector('[aria-label="Capture 1"]')?.textContent).toBe("1");
    expect(host.querySelector('[aria-label="Capture 2"]')?.textContent).toBe("2");
    expect(host.querySelector('[aria-label="Capture 3"]')).toBeNull();
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

  it("does not borrow another trace verdict at the same index", () => {
    const host = render({
      ...baseReport,
      timeline: [
        { id: "different-trace", index: 1, title: "Other step", state: "passed", evidenceCount: 0 },
      ],
    });
    expect(host.textContent).toContain("Captured");
    expect(host.textContent).not.toContain("Passed");
    expect(host.textContent).not.toContain("Recorded");
  });
});
