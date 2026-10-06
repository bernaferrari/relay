/** @jsxImportSource react */
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  LiveTargetSession,
  LiveTargetSnapshot,
  LiveTargetStatus,
} from "../data/live-target-session";
import { LiveNativeRunPreview, type NativeRunPreviewTarget } from "./live-native-run-preview";

const context = vi.hoisted(() => ({
  productService: { previewTarget: vi.fn() },
}));
vi.mock("@tanstack/react-router", () => ({ useRouteContext: () => context }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
beforeEach(() => {
  context.productService.previewTarget.mockReset();
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

function session(target: NativeRunPreviewTarget) {
  const selectedTarget = { kind: "device" as const, ...target };
  let current: LiveTargetSnapshot = { status: "connecting", target: selectedTarget };
  const listeners = new Set<(snapshot: LiveTargetSnapshot) => void>();
  const stop = vi.fn();
  const unsubscribe = vi.fn();
  const input = vi.fn(async () => {});
  const close = vi.fn();
  const inspection = vi.fn();
  const mount = vi.fn((canvas: HTMLCanvasElement) => {
    canvas.width = 1080;
    canvas.height = 1920;
    return stop;
  });
  const subscribe = vi.fn((listener: (snapshot: LiveTargetSnapshot) => void) => {
    listeners.add(listener);
    listener(current);
    return () => {
      unsubscribe();
      listeners.delete(listener);
    };
  });
  const live: LiveTargetSession = {
    snapshot: () => current,
    subscribe,
    mount,
    input,
    setAccessibilityInspection: inspection,
    close,
  };
  function publish(status: LiveTargetStatus, issue?: string) {
    current = { status, target: selectedTarget, ...(issue ? { issue } : {}) };
    for (const listener of listeners) listener(current);
  }
  return { live, mount, subscribe, stop, unsubscribe, input, close, inspection, publish };
}

async function render(props: ComponentProps<typeof LiveNativeRunPreview>) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<LiveNativeRunPreview {...props} />));
  return host;
}

const target: NativeRunPreviewTarget = { platform: "ios", targetId: "device-A" };
const fallback = <img src="/retained-run.png" alt="Saved Run screenshot" />;

it.each(["ios", "android"] as const)(
  "opens the exact %s target with inspection disabled and renders a passive streaming canvas",
  async (platform) => {
    const selected = { ...target, platform };
    const preview = session(selected);
    let connect!: (live: LiveTargetSession) => void;
    context.productService.previewTarget.mockReturnValue(
      new Promise<LiveTargetSession>((resolve) => {
        connect = resolve;
      }),
    );
    const host = await render({ target: selected, targetName: "Physical device", fallback });
    expect(context.productService.previewTarget).toHaveBeenCalledExactlyOnceWith(
      { kind: "device", platform, targetId: "device-A" },
      undefined,
    );
    const connecting = host.querySelector('[aria-label="Connecting to live device preview"]');
    expect(connecting?.getAttribute("aria-busy")).toBe("true");
    expect(host.querySelector('img[alt="Saved Run screenshot"]')).toBeNull();
    expect(preview.mount).not.toHaveBeenCalled();

    await act(async () => connect(preview.live));
    expect(preview.inspection).toHaveBeenCalledExactlyOnceWith(false);
    const canvas = host.querySelector<HTMLCanvasElement>(
      'canvas[aria-label="Live device: Physical device"]',
    )!;
    expect(preview.mount).toHaveBeenCalledExactlyOnceWith(canvas);
    const deviceFrame = canvas.closest('[data-slot="evidence-image-frame"]')!;
    expect(deviceFrame).not.toBeNull();
    const island = deviceFrame.querySelector(':scope > span[aria-hidden="true"]');
    if (platform === "android") expect(island).toBeNull();
    else expect(island).not.toBeNull();
    expect(canvas.width).toBe(1080);
    expect(canvas.height).toBe(1920);
    await act(async () => preview.publish("streaming"));
    expect(host.querySelector('[aria-label="Connecting to live device preview"]')).toBeNull();
    expect(host.textContent).toContain("Live device · read only");
    expect(host.querySelector('img[alt="Saved Run screenshot"]')).toBeNull();
    expect(
      host.querySelector("button, input, select, textarea, [contenteditable=true]"),
    ).toBeNull();
    expect(canvas.tabIndex).toBe(-1);

    await act(async () => {
      canvas.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 20, clientY: 30 }),
      );
      canvas.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, clientX: 20, clientY: 30 }),
      );
      canvas.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      canvas.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
      canvas.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Backspace" }));
    });
    expect(preview.input).not.toHaveBeenCalled();
  },
);

