/** @jsxImportSource react */
import { act, Profiler, type ComponentProps } from "react";
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
  function publish(
    status: LiveTargetStatus,
    issue?: string,
    size?: { width: number; height: number },
  ) {
    if (size) {
      const canvas = mount.mock.calls[0]![0];
      canvas.width = size.width;
      canvas.height = size.height;
    }
    current = {
      status,
      target: selectedTarget,
      frameSequence: (current.frameSequence ?? 0) + 1,
      ...(issue ? { issue } : {}),
    };
    for (const listener of listeners) listener(current);
  }
  return { live, mount, subscribe, stop, unsubscribe, input, close, inspection, publish };
}

async function render(
  props: ComponentProps<typeof LiveNativeRunPreview>,
  onRender?: ComponentProps<typeof Profiler>["onRender"],
) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const preview = <LiveNativeRunPreview {...props} />;
  await act(async () =>
    root!.render(
      onRender ? (
        <Profiler id="preview" onRender={onRender}>
          {preview}
        </Profiler>
      ) : (
        preview
      ),
    ),
  );
  return host;
}

const target: NativeRunPreviewTarget = { platform: "ios", targetId: "device-A" };
const fallback = <img src="/retained-run.png" alt="Saved run screenshot" />;

it.each(["ios", "android"] as const)(
  "keeps the mounted %s canvas for the first landscape tablet frame and later rotation",
  async (platform) => {
    const selected = { ...target, platform };
    const preview = session(selected);
    context.productService.previewTarget.mockResolvedValue(preview.live);
    const onRender = vi.fn();
    const host = await render({ target: selected }, onRender);
    const mounted = preview.mount.mock.calls[0]![0];
    expect(host.querySelector("canvas")).toBe(mounted);

    for (const size of [
      { width: 2224, height: 1668 },
      { width: 1668, height: 2224 },
    ]) {
      await act(async () => preview.publish("streaming", undefined, size));
      expect(host.querySelector("canvas")).toBe(mounted);
      expect(mounted.isConnected).toBe(true);
      expect(mounted.width).toBe(size.width);
      expect(mounted.height).toBe(size.height);
      expect(mounted.closest("figure")?.dataset.shape).toBe("tablet");
      const sizing = host.querySelector<HTMLElement>('[style*="--native-preview-ratio"]')!;
      expect(sizing.style.getPropertyValue("--native-preview-ratio")).toBe(
        String(size.width / size.height),
      );
      expect(host.querySelector('[data-slot="device-frame-window-chrome"]')).toBeNull();
      expect(preview.mount).toHaveBeenCalledExactlyOnceWith(mounted);
      expect(preview.stop).not.toHaveBeenCalled();
      expect(preview.close).not.toHaveBeenCalled();
      expect(preview.input).not.toHaveBeenCalled();
      await act(async () => preview.publish("streaming", undefined, size));
      const commits = onRender.mock.calls.length;
      for (let frame = 0; frame < 3; frame += 1) {
        await act(async () => preview.publish("streaming", undefined, size));
        expect(onRender).toHaveBeenCalledTimes(commits);
      }
    }
  },
);

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
    expect(host.querySelector('img[alt="Saved run screenshot"]')).toBeNull();
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
    await act(async () => preview.publish("streaming", undefined, { width: 2224, height: 1668 }));
    expect(host.querySelector('[aria-label="Connecting to live device preview"]')).toBeNull();
    expect(host.textContent).toContain("Live device · read only");
    expect(host.querySelector('img[alt="Saved run screenshot"]')).toBeNull();
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
    await act(async () => preview.publish("streaming", undefined, { width: 2224, height: 1668 }));
    const canvas = host.querySelector("canvas")!;
    await act(async () => preview.publish("degraded", issue));

    expect(host.textContent).toContain(title);
    expect(host.textContent).toContain("Latest captured screenshot · not live");
    expect(host.querySelector('img[alt="Saved run screenshot"]')?.getAttribute("src")).toBe(
      "/retained-run.png",
    );
    expect(canvas.closest(".hidden")).not.toBeNull();
    expect(host.textContent).not.toContain("Live device · read only");
    expect(preview.input).not.toHaveBeenCalled();

    await act(async () => preview.publish("streaming"));
    expect(host.querySelector("canvas")).toBe(canvas);
    expect(canvas.closest(".hidden")).toBeNull();
    expect(host.querySelector('img[alt="Saved run screenshot"]')).toBeNull();
    expect(host.textContent).toContain("Live device · read only");
  },
);

it("keeps an unavailable preview explicit when the run has no captured screenshot", async () => {
  context.productService.previewTarget.mockImplementation(async () => {
    throw new Error("iOS device not available");
  });
  const host = await render({ target });
  expect(host.textContent).toContain("Live view unavailable");
  expect(host.textContent).toContain("Captured screenshots will appear as the test reaches them.");
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
