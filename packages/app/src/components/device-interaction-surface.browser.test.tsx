import { expect, test, vi } from "vitest";
import { render } from "solid-js/web";
import { DeviceInteractionSurface } from "./device-interaction-surface";

function pointer(
  type: string,
  input: { x: number; y: number; id?: number; button?: number },
): PointerEvent {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    button: input.button ?? 0,
  });
  Object.defineProperties(event, {
    clientX: { value: input.x },
    clientY: { value: input.y },
    pointerId: { value: input.id ?? 1 },
  });
  return event;
}

function mount(input?: {
  source?: { width: number; height: number };
  rotation?: "none" | "left" | "right";
  disabled?: boolean;
  viewOnly?: boolean;
}) {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const onTap = vi.fn();
  const onSwipe = vi.fn();
  const onGesture = vi.fn();
  const onCursorKey = vi.fn();
  const onWheel = vi.fn();
  const dispose = render(
    () => (
      <DeviceInteractionSurface
        sourceDimensions={() => input?.source ?? { width: 200, height: 100 }}
        rotation={() => input?.rotation ?? "none"}
        disabled={() => input?.disabled ?? false}
        viewOnly={() => input?.viewOnly ?? false}
        onTap={onTap}
        onSwipe={onSwipe}
        onGesture={onGesture}
        onCursorKey={onCursorKey}
        onWheel={onWheel}
      />
    ),
    root,
  );
  const surface = root.querySelector<HTMLDivElement>("[data-device-interaction-surface]")!;
  surface.getBoundingClientRect = () =>
    ({ left: 10, top: 20, width: 200, height: 400, right: 210, bottom: 420 }) as DOMRect;
  return { dispose, onCursorKey, onGesture, onSwipe, onTap, onWheel, root, surface };
}

test("one transparent surface maps a tap through object-contain pixels, not letterboxing", () => {
  const view = mount();

  // Source is landscape in a portrait host, so y=40 is an empty letterbox.
  view.surface.dispatchEvent(pointer("pointerdown", { x: 60, y: 40 }));
  view.surface.dispatchEvent(pointer("pointerup", { x: 60, y: 40 }));
  expect(view.onTap).not.toHaveBeenCalled();

  view.surface.dispatchEvent(pointer("pointerdown", { x: 60, y: 195 }));
  view.surface.dispatchEvent(pointer("pointerup", { x: 60, y: 195 }));
  expect(view.onTap).toHaveBeenCalledWith({
    point: { displayed: { x: 0.25, y: 0.25 }, logical: { x: 0.25, y: 0.25 } },
    source: "pointer",
  });
  expect(view.onGesture).toHaveBeenCalledWith({
    phase: "down",
    point: { displayed: { x: 0.25, y: 0.25 }, logical: { x: 0.25, y: 0.25 } },
    start: { displayed: { x: 0.25, y: 0.25 }, logical: { x: 0.25, y: 0.25 } },
    pointerId: 1,
  });
  view.dispose();
});

test("a drag produces one normalized swipe and preserves its valid end at the edge", () => {
  const view = mount({ source: { width: 200, height: 400 } });
  view.surface.dispatchEvent(pointer("pointerdown", { x: 40, y: 60 }));
  view.surface.dispatchEvent(pointer("pointermove", { x: 260, y: 460 }));
  view.surface.dispatchEvent(pointer("pointerup", { x: 260, y: 460 }));

  expect(view.onTap).not.toHaveBeenCalled();
  expect(view.onSwipe).toHaveBeenCalledTimes(1);
  expect(view.onSwipe.mock.calls[0]?.[0]).toMatchObject({
    start: { displayed: { x: 0.15, y: 0.1 }, logical: { x: 0.15, y: 0.1 } },
    end: { displayed: { x: 1, y: 1 }, logical: { x: 1, y: 1 } },
  });
  expect(view.onGesture.mock.calls.map(([event]) => event.phase)).toEqual(["down", "move", "up"]);
  view.dispose();
});

test("wheel input uses the same logical surface and one CSS-pixel unit", () => {
  const view = mount();
  const event = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperties(event, {
    clientX: { value: 60 },
    clientY: { value: 195 },
    deltaX: { value: 3 },
    deltaY: { value: 4 },
    deltaMode: { value: 1 },
  });
  view.surface.dispatchEvent(event);

  expect(view.onWheel).toHaveBeenCalledWith({
    point: { displayed: { x: 0.25, y: 0.25 }, logical: { x: 0.25, y: 0.25 } },
    deltaX: 48,
    deltaY: 64,
  });
  view.dispose();
});

test("the compatibility click path cannot duplicate an already-finished pointer tap", () => {
  const view = mount();
  view.surface.dispatchEvent(pointer("pointerdown", { x: 60, y: 195 }));
  view.surface.dispatchEvent(pointer("pointerup", { x: 60, y: 195 }));
  view.surface.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true, clientX: 60, clientY: 195 }),
  );
  expect(view.onTap).toHaveBeenCalledTimes(1);
  view.dispose();
});

test("the surface maps iPad rotation once for pointer and keyboard input", () => {
  const view = mount({ source: { width: 100, height: 200 }, rotation: "left" });
  view.surface.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100 }) as DOMRect;

  view.surface.dispatchEvent(pointer("pointerdown", { x: 40, y: 70 }));
  view.surface.dispatchEvent(pointer("pointerup", { x: 40, y: 70 }));
  expect(view.onTap).toHaveBeenCalledWith({
    point: { displayed: { x: 0.2, y: 0.7 }, logical: { x: 0.30000000000000004, y: 0.2 } },
    source: "pointer",
  });

  view.surface.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
  view.surface.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  expect(view.onCursorKey).toHaveBeenCalledWith({
    key: "ArrowLeft",
    point: { displayed: { x: 0.48, y: 0.5 }, logical: { x: 0.5, y: 0.48 } },
    step: 0.02,
  });
  expect(view.onTap).toHaveBeenLastCalledWith({
    point: { displayed: { x: 0.48, y: 0.5 }, logical: { x: 0.5, y: 0.48 } },
    source: "keyboard",
  });
  view.dispose();
});

test("view-only and disabled preview pixels never create device actions", () => {
  for (const state of [{ viewOnly: true }, { disabled: true }]) {
    const view = mount(state);
    view.surface.dispatchEvent(pointer("pointerdown", { x: 60, y: 195 }));
    view.surface.dispatchEvent(pointer("pointerup", { x: 60, y: 195 }));
    view.surface.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(view.onTap).not.toHaveBeenCalled();
    expect(view.onSwipe).not.toHaveBeenCalled();
    expect(view.surface.tabIndex).toBe(-1);
    expect(view.surface.getAttribute("aria-disabled")).toBe("true");
    expect(view.surface.dataset.deviceInteractionState).toBe(
      state.viewOnly ? "view-only" : "disabled",
    );
    view.dispose();
  }
});