it.each([
  ["iOS preview producer unavailable: ios-preview:build", "Live view unavailable"],
  ["403 Forbidden", "Live view blocked"],
])(
  "labels unavailable live pixels honestly and shows retained fallback for %s",
  async (issue, title) => {
    const preview = session(target);
    context.productService.previewTarget.mockResolvedValue(preview.live);
    const host = await render({ target, fallback });
    await act(async () => preview.publish("streaming"));
    const canvas = host.querySelector("canvas")!;
    await act(async () => preview.publish("degraded", issue));

    expect(host.textContent).toContain(title);
    expect(host.textContent).toContain("Latest captured screenshot · not live");
    expect(host.querySelector('img[alt="Saved Run screenshot"]')?.getAttribute("src")).toBe(
      "/retained-run.png",
    );
    expect(canvas.closest(".hidden")).not.toBeNull();
    expect(host.textContent).not.toContain("Live device · read only");
    expect(preview.input).not.toHaveBeenCalled();

    await act(async () => preview.publish("streaming"));
    expect(host.querySelector("canvas")).toBe(canvas);
    expect(canvas.closest(".hidden")).toBeNull();
    expect(host.querySelector('img[alt="Saved Run screenshot"]')).toBeNull();
    expect(host.textContent).toContain("Live device · read only");
  },
);

it("keeps an unavailable preview explicit when the Run has no captured screenshot", async () => {
  context.productService.previewTarget.mockImplementation(async () => {
    throw new Error("iOS device not available");
  });
  const host = await render({ target });
  expect(host.textContent).toContain("Live view unavailable");
  expect(host.textContent).toContain("Captured screenshots will appear as the Test reaches them.");
  expect(host.querySelector("img")).toBeNull();
  expect(host.textContent).not.toContain("Live device · read only");
});

it.each([
  { platform: "ios" as const, targetId: "device-B" },
  { platform: "android" as const, targetId: "device-A" },
])(
  "replaces the preview for target $platform:$targetId and cleans up on unmount",
  async (nextTarget) => {
    const old = session(target);
    const replacement = session(nextTarget);
    context.productService.previewTarget
      .mockResolvedValueOnce(old.live)
      .mockResolvedValueOnce(replacement.live);
    const host = await render({ target });
    await act(async () => old.publish("streaming"));
    const oldCanvas = host.querySelector("canvas")!;
    await act(async () => root!.render(<LiveNativeRunPreview target={nextTarget} />));
    expect(context.productService.previewTarget).toHaveBeenLastCalledWith(
      { kind: "device", ...nextTarget },
      undefined,
    );
    expect(old.stop).toHaveBeenCalledOnce();
    expect(old.unsubscribe).toHaveBeenCalledOnce();
    expect(old.close).toHaveBeenCalledOnce();
    expect(replacement.inspection).toHaveBeenCalledExactlyOnceWith(false);
    const newCanvas = host.querySelector("canvas")!;
    expect(newCanvas).not.toBe(oldCanvas);
    expect(replacement.mount).toHaveBeenCalledExactlyOnceWith(newCanvas);
    await act(async () => old.publish("degraded", "Old device offline"));
    expect(host.textContent).not.toContain("Live view unavailable");
    await act(async () => replacement.publish("streaming"));
    expect(host.textContent).toContain("Live device · read only");

    await act(async () => root!.unmount());
    root = undefined;
    expect(replacement.stop).toHaveBeenCalledOnce();
    expect(replacement.unsubscribe).toHaveBeenCalledOnce();
    expect(replacement.close).toHaveBeenCalledOnce();
    expect(old.close).toHaveBeenCalledOnce();
  },
);

it.each(["replacement", "unmount"] as const)(
  "closes a late preview connection after $0 without mounting its old target",
  async (leave) => {
    const old = session(target);
    let connect!: (live: LiveTargetSession) => void;
    context.productService.previewTarget.mockReturnValueOnce(
      new Promise<LiveTargetSession>((resolve) => {
        connect = resolve;
      }),
    );
    const host = await render({ target });
    if (leave === "replacement") {
      const nextTarget = { platform: "android" as const, targetId: "device-B" };
      const next = session(nextTarget);
      context.productService.previewTarget.mockResolvedValueOnce(next.live);
      await act(async () => root!.render(<LiveNativeRunPreview target={nextTarget} />));
      await act(async () => next.publish("streaming"));
    } else {
      await act(async () => root!.unmount());
      root = undefined;
    }
    await act(async () => connect(old.live));
    expect(old.close).toHaveBeenCalledOnce();
    expect(old.mount).not.toHaveBeenCalled();
    expect(old.subscribe).not.toHaveBeenCalled();
    expect(old.inspection).not.toHaveBeenCalled();
    if (leave === "replacement") expect(host.textContent).toContain("Live device · read only");
  },
);
