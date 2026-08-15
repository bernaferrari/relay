import { expect, test, vi } from "vitest";
import { render } from "solid-js/web";
import type { SnapshotState } from "../context/server";
import type { InteractiveStep } from "../lib/server-interaction";
import { AppMapTestDevicePanel } from "./app-map-test-device-panel";

const ready = { kind: "ready" } as const;
const frame = {
  base64: "pixel-data",
  mime: "image/png",
  caption: "live",
  capturedAt: 1,
  width: 1080,
  height: 2400,
};

function pointer(type: string, input: { x: number; y: number; id?: number }) {
  const event = new PointerEvent(type, { bubbles: true, button: 0 });
  Object.defineProperties(event, {
    clientX: { value: input.x },
    clientY: { value: input.y },
    pointerId: { value: input.id ?? 1 },
  });
  return event;
}

function renderPanel(input: {
  onInteract: (step: InteractiveStep) => Promise<boolean>;
  blocker?: string;
  snapshot?: SnapshotState;
  platform?: "android" | "ios";
  customFrame?: typeof frame;
  capture?: {
    busy: boolean;
    disabledReason?: string;
    policy?: {
      captureMode: "viewport" | "full-surface";
      source: "default" | "recommended" | "explicit";
      reason: string;
      decidedAt: number;
    };
    hasSurface: boolean;
    onCapture: () => void;
  };
}) {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const dispose = render(
    () => (
      <AppMapTestDevicePanel
        frame={input.customFrame ?? frame}
        snapshot={input.snapshot}
        platform={input.platform ?? "android"}
        deviceSelected
        deviceName="Phone"
        readiness={ready}
        offline={false}
        refreshing={false}
        interacting={false}
        interactionBlocker={input.blocker}
        fullPageCapture={input.capture}
        error=""
        onRefresh={() => undefined}
        onInteract={input.onInteract}
      />
    ),
    root,
  );
  const surface = root.querySelector<HTMLElement>(
    "[data-testid='test-device-interaction-surface']",
  )!;
  surface.getBoundingClientRect = () =>
    ({ left: 10, top: 20, width: 200, height: 400, right: 210, bottom: 420 }) as DOMRect;
  return { root, surface, dispose };
}

test("device preview maps one pointer tap through the logical device bounds", async () => {
  const onInteract = vi.fn(async () => true);
  const view = renderPanel({
    onInteract,
    snapshot: {
      capturedAt: 1,
      nodes: [],
      interactive: [],
      bounds: { width: 360, height: 800 },
    },
  });

  view.surface.dispatchEvent(pointer("pointerdown", { x: 60, y: 320 }));
  view.surface.dispatchEvent(pointer("pointerup", { x: 60, y: 320 }));
  await Promise.resolve();

  expect(onInteract).toHaveBeenCalledTimes(1);
  expect(onInteract).toHaveBeenCalledWith({ kind: "point", x: 90, y: 600 });
  view.dispose();
});

test("device preview always exposes full-page capture", () => {
  const view = renderPanel({ onInteract: async () => true });
  const action = view.root.querySelector<HTMLButtonElement>("[data-scroll-surface-capture]");
  expect(action).not.toBeNull();
  expect(action?.textContent).toContain("Capture full page");
  expect(action?.disabled).toBe(true);
  view.dispose();
});

test("device preview highlights and runs a recommended full-page capture", () => {
  const onCapture = vi.fn();
  const view = renderPanel({
    onInteract: async () => true,
    capture: {
      busy: false,
      hasSurface: false,
      policy: {
        captureMode: "full-surface",
        source: "recommended",
        reason: "This page scrolls.",
        decidedAt: 1,
      },
      onCapture,
    },
  });
  const action = view.root.querySelector<HTMLButtonElement>("[data-scroll-surface-capture]")!;
  expect(action.disabled).toBe(false);
  expect(action.dataset.recommended).toBe("true");
  expect(action.textContent).toContain("Recommended");
  expect(view.root.textContent).toContain("This page scrolls.");
  action.click();
  expect(onCapture).toHaveBeenCalledTimes(1);
  view.dispose();
});

test("device preview applies the inverse iOS presentation rotation", async () => {
  const onInteract = vi.fn(async () => true);
  const view = renderPanel({
    onInteract,
    platform: "ios",
    customFrame: { ...frame, width: 100, height: 200 },
    snapshot: {
      capturedAt: 1,
      nodes: [{ depth: 0, rect: { x: 0, y: 0, width: 200, height: 100 } }],
      interactive: [],
      bounds: { width: 200, height: 100 },
    },
  });

  view.surface.dispatchEvent(pointer("pointerdown", { x: 60, y: 320 }));
  view.surface.dispatchEvent(pointer("pointerup", { x: 60, y: 320 }));
  await Promise.resolve();

  expect(onInteract).toHaveBeenCalledWith({ kind: "point", x: 50, y: 25 });
  view.dispose();
});

test("device preview uses semantic targets and remains keyboard operable", async () => {
  const onInteract = vi.fn(async () => true);
  const view = renderPanel({
    onInteract,
    snapshot: {
      capturedAt: 1,
      nodes: [
        {
          label: "Settings",
          identifier: "settings_button",
          hittable: true,
          rect: { x: 72, y: 560, width: 72, height: 80 },
        },
      ],
      interactive: [],
      bounds: { width: 360, height: 800 },
    },
  });

  view.surface.dispatchEvent(pointer("pointerdown", { x: 70, y: 320 }));
  view.surface.dispatchEvent(pointer("pointerup", { x: 70, y: 320 }));
  await Promise.resolve();
  expect(onInteract).toHaveBeenLastCalledWith({
    kind: "identifier",
    identifier: "settings_button",
    point: { x: 108, y: 600 },
  });

  view.surface.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await Promise.resolve();
  expect(onInteract).toHaveBeenCalledTimes(2);
  expect(view.surface.tabIndex).toBe(0);
  view.dispose();
});

test("device preview blocks view-only taps and ignores drags and unmatched pointer ups", async () => {
  const blockedInteract = vi.fn(async () => true);
  const blocked = renderPanel({
    onInteract: blockedInteract,
    blocker: "Another user has control.",
  });
  blocked.surface.dispatchEvent(pointer("pointerdown", { x: 60, y: 320 }));
  blocked.surface.dispatchEvent(pointer("pointerup", { x: 60, y: 320 }));
  blocked.surface.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await Promise.resolve();
  expect(blockedInteract).not.toHaveBeenCalled();
  expect(blocked.surface.getAttribute("aria-disabled")).toBe("true");
  expect(blocked.surface.getAttribute("title")).toBeNull();
  expect(blocked.surface.className).not.toContain("opacity-");
  expect(blocked.root.textContent).toContain("View only · Another user has control.");
  blocked.dispose();

  const onInteract = vi.fn(async () => true);
  const view = renderPanel({ onInteract });
  view.surface.dispatchEvent(pointer("pointerdown", { x: 40, y: 80 }));
  view.surface.dispatchEvent(pointer("pointerup", { x: 90, y: 180 }));
  view.surface.dispatchEvent(pointer("pointerup", { x: 40, y: 80 }));
  await Promise.resolve();
  expect(onInteract).not.toHaveBeenCalled();
  view.dispose();
});
