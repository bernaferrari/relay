/** @jsxImportSource react */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  LiveTargetInput,
  LiveTargetBrowserContext,
  LiveTargetStatus,
} from "../data/live-target-session";
import { LiveTargetCanvas } from "./live-target-canvas";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mountCanvas(
  entries: Array<{
    issue?: string;
    busy?: boolean;
    inputEnabled?: boolean;
    busyLabel?: string;
    status?: LiveTargetStatus;
    reconnect?: () => void;
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
            status={entry.status ?? "streaming"}
            issue={entry.issue}
            busy={entry.busy ?? false}
            inputEnabled={entry.inputEnabled}
            busyLabel={entry.busyLabel}
            targetTitle={entry.title}
            targetDetail={entry.detail}
            targetPlatform={entry.targetPlatform}
            browserContext={entry.browserContext}
            send={entry.send}
            recording={false}
            overlay={<span data-testid="inspection-overlay" />}
            recoveryAction={
              entry.reconnect ? <button onClick={entry.reconnect}>Reconnect</button> : undefined
            }
          />
        ))}
      </div>,
    );
  });
  return host;
}

describe("LiveTargetCanvas", () => {
  it("retains normal typing while the previous key awaits acknowledgement", async () => {
    const sent: LiveTargetInput[] = [];
    let finish!: (delivered: boolean) => void;
    function Harness() {
      const [busy, setBusy] = useState(false);
      return (
        <LiveTargetCanvas
          canvasRef={{ current: null }}
          status="streaming"
          busy={busy}
          targetTitle="Browser"
          targetDetail=""
          targetPlatform="browser"
          recording={false}
          send={async (input) => {
            sent.push(input);
            setBusy(true);
            const result = await new Promise<boolean>((resolve) => {
              finish = resolve;
            });
            setBusy(false);
            return result;
          }}
        />
      );
    }
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<Harness />);
    });
    const canvas = host.querySelector("canvas")!;
    await act(async () => {
      canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    });
    await act(async () => {
      canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "b", bubbles: true }));
      canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "c", bubbles: true }));
    });
    expect(sent).toHaveLength(1);
    await act(async () => {
      finish(true);
    });
    expect(sent).toHaveLength(2);
    await act(async () => {
      finish(false);
    });
    expect(sent).toHaveLength(2);
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="Text to recover"]')?.value).toBe(
      "bc",
    );
  });

  it("ignores a tap starting outside the fitted image but allows an inside drag to its edge", async () => {
    const send = vi.fn().mockResolvedValue(true);
    const host = mountCanvas([{ title: "iPad", detail: "", targetPlatform: "ios", send }]);
    const canvas = host.querySelector("canvas")!;
    canvas.width = 100;
    canvas.height = 200;
    canvas.setPointerCapture = vi.fn();
    canvas.getBoundingClientRect = () => new DOMRect(20, 30, 200, 200);
    await act(async () => {
      canvas.dispatchEvent(
        new PointerEvent("pointerdown", { clientX: 40, clientY: 80, bubbles: true }),
      );
      canvas.dispatchEvent(
        new PointerEvent("pointerup", { clientX: 40, clientY: 80, bubbles: true }),
      );
    });
    expect(send).not.toHaveBeenCalled();
    await act(async () => {
      canvas.dispatchEvent(
        new PointerEvent("pointerdown", { clientX: 100, clientY: 80, bubbles: true }),
      );
      canvas.dispatchEvent(
        new PointerEvent("pointerup", { clientX: 40, clientY: 80, bubbles: true }),
      );
    });
    expect(send).toHaveBeenCalledExactlyOnceWith({
      kind: "scroll",
      x: 30,
      y: 50,
      scrollX: -30,
      scrollY: 0,
    });
  });

  it("never sends buffered text to a replacement preview session", async () => {
    let finish!: (delivered: boolean) => void;
    const send = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    const render = (scope: string) => (
      <LiveTargetCanvas
        canvasRef={{ current: null }}
        status="streaming"
        busy={false}
        targetTitle="Same device name"
        inputScope={scope}
        targetDetail=""
        targetPlatform="browser"
        send={send}
        recording={false}
      />
    );
    await act(async () => {
      root.render(render("first"));
    });
    const canvas = host.querySelector("canvas")!;
    await act(async () => {
      for (const key of ["a", "b"])
        canvas.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    });
    await act(async () => {
      root.render(render("replacement"));
    });
    await act(async () => {
      finish(true);
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="Text to recover"]')?.value).toBe(
      "b",
    );
    await act(async () => {
      canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "c", bubbles: true }));
    });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it.each(["sent", "not-delivered", "rejected"] as const)(
    "anchors tap feedback through resize and preserves the %s outcome",
    async (outcome) => {
      vi.useFakeTimers();
      let resize = () => {};
      vi.stubGlobal(
        "ResizeObserver",
        class {
          constructor(update: () => void) {
            resize = update;
          }
          observe() {}
          disconnect() {}
        },
      );
      let finish!: (delivered: boolean) => void;
      let fail!: (error: Error) => void;
      const send = vi.fn(
        () =>
          new Promise<boolean>((resolve, reject) => {
            finish = resolve;
            fail = reject;
          }),
      );
      const host = mountCanvas([{ title: "iPad", detail: "", targetPlatform: "ios", send }]);
      const canvas = host.querySelector("canvas")!;
      canvas.width = 100;
      canvas.height = 200;
      canvas.setPointerCapture = vi.fn();
      canvas.getBoundingClientRect = () => new DOMRect(20, 30, 200, 200);
      canvas.parentElement!.getBoundingClientRect = () => new DOMRect(10, 10, 400, 400);
      await act(async () => {
        canvas.dispatchEvent(
          new PointerEvent("pointerdown", { clientX: 95, clientY: 80, bubbles: true }),
        );
        canvas.dispatchEvent(
          new PointerEvent("pointerup", { clientX: 95, clientY: 80, bubbles: true }),
        );
      });
      expect(send).toHaveBeenCalledExactlyOnceWith({ kind: "touch", action: "up", x: 25, y: 50 });
      const marker = host.querySelector<HTMLElement>('[data-slot="live-tap-feedback"]')!;
      expect(marker.style.getPropertyValue("--tap-x")).toBe("85px");
      expect(marker.style.getPropertyValue("--tap-y")).toBe("70px");
      const indicator = marker.querySelector('[data-slot="live-tap-indicator"]');
      expect(
        marker.querySelector<HTMLElement>('[data-slot="live-tap-pending"]')!.dataset.visible,
      ).toBe("false");
      expect(marker.dataset.pending).toBe("true");
      expect(marker.dataset.state).toBe("sending");
      expect(marker.querySelector('[role="status"]')?.textContent).toBe("Sending tap…");
      expect(host.querySelector('[data-testid="inspection-overlay"]')).toBeNull();
      canvas.getBoundingClientRect = () => new DOMRect(20, 30, 400, 200);
      act(() => resize());
      expect(marker.style.getPropertyValue("--tap-x")).toBe("185px");
      act(() => vi.advanceTimersByTime(1_000));
      expect(marker.isConnected).toBe(true);
      expect(
        marker.querySelector<HTMLElement>('[data-slot="live-tap-pending"]')!.dataset.visible,
      ).toBe("true");
      await act(async () =>
        outcome === "rejected" ? fail(new Error("Not confirmed")) : finish(outcome === "sent"),
      );
      expect(marker.dataset.pending).toBe("false");
      expect(host.querySelector('[data-testid="inspection-overlay"]')).not.toBeNull();
      expect(marker.dataset.state).toBe(outcome === "sent" ? "sent" : "unconfirmed");
      expect(marker.querySelector('[role="status"]')?.textContent).toBe(
        outcome === "sent" ? "Tap sent" : "Tap not confirmed",
      );
      expect(marker.querySelector('[data-slot="live-tap-indicator"]')).toBe(indicator);
      act(() => vi.advanceTimersByTime(270));
      expect(marker.dataset.exiting).toBe("true");
      expect(marker.isConnected).toBe(true);
      act(() => vi.advanceTimersByTime(150));
      expect(marker.isConnected).toBe(false);
    },
  );
  it("keeps unproven live pixels visible while blocking pointer and keyboard input", () => {
    const send = vi.fn(async () => true);
    const host = mountCanvas([
      { title: "iPad", detail: "", targetPlatform: "ios", inputEnabled: false, send },
    ]);
    const canvas = host.querySelector("canvas")!;
    act(() => canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true })));
    expect(send).not.toHaveBeenCalled();
    expect(canvas.getAttribute("aria-disabled")).toBe("true");
    expect(host.textContent).not.toContain("Connecting to live view");
    expect(
      host.querySelector('input[placeholder="Type into the app"]')?.hasAttribute("disabled"),
    ).toBe(true);
  });
  it("shows a pending action without hiding the live screen or accepting duplicate keys", () => {
    const send = vi.fn(async () => true);
    const host = mountCanvas([
      {
        title: "iPad",
        detail: "",
        targetPlatform: "ios",
        busy: true,
        busyLabel: "Sending tap…",
        send,
      },
    ]);
    const canvas = host.querySelector("canvas")!;
    act(() => canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(send).not.toHaveBeenCalled();
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Sending tap…");
    expect(canvas.getAttribute("aria-busy")).toBe("true");
  });
  it("fits the whole device in fullscreen without replacing its canvas or sending input", async () => {
    const send = vi.fn(async () => true);
    const host = mountCanvas([
      { title: "Phone", detail: "Android", targetPlatform: "android", send },
    ]);
    const canvas = host.querySelector("canvas")!;
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="Fullscreen live control"]')!.click();
    });
    expect(send).not.toHaveBeenCalled();
    expect(canvas.className).toContain("object-contain");
    expect(host.querySelector("canvas")).toBe(canvas);
    expect(host.querySelector('dialog[role="dialog"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Exit fullscreen"]')?.getAttribute("aria-pressed")).toBe(
      "true",
    );
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="Exit fullscreen"]')!.click();
    });
    expect(host.querySelector("canvas")).toBe(canvas);
    expect(host.querySelector('dialog[role="dialog"]')).toBeNull();
  });

  it("cancels a queued scroll when changing the fullscreen layout", async () => {
    vi.useFakeTimers();
    const send = vi.fn(async () => true);
    const host = mountCanvas([
      { title: "Phone", detail: "Android", targetPlatform: "android", send },
    ]);
    const canvas = host.querySelector("canvas")!;
    canvas.width = 500;
    canvas.height = 1000;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 500, height: 1000 }) as DOMRect;
    const wheelEvent = (deltaY: number) => {
      const event = new WheelEvent("wheel", { bubbles: true, deltaY, deltaX: 0 });
      // happy-dom's WheelEvent omits inherited mouse coordinates.
      Object.defineProperties(event, { clientX: { value: 100 }, clientY: { value: 400 } });
      return event;
    };
    await act(async () => {
      canvas.dispatchEvent(wheelEvent(200));
      host.querySelector<HTMLButtonElement>('[aria-label="Fullscreen live control"]')!.click();
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(send).not.toHaveBeenCalled();
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="Exit fullscreen"]')!.click();
    });
    await act(async () => {
      canvas.dispatchEvent(wheelEvent(-200));
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("uses direct keyboard input for browsers and retains mobile text entry", async () => {
    const send = vi.fn().mockResolvedValue(true);
    const host = mountCanvas([
      { title: "Browser", detail: "", targetPlatform: "browser", send },
      { title: "Android", detail: "", targetPlatform: "android", send },
      { title: "iOS", detail: "", targetPlatform: "ios", send },
    ]);
    expect(host.querySelectorAll('input[placeholder="Type into the app"]')).toHaveLength(2);
    const canvas = host.querySelector("canvas")!;
    await act(async () => {
      canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
      canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(send).toHaveBeenCalledWith({ kind: "key", key: "enter", text: "a" });
    expect(send).toHaveBeenCalledWith({ kind: "key", key: "enter" });
  });

  it("replaces stale-frame overlays with actionable connection recovery", async () => {
    const reconnect = vi.fn();
    const host = mountCanvas([
      {
        title: "Browser",
        detail: "Chromium",
        status: "degraded",
        issue: "Failed to fetch",
        send: async () => false,
        reconnect,
      },
    ]);
    expect(host.textContent).toContain("Reconnect to restore the live view");
    expect(host.textContent).not.toContain("Failed to fetch");
    expect(host.querySelector('[data-testid="inspection-overlay"]')).toBeNull();
    expect(host.querySelector("canvas")!.tabIndex).toBe(-1);
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[role="status"] button')!.click();
    });
    expect(reconnect).toHaveBeenCalledOnce();
  });

  it("keeps interaction errors over the preview instead of adding a layout row", () => {
    const host = mountCanvas([
      {
        title: "Browser",
        detail: "Chromium",
        issue: "Interaction failed",
        send: async () => false,
      },
    ]);
    const message = host.querySelector('[role="status"]')!;
    const stage = host.querySelector("canvas")!.parentElement!;
    expect(stage.contains(message)).toBe(true);
    expect(message.parentElement!.classList.contains("absolute")).toBe(true);
  });

  it("keeps a large wheel gesture inside the preview", async () => {
    const send = vi.fn(async () => true);
    const host = mountCanvas([
      { title: "Phone", detail: "Android", targetPlatform: "android", send },
    ]);
    const canvas = host.querySelector("canvas")!;
    canvas.width = 500;
    canvas.height = 1000;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 500, height: 1000 }) as DOMRect;
    await act(async () => {
      const wheelEvent = new WheelEvent("wheel", { bubbles: true, deltaY: 2000 });
      Object.defineProperties(wheelEvent, { clientX: { value: 250 }, clientY: { value: 600 } });
      canvas.dispatchEvent(wheelEvent);
      await new Promise((resolve) => setTimeout(resolve, 170));
    });
    expect(send).toHaveBeenCalledWith({
      kind: "scroll",
      x: 250,
      y: 600,
      scrollX: 0,
      scrollY: -599,
    });
  });

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
          sessionId: "session-test",
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
      (item) => item.getAttribute("aria-label") === "Type text into app",
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
