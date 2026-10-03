/** @jsxImportSource react */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SavedRecordingPreview } from "./saved-recording-preview";

const service = vi.hoisted(() => ({ getRecordingFrame: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  useRouteContext: () => ({ catalogService: service }),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
const frames = [
  { evidenceId: "before", uri: "before.png", role: "before" as const },
  { evidenceId: "after", uri: "after.png", role: "after" as const },
];
const bytes = () => ({ bytes: [1, 2, 3], mime: "image/png" });
beforeEach(() => {
  service.getRecordingFrame.mockReset();
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:${Math.random()}`);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
async function settle() {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
}
async function render() {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <SavedRecordingPreview frames={frames} intent="Open Settings" />
      </QueryClientProvider>,
    );
  });
  await settle();
  await act(async () =>
    host
      .querySelector<HTMLImageElement>('img[aria-hidden="true"]')
      ?.dispatchEvent(new Event("load")),
  );
  return host;
}

describe("saved recording evidence", () => {
  it("inspects the displayed frame while another moment loads, then closes when that frame changes", async () => {
    let resolveBefore!: (value: ReturnType<typeof bytes>) => void;
    service.getRecordingFrame.mockImplementation((uri) =>
      uri === "after.png"
        ? Promise.resolve(bytes())
        : new Promise((resolve) => {
            resolveBefore = resolve;
          }),
    );
    const host = await render();
    const displayed = host.querySelector<HTMLImageElement>("img")!;
    const previous = displayed.src;
    Object.defineProperty(displayed, "naturalWidth", { value: 1080 });
    await act(async () => displayed.dispatchEvent(new Event("load")));
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "Before")!
        .click(),
    );
    const inspect = host.querySelector<HTMLButtonElement>('[aria-label="Inspect screenshot"]');
    expect(inspect).not.toBeNull();
    await act(async () => inspect!.click());
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.querySelector("img")?.src).toBe(previous);
    expect(dialog.querySelector("img")?.alt).toBe("After: Open Settings");
    await act(async () =>
      dialog.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!.click(),
    );
    expect(dialog.querySelector("img")?.style.getPropertyValue("--zoom-width")).toBe("1080px");
    expect(dialog.querySelector("img")?.src).toBe(previous);
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(previous);
    await act(async () => resolveBefore(bytes()));
    await settle();
    expect(dialog.querySelector("img")?.alt).toBe("After: Open Settings");
    await act(async () =>
      host.querySelector('img[aria-hidden="true"]')!.dispatchEvent(new Event("load")),
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector("img")?.alt).toBe("Before: Open Settings");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(previous);
  });

  it("keeps the displayed screenshot alive while another moment loads and never deselects it", async () => {
    let resolveBefore!: (value: ReturnType<typeof bytes>) => void;
    service.getRecordingFrame.mockImplementation((uri) =>
      uri === "after.png"
        ? Promise.resolve(bytes())
        : new Promise((resolve) => {
            resolveBefore = resolve;
          }),
    );
    const host = await render();
    const previous = host.querySelector("img")!.src;
    const before = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Before",
    )!;
    await act(async () => before.click());
    expect(before.getAttribute("aria-pressed")).toBe("true");
    await act(async () => before.click());
    expect(before.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector("img")?.src).toBe(previous);
    expect(host.querySelector("img")?.alt).toBe("After: Open Settings");
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(host.textContent).not.toContain("Loading Before");
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(previous);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 275)));
    expect(host.textContent).toContain("Loading Before… Showing After.");
    await act(async () => resolveBefore(bytes()));
    await settle();
    expect(host.querySelector<HTMLImageElement>("img:not([aria-hidden])")?.alt).toBe(
      "After: Open Settings",
    );
    await act(async () =>
      host.querySelector('img[aria-hidden="true"]')!.dispatchEvent(new Event("load")),
    );
    expect(host.querySelector("img")?.alt).toBe("Before: Open Settings");
    expect(host.querySelector('[aria-busy="true"]')).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(previous);
  });

  it("provides a working retry when image decoding fails", async () => {
    service.getRecordingFrame.mockResolvedValue(bytes());
    const host = await render();
    await act(async () => host.querySelector("img")!.dispatchEvent(new Event("error")));
    expect(host.textContent).toContain("could not be loaded");
    const retry = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Try again",
    )!;
    await act(async () => retry.click());
    await settle();
    expect(service.getRecordingFrame).toHaveBeenCalledTimes(2);
    expect(host.querySelector("img")).not.toBeNull();
    await act(async () =>
      host.querySelector('img[aria-hidden="true"]')!.dispatchEvent(new Event("load")),
    );
    expect(host.querySelector('[aria-busy="true"]')).toBeNull();
  });
});
