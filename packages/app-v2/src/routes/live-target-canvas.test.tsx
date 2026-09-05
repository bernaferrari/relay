/** @jsxImportSource react */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LiveTargetInput } from "../data/live-target-session";
import { LiveTargetCanvas } from "./live-target-canvas";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
});

function mountCanvas(
  entries: Array<{
    title: string;
    detail: string;
    send: (input: LiveTargetInput) => Promise<boolean>;
  }>,
) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => {
    root.render(
      <div>
        {entries.map((entry) => (
          <LiveTargetCanvas
            key={entry.title}
            canvasRef={{ current: null }}
            status="streaming"
            issue={undefined}
            busy={false}
            targetTitle={entry.title}
            targetDetail={entry.detail}
            send={entry.send}
            recording={false}
          />
        ))}
      </div>,
    );
  });
  return host;
}

describe("LiveTargetCanvas", () => {
  it("keeps unsupported navigation keys local while forwarding supported text input", async () => {
    const send = vi.fn(async () => true);
    const host = mountCanvas([{ title: "Checkout browser", detail: "Account A", send }]);
    const canvas = host.querySelector("canvas");
    if (!canvas) throw new Error("live canvas was not rendered");

    canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(send).not.toHaveBeenCalled();

    await act(async () => {
      canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(send).toHaveBeenCalledWith({ kind: "key", key: "enter" });

    const clipboardEvent = new Event("paste", { bubbles: true });
    Object.defineProperty(clipboardEvent, "clipboardData", {
      value: { getData: () => "مرحبا Relay" },
    });
    await act(async () => {
      canvas.dispatchEvent(clipboardEvent);
    });
    expect(send).toHaveBeenCalledWith({ kind: "key", key: "enter", text: "مرحبا Relay" });
  });

  it("keeps three target views independently addressable", async () => {
    const entries = [
      { title: "Checkout browser", detail: "Account A", send: vi.fn(async () => true) },
      { title: "Checkout browser", detail: "Account B", send: vi.fn(async () => true) },
      { title: "Checkout browser", detail: "Account C", send: vi.fn(async () => true) },
    ];
    const host = mountCanvas(entries);
    const canvases = [...host.querySelectorAll("canvas")];
    const inputs = [...host.querySelectorAll("input")];
    expect(canvases).toHaveLength(3);
    expect(inputs).toHaveLength(3);
    expect(new Set(inputs.map((input) => input.id)).size).toBe(3);
    expect(canvases.map((canvas) => canvas.getAttribute("aria-label"))).toEqual([
      "Interactive live target: Checkout browser",
      "Interactive live target: Checkout browser",
      "Interactive live target: Checkout browser",
    ]);
    expect(host.textContent).toContain("Account A");
    expect(host.textContent).toContain("Account B");
    expect(host.textContent).toContain("Account C");

    await act(async () => {
      canvases[1]?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(entries[0].send).not.toHaveBeenCalled();
    expect(entries[1].send).toHaveBeenCalledWith({ kind: "key", key: "enter" });
    expect(entries[2].send).not.toHaveBeenCalled();
  });
});
