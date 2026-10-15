/** @jsxImportSource react */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserWorkspacePage } from "./browser-workspace-page";
import { BROWSER_WORKSPACE_KEY, type BrowserTile } from "../data/browser-workspace";
import { browserLayoutGeometry } from "../data/browser-workspace-layout";
import type { LiveTargetSession, LiveTargetSnapshot } from "../data/live-target-session";
const context = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("@tanstack/react-router", () => ({
  useRouteContext: () => context.current,
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock("./live-target-canvas", () => ({
  LiveTargetCanvas: ({
    canvasRef,
    send,
    targetTitle,
  }: {
    canvasRef: React.Ref<HTMLCanvasElement>;
    send(input: unknown): Promise<boolean>;
    targetTitle: string;
  }) => (
    <>
      <canvas ref={canvasRef} />
      <button onClick={() => void send({ kind: "navigate", url: "https://example.test" })}>
        Navigate {targetTitle}
      </button>
    </>
  ),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let client: QueryClient;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  client?.clear();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
const tiles: BrowserTile[] = ["Admin", "Member", "Guest", "Reviewer"].map((name, index) => ({
  id: name,
  browserId: name,
  name,
  accountName: name,
  ...(index === 2
    ? { identity: { signedOut: true as const } }
    : { identity: { authenticationFixtureId: `authfx:${name}:1` } }),
}));
function live(tile: BrowserTile) {
  const snapshot: LiveTargetSnapshot = {
    status: "streaming",
    target: { kind: "browser", platform: "browser", targetId: tile.browserId },
  };
  return {
    snapshot: () => snapshot,
    mount: vi.fn(() => vi.fn()),
    subscribe: vi.fn(() => vi.fn()),
    close: vi.fn(),
    input: vi.fn(async () => {}),
  } satisfies LiveTargetSession;
}
async function settle() {
  for (let i = 0; i < 4; i++)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
}
async function click(label: string, pointer = false) {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.getAttribute("aria-label") === label || item.textContent === label,
  );
  if (!button) throw new Error(`Missing ${label}`);
  await act(async () => {
    if (pointer) button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    else button.click();
  });
  await settle();
}
async function setup(
  options: {
    initial?: BrowserTile[];
    preview?: (target: { targetId: string }, identity?: unknown) => Promise<LiveTargetSession>;
    storageError?: boolean;
  } = {},
) {
  const sessions = new Map(tiles.map((tile) => [tile.id, live(tile)]));
  const values = new Map([[BROWSER_WORKSPACE_KEY, JSON.stringify(options.initial ?? tiles)]]);
  const preview = vi.fn(
    options.preview ?? (async (target: { targetId: string }) => sessions.get(target.targetId)!),
  );
  context.current = {
    platform: {
      storage: {
        get: (key: string) => values.get(key) ?? null,
        set: (key: string, value: string) => {
          if (options.storageError) throw new Error("Storage full");
          values.set(key, value);
        },
      },
    },
    browserSpacesService: {
      listSpaces: async () =>
        tiles.map((tile) => ({ id: tile.id, name: tile.name, startUrl: "https://example.test" })),
    },
    productService: { previewTarget: preview },
  };
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const render = async () => {
    await act(async () =>
      root!.render(
        <QueryClientProvider client={client}>
          <BrowserWorkspacePage />
        </QueryClientProvider>,
      ),
    );
    await settle();
  };
  await render();
  return { sessions, values, preview, render };
}
describe("tiled browser workspace", () => {
  async function beginDock() {
    const grip = document.querySelector<HTMLButtonElement>('button[aria-label="Move Guest"]')!;
    const target = document.querySelector<HTMLElement>('[data-browser-tile="Member"]')!;
    const header = grip.closest("header")!;
    header.setPointerCapture = vi.fn();
    header.hasPointerCapture = () => true;
    header.releasePointerCapture = vi.fn();
    target.getBoundingClientRect = () => new DOMRect(500, 0, 500, 350);
    vi.spyOn(document, "elementFromPoint").mockReturnValue(target);
    await act(async () =>
      grip.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          pointerId: 1,
          clientX: 200,
          clientY: 400,
        }),
      ),
    );
    await act(async () =>
      grip.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: 750, clientY: 4 }),
      ),
    );
    return grip;
  }
  it("previews all four inset borders, docks vertically, and restores the saved layout without reconnecting", async () => {
    const { sessions, values, preview, render } = await setup();
    const canvases = [...document.querySelectorAll("canvas")];
    const grip = await beginDock();
    const destination = document.querySelector('[data-dock-side="top"]')!;
    expect(destination.getAttribute("aria-label")).toBe("Guest: above Member");
    expect((destination as HTMLElement).style.getPropertyValue("--dock-left")).toContain("12px");
    expect(destination.className).toContain("border-2");
    expect(grip.getAttribute("aria-pressed")).toBe("true");
    expect(
      document.querySelector<HTMLElement>('[data-browser-tile="Guest"]')!.style.transform,
    ).toContain("translate(550px, -396px)");
    await act(async () =>
      grip.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, pointerId: 1, clientX: 750, clientY: 4 }),
      ),
    );
    await settle();
    expect(document.querySelector("[data-dock-side]")).toBeNull();
    const stored = JSON.parse(values.get(BROWSER_WORKSPACE_KEY)!);
    const positions = browserLayoutGeometry(stored.layout).tiles;
    expect(positions.Guest!.y + positions.Guest!.height).toBe(positions.Member!.y);
    expect([...document.querySelectorAll("canvas")]).toEqual(canvases);
    expect(preview).toHaveBeenCalledTimes(4);
    for (const session of sessions.values()) {
      expect(session.close).not.toHaveBeenCalled();
      expect(session.input).not.toHaveBeenCalled();
    }
    await act(async () => root!.render(<span />));
    await render();
    expect(
      document
        .querySelector<HTMLElement>('[data-browser-tile="Member"]')!
        .style.getPropertyValue("--tile-top"),
    ).toContain(`${positions.Member!.y}%`);
    expect(preview).toHaveBeenCalledTimes(8);
  });
  it("cancels a docking gesture with Escape and preserves the existing layout on storage failure", async () => {
    const { values, sessions } = await setup({ storageError: true });
    const original = values.get(BROWSER_WORKSPACE_KEY);
    let grip = await beginDock();
    await act(async () =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(document.querySelector("[data-dock-side]")).toBeNull();
    expect(grip.getAttribute("aria-pressed")).toBe("false");
    await act(async () =>
      grip.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, pointerId: 1, clientX: 750, clientY: 4 }),
      ),
    );
    expect(values.get(BROWSER_WORKSPACE_KEY)).toBe(original);
    grip = await beginDock();
    await act(async () =>
      grip.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, pointerId: 1, clientX: 750, clientY: 4 }),
      ),
    );
    await settle();
    expect(document.body.textContent).toContain("Couldn’t save this workspace");
    expect(values.get(BROWSER_WORKSPACE_KEY)).toBe(original);
    expect(
      document
        .querySelector<HTMLElement>('[data-browser-tile="Member"]')!
        .style.getPropertyValue("--tile-top"),
    ).toBe("calc(0% + 0px)");
    for (const session of sessions.values()) expect(session.close).not.toHaveBeenCalled();
  });

  it("reverses expansion from its current position without reconnecting live browsers", async () => {
    const { sessions, preview } = await setup();
    const elements = [...document.querySelectorAll<HTMLElement>("[data-browser-tile]")];
    const animations: { cancel: ReturnType<typeof vi.fn>; frames: Keyframe[] }[] = [];
    let interrupted: DOMRect | undefined;
    for (const [index, element] of elements.entries()) {
      element.getBoundingClientRect = () => {
        if (
          element.dataset.browserTile === "Member" &&
          interrupted &&
          elements.some((tile) => tile.hidden)
        )
          return interrupted;
        return elements.filter((tile) => !tile.hidden).length === 1
          ? new DOMRect(0, 0, 1000, 700)
          : new DOMRect((index % 2) * 500, Math.floor(index / 2) * 350, 500, 350);
      };
      element.animate = vi.fn((frames) => {
        const animation = { cancel: vi.fn(), frames: frames as Keyframe[] };
        animations.push(animation);
        return animation as unknown as Animation;
      });
    }
    await click("Expand Member", true);
    expect(animations).toHaveLength(1);
    expect(document.querySelectorAll("section[hidden]")).toHaveLength(3);
    interrupted = new DOMRect(100, 50, 800, 600);
    await click("Restore Member", true);
    expect(animations[0]!.cancel).toHaveBeenCalledOnce();
    expect(animations[2]!.frames[0]!.transform).toContain("translate(-400px, 50px)");
    expect(document.querySelectorAll("section[hidden]")).toHaveLength(0);
    expect(preview).toHaveBeenCalledTimes(4);
    for (const session of sessions.values()) expect(session.close).not.toHaveBeenCalled();
    await act(async () => root!.unmount());
    root = undefined;
    for (const animation of animations) expect(animation.cancel).toHaveBeenCalledOnce();
  });
  it("expands immediately when reduced motion is enabled", async () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList);
    await setup();
    const animate = vi.fn();
    for (const element of document.querySelectorAll<HTMLElement>("[data-browser-tile]")) {
      element.getBoundingClientRect = () => new DOMRect(0, 0, 500, 350);
      element.animate = animate;
    }
    await click("Expand Admin", true);
    expect(document.querySelectorAll("section[hidden]")).toHaveLength(3);
    await click("Show all", true);
    expect(document.querySelectorAll("section[hidden]")).toHaveLength(0);
    expect(animate).not.toHaveBeenCalled();
  });
  it("keeps four exact identities mounted through expand, restore and column resizing", async () => {
    const { sessions, preview } = await setup();
    expect(preview.mock.calls).toEqual(
      tiles.map((tile) => [
        { kind: "browser", platform: "browser", targetId: tile.browserId },
        tile.identity,
      ]),
    );
    await click("Expand Admin");
    expect(document.querySelectorAll("section[hidden]")).toHaveLength(3);
    await click("Show all");
    const separator = document.querySelector('[role="separator"]')!;
    await act(async () =>
      separator.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
    );
    expect(separator.getAttribute("aria-valuenow")).toBe("55");
    const grip = document.querySelector('button[aria-label="Move Admin"]')!;
    await act(async () =>
      grip.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
    );
    await settle();
    expect(
      [...document.querySelectorAll("[data-browser-tile]")].map((item) =>
        item.getAttribute("data-browser-tile"),
      ),
    ).toEqual(["Member", "Admin", "Guest", "Reviewer"]);
    expect(document.body.textContent).toContain("Admin moved to position 2");
    expect(preview).toHaveBeenCalledTimes(4);
    for (const session of sessions.values()) expect(session.close).not.toHaveBeenCalled();
    await click("Navigate Member");
    expect(sessions.get("Member")!.input).toHaveBeenCalledOnce();
    expect(sessions.get("Admin")!.input).not.toHaveBeenCalled();
  });
  it("removes only the chosen observation and restores remaining profiles after remount", async () => {
    const { sessions, values, preview, render } = await setup();
    await click("Remove Guest from workspace");
    expect(sessions.get("Guest")!.close).toHaveBeenCalledOnce();
    expect(sessions.get("Admin")!.close).not.toHaveBeenCalled();
    expect(JSON.parse(values.get(BROWSER_WORKSPACE_KEY)!).tiles).toEqual(
      tiles.filter((tile) => tile.id !== "Guest"),
    );
    await act(async () =>
      root!.render(
        <QueryClientProvider client={client}>
          <span />
        </QueryClientProvider>,
      ),
    );
    await render();
    expect(preview).toHaveBeenCalledTimes(7);
    expect(document.querySelectorAll("canvas")).toHaveLength(3);
  });
  it("does not remove a live tile when saving the layout fails", async () => {
    const { sessions } = await setup({ storageError: true });
    await click("Remove Guest from workspace");
    expect(document.body.textContent).toContain("Couldn’t save this workspace");
    expect(document.querySelectorAll("canvas")).toHaveLength(4);
    expect(sessions.get("Guest")!.close).not.toHaveBeenCalled();
  });
  it("closes a preview that resolves after its tile is removed", async () => {
    let resolve!: (session: LiveTargetSession) => void;
    const next = live(tiles[0]!);
    await setup({
      initial: [tiles[0]!],
      preview: () =>
        new Promise((done) => {
          resolve = done;
        }),
    });
    await click("Remove Admin from workspace");
    await act(async () => resolve(next));
    expect(next.close).toHaveBeenCalledOnce();
    expect(next.mount).not.toHaveBeenCalled();
  });
});
