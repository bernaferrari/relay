/** @jsxImportSource react */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LiveTargetInput, LiveTargetBrowserContext } from "../data/live-target-session";
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
    targetPlatform?: string;
    browserContext?: LiveTargetBrowserContext;
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
            targetPlatform={entry.targetPlatform}
            browserContext={entry.browserContext}
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
  it("groups Android navigation and sends distinct Back, Home, and Recents commands", async () => {
    const send = vi.fn(async () => true);
    const host = mountCanvas([
      { title: "Phone", detail: "Android", targetPlatform: "android", send },
    ]);
    const navigation = host.querySelector('[aria-label="Android navigation"]')!;
    expect(navigation).not.toBeNull();
    for (const label of ["Back", "Home", "Recents"]) {
      await act(async () => {
        navigation.querySelector<HTMLButtonElement>(`[aria-label="Android ${label}"]`)!.click();
      });
      expect(send).toHaveBeenLastCalledWith({ kind: "key", key: label.toLowerCase() });
    }
  });

  it("shows only known current browser facts beside the correct live target", () => {
    const host = mountCanvas([
      {
        title: "Checkout browser",
        detail: "Manual session",
        send: async () => true,
        browserContext: {
          engine: "chromium",
          viewport: { width: 1280, height: 720 },
          locale: "en-US",
          authenticationFixtureId: "checkout-qa",
        },
      },
      { title: "Connected iPad", detail: "Manual session", send: async () => true },
    ]);
    const context = host.querySelector('[aria-label="Current browser configuration"]');
    expect(context?.textContent).toContain("Chromium · 1280×720 · en-US");
    expect(context?.textContent).toContain("Account reference checkout-qa");
    expect(host.querySelectorAll('[aria-label="Current browser configuration"]')).toHaveLength(1);
    expect(host.textContent).not.toContain("profile unavailable");
  });

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

  it("retains text on failed delivery and preserves newer typing while awaiting acknowledgement", async () => {
    let acknowledge: (value: boolean) => void = () => {};
    const send = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          acknowledge = resolve;
        }),
    );
    const host = mountCanvas([{ title: "Checkout browser", detail: "Account A", send }]);
    const input = host.querySelector("input")!;
    async function fill(value: string) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
          input,
          value,
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    const button = [...host.querySelectorAll("button")].find(
      (item) => item.textContent === "Type",
    )!;
    await fill("first draft");
    await act(async () => {
      button.click();
    });
    await act(async () => {
      acknowledge(false);
    });
    expect(input.value).toBe("first draft");
    await act(async () => {
      button.click();
    });
    await fill("newer draft");
    await act(async () => {
      acknowledge(true);
    });
    expect(input.value).toBe("newer draft");
    await act(async () => {
      button.click();
    });
    await act(async () => {
      acknowledge(true);
    });
    expect(input.value).toBe("");
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
      "Interactive Device: Checkout browser",
      "Interactive Device: Checkout browser",
      "Interactive Device: Checkout browser",
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
