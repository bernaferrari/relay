import assert from "node:assert/strict";
import test from "node:test";
import {
  deviceInteractionContentBox,
  deviceInteractionDisplayedPoint,
  deviceInteractionPointAtClient,
  deviceInteractionPointStyle,
  moveDeviceInteractionCursor,
} from "./device-interaction-surface";

const portraitViewport = { left: 10, top: 20, width: 200, height: 400 };

test("fits preview pixels exactly and rejects clicks in object-contain letterboxing", () => {
  assert.deepEqual(
    deviceInteractionContentBox({
      viewport: portraitViewport,
      source: { width: 200, height: 100 },
    }),
    { left: 10, top: 170, width: 200, height: 100, aspectRatio: 2 },
  );
  assert.equal(
    deviceInteractionPointAtClient({
      viewport: portraitViewport,
      source: { width: 200, height: 100 },
      clientX: 60,
      clientY: 60,
    }),
    undefined,
  );
  assert.deepEqual(
    deviceInteractionPointAtClient({
      viewport: portraitViewport,
      source: { width: 200, height: 100 },
      clientX: 60,
      clientY: 195,
    }),
    { displayed: { x: 0.25, y: 0.25 }, logical: { x: 0.25, y: 0.25 } },
  );
});

test("does not manufacture device coordinates when preview dimensions are absent or malformed", () => {
  assert.equal(
    deviceInteractionContentBox({ viewport: portraitViewport, source: { width: 0, height: 100 } }),
    undefined,
  );
  assert.equal(
    deviceInteractionPointAtClient({
      viewport: portraitViewport,
      source: undefined,
      clientX: 60,
      clientY: 195,
    }),
    undefined,
  );
});

test("keeps an edge gesture valid by clamping only after it began on device pixels", () => {
  assert.deepEqual(
    deviceInteractionPointAtClient({
      viewport: portraitViewport,
      source: { width: 200, height: 100 },
      clientX: 250,
      clientY: 330,
      clamp: true,
    }),
    { displayed: { x: 1, y: 1 }, logical: { x: 1, y: 1 } },
  );
});

test("maps a rotated iPad presentation back to logical device points", () => {
  const viewport = { left: 0, top: 0, width: 200, height: 100 };
  assert.deepEqual(
    deviceInteractionPointAtClient({
      viewport,
      source: { width: 100, height: 200 },
      rotation: "left",
      clientX: 40,
      clientY: 70,
    }),
    { displayed: { x: 0.2, y: 0.7 }, logical: { x: 0.30000000000000004, y: 0.2 } },
  );
  assert.deepEqual(
    deviceInteractionPointAtClient({
      viewport,
      source: { width: 100, height: 200 },
      rotation: "right",
      clientX: 40,
      clientY: 70,
    }),
    { displayed: { x: 0.2, y: 0.7 }, logical: { x: 0.7, y: 0.8 } },
  );
});

test("keyboard arrows move in visual direction and preserve the rotated logical plane", () => {
  assert.deepEqual(
    moveDeviceInteractionCursor({
      point: { x: 0.5, y: 0.5 },
      key: "ArrowLeft",
      rotation: "left",
    }),
    { displayed: { x: 0.48, y: 0.5 }, logical: { x: 0.5, y: 0.48 } },
  );
  assert.deepEqual(deviceInteractionDisplayedPoint({ x: 0.5, y: 0.48 }, "left"), {
    logical: { x: 0.5, y: 0.48 },
    displayed: { x: 0.48, y: 0.5 },
  });
});

test("projects a cursor through letterboxing without pretending it fills the host", () => {
  assert.deepEqual(
    deviceInteractionPointStyle({
      point: { displayed: { x: 0.25, y: 0.25 }, logical: { x: 0.25, y: 0.25 } },
      viewport: portraitViewport,
      source: { width: 200, height: 100 },
    }),
    { left: "25%", top: "43.75%" },
  );
});
