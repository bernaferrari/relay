import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { RunTargetPicker } from "./run-target-picker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
});
it("opens grouped choices and retains the selected target without changing it", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const onToggle = vi.fn();
  await act(async () => {
    root.render(
      <RunTargetPicker
        options={[
          { id: "chrome", label: "Chrome", platform: "browser" },
          { id: "pixel", label: "Pixel", platform: "android" },
          { id: "iphone", label: "iPhone", platform: "ios" },
        ]}
        selected={["chrome"]}
        onToggle={onToggle}
      />,
    );
  });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await act(async () =>
    (host.querySelector('[aria-label="Remove Chrome"]') as HTMLElement).click(),
  );
  expect(onToggle).toHaveBeenCalledWith("chrome", false);
  onToggle.mockClear();
  await act(async () => host.querySelector("button")!.click());
  expect(document.body.textContent).toContain("Browsers");
  expect(document.body.textContent).toContain("Android");
  expect(document.body.textContent).toContain("iOS");
  expect(document.querySelector('[aria-label="Chrome"]')?.getAttribute("aria-checked")).toBe(
    "true",
  );
  expect(onToggle).not.toHaveBeenCalled();
  await act(async () => (document.querySelector('[aria-label="Pixel"]') as HTMLElement).click());
  expect(onToggle).toHaveBeenCalledWith("pixel", true);
});
