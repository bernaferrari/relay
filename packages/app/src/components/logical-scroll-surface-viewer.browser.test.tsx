import { expect, test } from "vitest";
import { render } from "solid-js/web";
import type { LogicalScrollSurface, ScrollSurfaceEvidence } from "@relay/protocol";
import { LogicalScrollSurfaceViewer } from "./logical-scroll-surface-viewer";

function evidence(id: string, mime: ScrollSurfaceEvidence["mime"]): ScrollSurfaceEvidence {
  const sha256 = id.padEnd(64, "a").slice(0, 64);
  return {
    id: `evidence-${id}`,
    uri: `relay-evidence://${sha256}`,
    sha256,
    mime,
    bytes: 100,
  };
}

const surface: LogicalScrollSurface = {
  schemaVersion: 1,
  id: "scroll-surface-1",
  captureId: "scroll-surface-capture-1",
  targetProfileId: "ipad-ja",
  capturePolicy: {
    captureMode: "full-surface",
    source: "explicit",
    reason: "Stable product UI",
    decidedAt: 1,
  },
  capturedAt: 10,
  status: "completed",
  reason: "end-of-content",
  message: "Complete",
  restoredStartViewport: true,
  viewports: [
    {
      index: 0,
      offsetY: 0,
      appendedHeight: 0,
      capturedAt: 10,
      width: 100,
      height: 200,
      screenshot: { ...evidence("shot-0", "image/png"), mime: "image/png" },
      accessibilityTree: {
        ...evidence("tree-0", "application/json"),
        mime: "application/json",
      },
    },
    {
      index: 1,
      offsetY: 120,
      appendedHeight: 120,
      capturedAt: 11,
      width: 100,
      height: 200,
      screenshot: { ...evidence("shot-1", "image/png"), mime: "image/png" },
      accessibilityTree: {
        ...evidence("tree-1", "application/json"),
        mime: "application/json",
      },
    },
  ],
  composite: {
    ...evidence("composite", "image/png"),
    mime: "image/png",
    width: 100,
    height: 320,
  },
  mergedTree: {
    ...evidence("merged", "application/json"),
    mime: "application/json",
    nodeCount: 42,
  },
  confidenceModel: {
    schemaVersion: 1,
    classification: "complete",
    confidence: 0.94,
    capturedPixels: 320,
    documentExtent: "known",
    coverage: [
      {
        startY: 0,
        endY: 320,
        state: "captured",
        confidence: 1,
        sourceViewportIndexes: [0, 1],
      },
    ],
    mergeAnchors: [
      {
        fromViewportIndex: 0,
        toViewportIndex: 1,
        documentY: 120,
        shiftY: 120,
        confidence: 0.94,
        basis: "semantic-or-visual",
      },
    ],
    regions: [
      {
        kind: "sticky",
        coordinateSpace: "viewport",
        rect: { x: 0, y: 0, width: 100, height: 24 },
        confidence: 1,
        sourceViewportIndexes: [0, 1],
        target: { identifier: "toolbar" },
        reason: "Stable toolbar",
      },
    ],
    scrollContainer: {
      target: { identifier: "settings-list" },
      role: "list",
      nested: true,
      confidence: 1,
      sourceViewportIndexes: [0, 1],
    },
  },
  manifest: { ...evidence("manifest", "application/json"), mime: "application/json" },
};

test("shows one full-page screen first and keeps source evidence collapsed", () => {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  let regenerations = 0;
  const dispose = render(
    () => (
      <LogicalScrollSurfaceViewer
        surface={surface}
        evidenceUrl={(uri, mime) => `/evidence/${uri.slice(-8)}?mime=${mime}`}
        onRegenerate={() => {
          regenerations += 1;
        }}
      />
    ),
    root,
  );

  expect(root.querySelector("[data-scroll-surface-composite]")).not.toBeNull();
  expect(root.querySelectorAll("[data-scroll-surface-boundary]")).toHaveLength(1);
  expect(root.textContent).toContain("One mapped screen · 2 source viewports");
  expect(root.textContent).toContain("320 px captured");
  expect(root.textContent).toContain("94% surface confidence");
  expect(root.textContent).toContain("1 merge anchor");
  expect(root.textContent).toContain("1 sticky region");
  expect(root.textContent).toContain("Nested scroll container identified");
  expect(root.querySelector("[data-scroll-surface-not-reached]")).toBeNull();

  const evidenceDisclosure = root.querySelector<HTMLDetailsElement>(
    "[data-scroll-surface-evidence]",
  )!;
  expect(evidenceDisclosure.open).toBe(false);
  evidenceDisclosure.open = true;
  evidenceDisclosure.dispatchEvent(new Event("toggle"));
  expect(root.querySelectorAll("[data-scroll-surface-viewports] li")).toHaveLength(2);
  expect(root.querySelectorAll('a[href*="application/json"]')).toHaveLength(4);
  expect(root.textContent).toContain("Merged tree · 42 nodes");
  expect(root.textContent).toContain("Capture manifest");
  const regenerate = [...root.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Regenerate preview"),
  )!;
  regenerate.click();
  expect(regenerations).toBe(1);

  dispose();
  document.body.replaceChildren();
});

