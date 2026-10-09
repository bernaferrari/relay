/** @jsxImportSource react */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MapFrameTitle } from "./map-frame-title";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const event = (type: string) => new MouseEvent(type, { bubbles: true, cancelable: true });

async function render(canEdit?: () => boolean) {
  const select = vi.fn();
  const startDrag = vi.fn();
  await act(async () =>
    root.render(
      <div onClick={select} onPointerDown={startDrag}>
        <MapFrameTitle title="Settings" onRename={async () => undefined} canEdit={canEdit} />
      </div>,
    ),
  );
  return { select, startDrag };
}

describe("canvas title gestures", () => {
  it("lets selection and dragging reach the canvas, and renames only on double-click", async () => {
    const { select, startDrag } = await render();
    const title = host.querySelector("button")!;
    await act(async () => {
      title.dispatchEvent(event("pointerdown"));
      title.click();
    });
    expect(select).toHaveBeenCalledOnce();
    expect(startDrag).toHaveBeenCalledOnce();
    expect(host.querySelector("input")).toBeNull();
    await act(async () => title.dispatchEvent(event("dblclick")));
    expect(host.querySelector("input")).not.toBeNull();
  });

  it("dismisses on an outside pointerdown even when the canvas prevents default", async () => {
    await render();
    await act(async () => host.querySelector("button")!.dispatchEvent(event("dblclick")));
    const canvas = document.createElement("div");
    canvas.addEventListener("pointerdown", (e) => e.preventDefault());
    document.body.append(canvas);
    await act(async () => canvas.dispatchEvent(event("pointerdown")));
    expect(host.querySelector("input")).toBeNull();
    canvas.remove();
  });

  it("does not enter rename mode after a suppressed drag gesture", async () => {
    await render(() => false);
    await act(async () => host.querySelector("button")!.dispatchEvent(event("dblclick")));
    expect(host.querySelector("input")).toBeNull();
  });
});
