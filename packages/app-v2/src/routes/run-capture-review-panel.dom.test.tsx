/** @jsxImportSource react */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CaptureReviewPanel } from "./run-capture-review-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.replaceChildren();
});

describe("CaptureReviewPanel selection", () => {
  it("shows the full image path and criterion without a baseline action", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    act(() =>
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <CaptureReviewPanel
            queue={{
              items: [
                {
                  captureId: "frames/001.png::aaa",
                  caption: "Settings",
                  status: "pending",
                  lookFor: "Save is visible",
                  framePath: "frames/001.png",
                  imageSha256: "aaa",
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
            }}
            frames={[
              {
                id: "frames/001.png",
                title: "Settings",
                media: { kind: "image", src: "/runs/run-1/frames/001.png" },
              },
            ]}
            selectedIndex={0}
            onSelect={() => undefined}
            onReview={vi.fn()}
          />
        </QueryClientProvider>,
      ),
    );
    expect(host.textContent).toContain("Look for: Save is visible");
    expect(host.textContent).toContain("Full image: frames/001.png");
    expect(host.querySelector("img")?.getAttribute("src")).toBe("/runs/run-1/frames/001.png");
    expect(host.textContent).toContain("Looks correct");
    expect(host.textContent).not.toContain("Use as baseline");
    expect(host.textContent).not.toContain("Approve new baseline");
  });
});
