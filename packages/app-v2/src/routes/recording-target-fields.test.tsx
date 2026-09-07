import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { RecordingTargetFields } from "./recording-target-fields";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("saves explicit screen pixels including zero, without inventing a reference size", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onKeep = vi.fn();
  try {
    await act(async () => root.render(<RecordingTargetFields canEdit onKeep={onKeep} />));
    const select = host.querySelector("select")!;
    await act(async () => {
      select.value = "point";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const button = host.querySelector("button")!;
    expect(button.disabled).toBe(true);
    expect(host.textContent).toContain("top-left of the full device screen");
    const inputs = host.querySelectorAll("input");
    await act(async () => {
      inputs.forEach((input, index) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
          input,
          index === 0 ? "0" : "240",
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    });
    await act(async () => button.click());
    expect(onKeep).toHaveBeenCalledWith({ point: { x: 0, y: 240 } });
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
