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