test("does not claim a stitched page when seam detection stopped", () => {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const { composite: _, ...withoutComposite } = surface;
  const partial: LogicalScrollSurface = {
    ...withoutComposite,
    status: "stopped",
    reason: "seam-ambiguous",
    message: "Raw viewports retained; no visual seam was claimed.",
    confidenceModel: {
      ...surface.confidenceModel!,
      classification: "dynamic",
      confidence: 0.4,
      documentExtent: "open",
      coverage: [
        {
          startY: 0,
          endY: 320,
          state: "dynamic",
          confidence: 0.4,
          sourceViewportIndexes: [0, 1],
        },
        {
          startY: 320,
          endY: null,
          state: "not-reached",
          confidence: 1,
          sourceViewportIndexes: [],
        },
      ],
      regions: [
        ...surface.confidenceModel!.regions,
        {
          kind: "dynamic",
          coordinateSpace: "viewport",
          rect: { x: 0, y: 0, width: 100, height: 200 },
          confidence: 0.7,
          sourceViewportIndexes: [1],
          reason: "Unstable candidate",
        },
      ],
    },
  };
  const dispose = render(
    () => (
      <LogicalScrollSurfaceViewer
        surface={partial}
        evidenceUrl={(uri, mime) => `/evidence/${uri.slice(-8)}?mime=${mime}`}
      />
    ),
    root,
  );

  expect(root.textContent).toContain("Dynamic");
  expect(root.textContent).toContain("Remaining extent unknown");
  expect(root.textContent).toContain("Dynamic region retained for review");
  expect(root.querySelector("[data-scroll-surface-not-reached]")).not.toBeNull();
  expect(root.textContent).toContain("Preview unavailable");
  expect(root.textContent).toContain("source viewports below are intact");
  expect(root.textContent).toContain("Capture stopped: seam ambiguous");
  expect(root.querySelector("[data-scroll-surface-composite]")).toBeNull();
  expect(root.querySelector<HTMLDetailsElement>("[data-scroll-surface-evidence]")?.open).toBe(true);

  dispose();
  document.body.replaceChildren();
});

test.each([
  ["partial", "limit-reached", "Partial"],
  ["unsupported", "inspection-unavailable", "Unsupported"],
] as const)(
  "presents %s evidence without hiding its raw viewport",
  (classification, reason, label) => {
    document.body.replaceChildren();
    const root = document.createElement("div");
    document.body.append(root);
    const candidate: LogicalScrollSurface = {
      ...surface,
      status: "stopped",
      reason,
      message: `Stopped because ${reason}`,
      confidenceModel: {
        ...surface.confidenceModel!,
        classification,
        confidence: classification === "unsupported" ? 0.15 : 0.72,
        documentExtent: "open",
        coverage: [
          ...surface.confidenceModel!.coverage,
          {
            startY: 320,
            endY: null,
            state: "not-reached",
            confidence: 1,
            sourceViewportIndexes: [],
          },
        ],
      },
    };
    const dispose = render(
      () => (
        <LogicalScrollSurfaceViewer
          surface={candidate}
          evidenceUrl={(uri, mime) => `/evidence/${uri.slice(-8)}?mime=${mime}`}
        />
      ),
      root,
    );

    expect(root.textContent).toContain(label);
    expect(root.textContent).toContain(`Capture stopped: ${reason.replaceAll("-", " ")}`);
    expect(root.querySelectorAll("[data-scroll-surface-viewports] li")).toHaveLength(2);

    dispose();
    document.body.replaceChildren();
  },
);
