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
  it("opens capture details with the full image path while retaining review controls", async () => {
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
    expect(document.querySelector('[data-slot="popover-content"]')).toBeNull();
    const details = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("Capture details"),
    )!;
    await act(async () => details.click());
    const metadata = document.querySelector('[data-slot="popover-content"]')!;
    expect(metadata.querySelector("dl")?.textContent).toContain("Full imageframes/001.png");
    expect(metadata.textContent).toContain("Settings");
    expect(host.querySelector("img")?.getAttribute("src")).toBe("/runs/run-1/frames/001.png");
    expect(host.textContent).toContain("Looks correct");
    expect(host.textContent).toContain("Report issue");
    expect(host.querySelector('[aria-label="More review options"]')).not.toBeNull();
    expect(host.textContent).not.toContain("Use as baseline");
    expect(host.textContent).not.toContain("Use as new reference");
  });

  it("shows the stored issue note on the screenshot", () => {
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
                  status: "issue",
                  note: "Save overlaps the description",
                  framePath: "frames/001.png",
                  imageSha256: "aaa",
                },
              ],
              summary: {
                captured: 1,
                missing: 0,
                pending: 0,
                accepted: 0,
                issue: 1,
                needMoreEvidence: 0,
              },
            }}
            frames={[]}
            selectedIndex={0}
            onSelect={() => undefined}
          />
        </QueryClientProvider>,
      ),
    );
    expect(host.textContent).toContain("Save overlaps the description");
    expect(host.textContent).toContain("Issue reported");
  });

  it("review overlays stay off the Looks correct action and are not comparison masks", () => {
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
                  caption: "Chat",
                  status: "pending",
                  framePath: "frames/001.png",
                  imageSha256: "aaa",
                  masks: [{ name: "clock", x: 0.8, y: 0, width: 0.2, height: 0.05 }],
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
                title: "Chat",
                media: { kind: "image", src: "/runs/run-1/frames/001.png" },
              },
            ]}
            selectedIndex={0}
            onSelect={() => undefined}
            onReview={vi.fn()}
            showMasks
            onShowMasksChange={() => undefined}
          />
        </QueryClientProvider>,
      ),
    );
    expect(host.textContent).toContain("Looks correct");
    expect(host.textContent).toContain("Show review overlays");
    expect(host.textContent).not.toContain("Show comparison masks");
    expect(host.textContent).not.toContain("Use as baseline");
    expect(host.textContent).not.toContain("Use as new reference");
  });

  it("opens inspection from the gallery without duplicating its full image", () => {
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
                {
                  captureId: "frames/002.png::bbb",
                  caption: "Home",
                  status: "pending",
                  lookFor: "Composer is empty",
                  framePath: "frames/002.png",
                  imageSha256: "bbb",
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
            }}
            frames={[
              {
                id: "frames/001.png",
                title: "Settings",
                media: { kind: "image", src: "/runs/run-1/frames/001.png" },
              },
              {
                id: "frames/002.png",
                title: "Home",
                media: { kind: "image", src: "/runs/run-1/frames/002.png" },
              },
            ]}
            selectedIndex={0}
            onSelect={() => undefined}
            onReview={vi.fn()}
            onReviewMany={vi.fn()}
          />
        </QueryClientProvider>,
      ),
    );
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Gallery");
    expect(host.querySelector('[aria-label="Selected screenshot"]')).toBeNull();
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label^="Inspect "]')!.click());
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Inspect");
    expect(host.querySelector('[aria-label="Selected screenshot"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Selected screenshot"] img')?.getAttribute("src")).toBe(
      "/runs/run-1/frames/001.png",
    );
    expect(host.textContent).toContain("Look for: Save is visible");
    expect(host.textContent).toContain("Looks correct");
    expect(host.textContent).toContain("Report issue");
    expect(host.querySelector('[aria-label="More review options"]')).not.toBeNull();
    expect(host.textContent).not.toContain("Use as baseline");
    expect(host.textContent).not.toContain("Use as new reference");

    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Inspect");
  });

  it("dest-end Gallery selected image is dest wait-for, not leftover Close last-frame", () => {
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
                  captureId: "frames/003.png::dest-wait",
                  caption: "Observe",
                  status: "pending",
                  lookFor: "What should we explore?",
                  framePath: "frames/003.png",
                  imageSha256: "dest-wait",
                  phase: "dest",
                  policy: "fast",
                },
                {
                  captureId: "frames/004.png::close-leftover",
                  caption: "Close",
                  status: "pending",
                  framePath: "frames/004.png",
                  imageSha256: "close-leftover",
                  phase: "leftover",
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
                id: "frames/003.png",
                title: "Observe",
                media: { kind: "image", src: "/runs/dest-end-observe/frames/003.png" },
              },
              {
                id: "frames/004.png",
                title: "after · Run saved Test",
                media: { kind: "image", src: "/runs/dest-end-observe/frames/004.png" },
              },
            ]}
            selectedIndex={0}
            onSelect={() => undefined}
            onReview={vi.fn()}
            onReviewMany={vi.fn()}
          />
        </QueryClientProvider>,
      ),
    );
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Gallery");
    expect(host.querySelector('[aria-label="Selected screenshot"]')).toBeNull();
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label^="Inspect "]')!.click());
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Inspect");
    expect(host.querySelector('[aria-label="Selected screenshot"] img')?.getAttribute("src")).toBe(
      "/runs/dest-end-observe/frames/003.png",
    );
    expect(
      host.querySelector('[aria-label="Selected screenshot"] img')?.getAttribute("src"),
    ).not.toBe("/runs/dest-end-observe/frames/004.png");
    const thumbs = [...host.querySelectorAll('[aria-label="Screenshots for review"] img')].map(
      (img) => img.getAttribute("src"),
    );
    expect(thumbs).toContain("/runs/dest-end-observe/frames/003.png");
    expect(thumbs).not.toContain("/runs/dest-end-observe/frames/004.png");
    expect(host.textContent).toContain("Observe");
    expect(host.textContent).not.toContain("Captured result");
    expect(host.textContent).not.toMatch(/Close leftover|after · Run saved Test/u);
  });

  it("dest-end slot cards stay dest wait-for, not unphased leftover Close last-frame", () => {
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
                  captureId: "frames/003.png::dest-wait",
                  caption: "Observe",
                  status: "pending",
                  lookFor: "What should we explore?",
                  framePath: "frames/003.png",
                  imageSha256: "dest-wait",
                  phase: "dest",
                  policy: "fast",
                },
                {
                  captureId: "frames/004.png::close-leftover",
                  caption: "Close",
                  status: "pending",
                  framePath: "frames/004.png",
                  imageSha256: "close-leftover",
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
            }}
            frames={[
              {
                id: "frames/003.png",
                title: "Observe",
                media: { kind: "image", src: "/runs/dest-end-observe/frames/003.png" },
              },
              {
                id: "frames/004.png",
                title: "after · Run saved Test",
                media: { kind: "image", src: "/runs/dest-end-observe/frames/004.png" },
              },
            ]}
            selectedIndex={0}
            onSelect={() => undefined}
            onReview={vi.fn()}
            onReviewMany={vi.fn()}
          />
        </QueryClientProvider>,
      ),
    );
    const thumbs = [...host.querySelectorAll('[aria-label="Screenshots for review"] img')].map(
      (img) => img.getAttribute("src"),
    );
    expect(thumbs).toEqual(["/runs/dest-end-observe/frames/003.png"]);
    expect(host.textContent).toContain("Observe");
    expect(host.textContent).not.toContain("Close");
    expect(host.textContent).not.toMatch(/after · Run saved Test/u);
  });
});

