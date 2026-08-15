import { expect, test, vi } from "vitest";
import { render } from "solid-js/web";
import { ScrollSurfaceCaptureAction } from "./scroll-surface-capture-action";

test("keeps full-surface capture visible and highlights only a recommendation", () => {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const onCapture = vi.fn();
  const dispose = render(
    () => (
      <ScrollSurfaceCaptureAction
        busy={false}
        hasSurface={false}
        policy={{
          captureMode: "full-surface",
          source: "recommended",
          reason: "Stable product-owned settings UI.",
          decidedAt: 1,
        }}
        onCapture={onCapture}
      />
    ),
    root,
  );

  const button = root.querySelector<HTMLButtonElement>("[data-scroll-surface-capture]")!;
  expect(button).not.toBeNull();
  expect(button.dataset.recommended).toBe("true");
  expect(button.textContent).toContain("Recommended");
  expect(button.className).toContain("min-h-11");
  button.click();
  expect(onCapture).toHaveBeenCalledOnce();

  dispose();
  document.body.replaceChildren();
});

test("allows a quiet human override and explains a real execution blocker", () => {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const dispose = render(
    () => (
      <ScrollSurfaceCaptureAction
        busy={false}
        hasSurface={true}
        disabledReason="Connect and reserve this variant’s device."
        policy={{
          captureMode: "viewport",
          source: "recommended",
          reason: "Dynamic user content should remain viewport-only.",
          decidedAt: 1,
        }}
        onCapture={() => undefined}
      />
    ),
    root,
  );

  const button = root.querySelector<HTMLButtonElement>("[data-scroll-surface-capture]")!;
  expect(button.textContent).toContain("Recapture full surface");
  expect(button.textContent).not.toContain("Recommended");
  expect(button.disabled).toBe(true);
  expect(button.getAttribute("aria-describedby")).toBe("scroll-surface-capture-status");

  dispose();
  document.body.replaceChildren();
});
