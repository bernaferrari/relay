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
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="Target by"]')!.click();
    });
    await act(async () => {
      [...document.querySelectorAll<HTMLElement>('[role="option"]')]
        .find((item) => item.textContent?.includes("Screen coordinates"))!
        .click();
    });
    const button = [...host.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("Use target"),
    )!;
    expect(button.disabled).toBe(true);
    expect(host.textContent).toContain("top-left of the full device screen");
    const [x, y] = host.querySelectorAll<HTMLInputElement>('input[type="number"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(x, "0");
      x!.dispatchEvent(new Event("input", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(y, "240");
      y!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button.click());
    expect(onKeep).toHaveBeenCalledWith({ point: { x: 0, y: 240 } });
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
