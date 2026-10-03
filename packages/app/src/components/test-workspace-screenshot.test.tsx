/** @jsxImportSource react */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it } from "vitest";
import { WorkspaceScreenshot } from "./test-workspace";
import { EvidenceImageViewer } from "./evidence-image-viewer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
});

it("keeps exact saved capture inspection and explicit zoom available from the fitted workspace", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <QueryClientProvider client={new QueryClient()}>
        <WorkspaceScreenshot>
          <EvidenceImageViewer
            frame={{
              id: "failed-step",
              title: "Failed Imagine step",
              media: {
                kind: "image",
                src: "/saved-failure.png",
                width: 1080,
                height: 2340,
              },
            }}
            onError={() => {}}
          />
        </WorkspaceScreenshot>
      </QueryClientProvider>,
    ),
  );
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="Inspect screenshot"]')!.click(),
  );
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.querySelector("img")?.getAttribute("src")).toBe("/saved-failure.png");
  await act(async () => dialog.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!.click());
  expect(dialog.querySelector("img")?.style.getPropertyValue("--zoom-width")).toBe("1080px");
  expect(dialog.querySelector("img")?.getAttribute("src")).toBe("/saved-failure.png");
  await act(async () =>
    [...dialog.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Fit")!
      .click(),
  );
  expect(dialog.querySelector("img")?.style.getPropertyValue("--zoom-width")).toBe("");
});