it("keeps bulk selection out of screenshot browsing until requested", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const selectCapture = vi.fn();
  const items = ["Settings", "Home"].map((caption, index) => ({
    captureId: `frames/${index}.png::hash${index}`,
    caption,
    status: "pending" as const,
    framePath: `frames/${index}.png`,
    imageSha256: `hash${index}`,
  }));
  act(() =>
    root.render(
      <CaptureReviewPanel
        queue={{
          items,
          summary: {
            captured: 2,
            missing: 0,
            pending: 2,
            accepted: 0,
            issue: 0,
            needMoreEvidence: 0,
          },
        }}
        frames={[]}
        selectedIndex={0}
        onSelect={selectCapture}
        onReviewMany={vi.fn()}
        showImage={false}
      />,
    ),
  );
  expect(host.querySelector('[role="checkbox"]')).toBeNull();
  expect(host.querySelector('[aria-label="Selected screenshot"]')?.textContent).not.toContain(
    "Pending review",
  );
  const button = [...host.querySelectorAll("button")].find(
    (node) => node.textContent === "Select screenshots",
  )!;
  act(() => button.click());
  expect(host.querySelectorAll('[role="checkbox"]')).toHaveLength(2);
  const checkbox = host.querySelector<HTMLElement>('[role="checkbox"]')!;
  act(() => checkbox.click());
  expect(checkbox.getAttribute("aria-checked")).toBe("true");
  act(() =>
    checkbox.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
  );
  expect(selectCapture).not.toHaveBeenCalled();
  act(() =>
    [...host.querySelectorAll("button")]
      .find((node) => node.textContent === "Done selecting")!
      .click(),
  );
  expect(host.querySelector('[role="checkbox"]')).toBeNull();
});
