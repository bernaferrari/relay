/** @jsxImportSource react */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LiveTargetSession, LiveTargetSnapshot } from "../data/live-target-session";
import { LiveTargetCanvas } from "./live-target-canvas";
import { useDevicePreviewSession } from "./use-device-preview-session";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

const target = { kind: "device", platform: "ios", targetId: "ipad" } as const;
function preview() {
  let listener: ((snapshot: LiveTargetSnapshot) => void) | undefined;
  const unmount = vi.fn();
  const unsubscribe = vi.fn();
  const session: LiveTargetSession = {
    snapshot: () => ({ target, status: "connecting" }),
    subscribe: (next) => {
      listener = next;
      next({ target, status: "connecting" });
      // Retain the callback to exercise a frame already queued before unsubscribe.
      return unsubscribe;
    },
    mount: vi.fn(() => unmount),
    input: vi.fn(async () => {}),
    close: vi.fn(),
    setAccessibilityInspection: vi.fn(),
  };
  return {
    session,
    unmount,
    unsubscribe,
    ready: () => listener?.({ target, status: "streaming", frameSequence: 1 }),
  };
}

type Availability = "ready" | "needs-attention" | "query-error";
async function harness(
  createPreview: NonNullable<Parameters<typeof useDevicePreviewSession>[0]["createPreview"]>,
) {
  let current!: ReturnType<typeof useDevicePreviewSession>;
  function Probe({ availability, canvasKey }: { availability: Availability; canvasKey: string }) {
    const [snapshot, setSnapshot] = useState<Omit<LiveTargetSnapshot, "target">>({
      status: "idle",
    });
    current = useDevicePreviewSession({
      enabled: availability === "ready",
      target,
      attempt: 0,
      createPreview,
      inspectAccessibility: true,
      onSnapshot: setSnapshot,
    });
    return (
      <>
        <output>{snapshot.status}</output>
        {snapshot.issue ? <p role="alert">{snapshot.issue}</p> : null}
        {availability === "ready" ? (
          <LiveTargetCanvas
            key={canvasKey}
            canvasRef={current.canvas}
            onCanvasChange={current.onCanvasChange}
            status={snapshot.status}
            busy={false}
            targetTitle="iPad"
            targetDetail=""
            targetPlatform="ios"
            send={async () => true}
            recording={false}
          />
        ) : null}
      </>
    );
  }
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  async function render(availability: Availability = "ready", canvasKey = "first") {
    await act(async () =>
      root!.render(<Probe availability={availability} canvasKey={canvasKey} />),
    );
  }
  await render();
  return {
    host,
    render,
    get current() {
      return current;
    },
    get canvas() {
      return host.querySelector<HTMLCanvasElement>("canvas")!;
    },
    get status() {
      return host.querySelector("output")?.textContent;
    },
  };
}

describe("DevicePage preview canvas lifetime", () => {
  it.each(["needs-attention", "query-error"] as const)(
    "starts a fresh preview after ready → %s → ready with the same discovered target",
    async (unavailable) => {
      const first = preview();
      const second = preview();
      const createPreview = vi.fn(async () => second.session).mockResolvedValueOnce(first.session);
      const view = await harness(createPreview);
      const firstCanvas = view.canvas;
      await act(async () => first.ready());
      expect(view.canvas.tabIndex).toBe(0);

      await view.render(unavailable);
      expect(first.session.close).toHaveBeenCalledOnce();
      expect(first.unmount).toHaveBeenCalledOnce();
      expect(first.unsubscribe).toHaveBeenCalledOnce();
      expect(view.current.session.current).toBeUndefined();
      expect(view.current.canvas.current).toBeNull();
      expect(view.status).toBe("idle");

      await view.render();
      expect(createPreview).toHaveBeenCalledTimes(2);
      expect(createPreview).toHaveBeenNthCalledWith(1, target);
      expect(createPreview).toHaveBeenNthCalledWith(2, target);
      expect(view.canvas).not.toBe(firstCanvas);
      expect(second.session.mount).toHaveBeenCalledExactlyOnceWith(view.canvas);
      expect(view.status).toBe("connecting");
      expect(view.canvas.tabIndex).toBe(-1);
      await act(async () => first.ready());
      expect(view.status).toBe("connecting");
      await act(async () => second.ready());
      expect(view.canvas.tabIndex).toBe(0);
    },
  );

  it("replaces the session when only the rendered canvas changes", async () => {
    const first = preview();
    const second = preview();
    const createPreview = vi.fn(async () => second.session).mockResolvedValueOnce(first.session);
    const view = await harness(createPreview);
    const firstCanvas = view.canvas;
    await act(async () => first.ready());

    await view.render("ready", "replacement");
    expect(first.session.close).toHaveBeenCalledOnce();
    expect(createPreview).toHaveBeenCalledTimes(2);
    expect(view.canvas).not.toBe(firstCanvas);
    expect(second.session.mount).toHaveBeenCalledExactlyOnceWith(view.canvas);
    expect(view.status).toBe("connecting");
    expect(view.canvas.tabIndex).toBe(-1);
    await act(async () => first.ready());
    expect(view.status).toBe("connecting");
    await act(async () => second.ready());
    expect(view.status).toBe("streaming");
    await view.render("ready", "replacement");
    expect(createPreview).toHaveBeenCalledTimes(2);
  });

  it("closes late session creation without attaching it to the replacement canvas", async () => {
    const first = preview();
    const second = preview();
    let finish!: (session: LiveTargetSession) => void;
    const pending = new Promise<LiveTargetSession>((resolve) => {
      finish = resolve;
    });
    const createPreview = vi.fn(async () => second.session).mockReturnValueOnce(pending);
    const view = await harness(createPreview);
    await view.render("ready", "replacement");
    expect(second.session.mount).toHaveBeenCalledExactlyOnceWith(view.canvas);

    await act(async () => finish(first.session));
    expect(first.session.close).toHaveBeenCalledOnce();
    expect(first.session.mount).not.toHaveBeenCalled();
    expect(view.current.session.current).toBe(second.session);
    expect(view.status).toBe("connecting");
  });
});
