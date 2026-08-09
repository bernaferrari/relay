import assert from "node:assert/strict";
import test from "node:test";
import {
  canvasOwnsWheel,
  canvasWheelAction,
  isCaptureScreenShortcut,
  shouldIgnoreCanvasShortcut,
} from "./app-map-events";

test("canvas wheel handling yields to scrollable overlays", () => {
  assert.equal(
    canvasOwnsWheel({ workspaceView: "map", hasCanvasContent: true, insideOverlay: false }),
    true,
  );
  assert.equal(
    canvasOwnsWheel({ workspaceView: "map", hasCanvasContent: true, insideOverlay: true }),
    false,
  );
  assert.equal(
    canvasOwnsWheel({ workspaceView: "screens", hasCanvasContent: true, insideOverlay: false }),
    false,
  );
});

const wheel = (
  overrides: Partial<Parameters<typeof canvasWheelAction>[0]> = {},
): Parameters<typeof canvasWheelAction>[0] => ({
  deltaX: 0,
  deltaY: 0,
  deltaMode: 0,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  viewportHeight: 800,
  ...overrides,
});

test("unmodified wheel input pans on both trackpad axes", () => {
  assert.deepEqual(canvasWheelAction(wheel({ deltaX: 24, deltaY: -18 })), {
    kind: "pan",
    x: -24,
    y: 18,
  });
  assert.deepEqual(canvasWheelAction(wheel({ deltaY: 3, deltaMode: 1 })), {
    kind: "pan",
    x: 0,
    y: -48,
  });
});

test("shift-wheel maps a vertical mouse wheel to horizontal pan", () => {
  assert.deepEqual(canvasWheelAction(wheel({ deltaY: 40, shiftKey: true })), {
    kind: "pan",
    x: -40,
    y: 0,
  });
});

test("Cmd or Ctrl wheel becomes a bounded zoom gesture", () => {
  assert.deepEqual(canvasWheelAction(wheel({ deltaY: -20, metaKey: true })), {
    kind: "zoom",
    delta: 0.03,
  });
  assert.deepEqual(canvasWheelAction(wheel({ deltaY: 1_000, ctrlKey: true })), {
    kind: "zoom",
    delta: -0.16,
  });
});

test("zero-delta wheel input is ignored", () => {
  assert.equal(canvasWheelAction(wheel()), null);
});

test("canvas shortcuts yield to focused controls, dialogs, and already handled events", () => {
  const target = (match: boolean) => ({ closest: () => (match ? ({} as Element) : null) });
  assert.equal(
    shouldIgnoreCanvasShortcut({ defaultPrevented: true, target: target(false) as never }),
    true,
  );
  assert.equal(
    shouldIgnoreCanvasShortcut({ defaultPrevented: false, target: target(true) as never }),
    true,
  );
  assert.equal(
    shouldIgnoreCanvasShortcut({ defaultPrevented: false, target: target(false) as never }),
    false,
  );
});

test("screen capture uses the advertised modified shortcut, never plain S", () => {
  assert.equal(
    isCaptureScreenShortcut({ key: "s", metaKey: true, ctrlKey: false, shiftKey: true }),
    true,
  );
  assert.equal(
    isCaptureScreenShortcut({ key: "S", metaKey: false, ctrlKey: true, shiftKey: true }),
    true,
  );
  assert.equal(
    isCaptureScreenShortcut({ key: "s", metaKey: false, ctrlKey: false, shiftKey: false }),
    false,
  );
  assert.equal(
    isCaptureScreenShortcut({ key: "s", metaKey: true, ctrlKey: false, shiftKey: false }),
    false,
  );
});
