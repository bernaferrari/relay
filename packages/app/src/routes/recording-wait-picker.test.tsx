import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { RecordingWaitPicker } from "./recording-wait-picker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("inserts a bounded condition rather than a fixed delay", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onInsert = vi.fn();
  try {
    await act(async () => root.render(<RecordingWaitPicker canEdit onInsert={onInsert} />));
    await act(async () => host.querySelector("button")!.click());
    const dialog = document.querySelector('[role="dialog"]')!;
    await act(async () =>
      [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Label")!.click(),
    );
    const fields = dialog.querySelectorAll("input");
    await act(async () => {
      ["Stop", "15"].forEach((value, i) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
          fields[i],
          value,
        );
        fields[i]!.dispatchEvent(new Event("input", { bubbles: true }));
      });
    });
    const add = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Add wait")!;
    await act(async () => add.click());
    expect(onInsert).toHaveBeenCalledWith({
      kind: "steps",
      label: "Wait for Stop",
      steps: [{ kind: "wait-for", target: { label: "Stop" }, timeoutMs: 15000 }],
    });
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
