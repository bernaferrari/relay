import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap } from "@relay/protocol";
import { HttpError } from "./http.js";
import {
  resolveScrollSurfaceCaptureSelection,
  resolveScrollSurfaceRegenerationSelection,
} from "./app-map-scroll-surface-support.js";

const map = {
  revision: 7,
  screens: { settings: { id: "settings", variantIds: ["settings-ja"] } },
  screenVariants: {
    "settings-ja": {
      id: "settings-ja",
      screenId: "settings",
      targetProfile: { targetId: "ipad-1", platform: "ios" },
      scrollSurfaces: [{ id: "surface-1", captureId: "capture-1" }],
    },
  },
} as unknown as AppMap;

test("resolves only the selected target/locale Screen Variant", () => {
  const result = resolveScrollSurfaceCaptureSelection({
    appMap: map,
    expectedRevision: 7,
    screenId: "settings",
    variantId: "settings-ja",
    target: { kind: "device", platform: "ios", targetId: "ipad-1" },
  });
  assert.equal(result.variant.id, "settings-ja");
});

test("regeneration resolves one immutable capture without a device target", () => {
  const result = resolveScrollSurfaceRegenerationSelection({
    appMap: map,
    expectedRevision: 7,
    screenId: "settings",
    variantId: "settings-ja",
    captureId: "capture-1",
  });
  assert.equal(result.surface.id, "surface-1");
  assert.throws(
    () =>
      resolveScrollSurfaceRegenerationSelection({
        appMap: map,
        expectedRevision: 7,
        screenId: "settings",
        variantId: "settings-ja",
        captureId: "missing",
      }),
    (error: unknown) => error instanceof HttpError && error.status === 404,
  );
});

test("rejects stale and target-mismatched selections before device control", () => {
  assert.throws(
    () =>
      resolveScrollSurfaceCaptureSelection({
        appMap: map,
        expectedRevision: 6,
        screenId: "settings",
        variantId: "settings-ja",
        target: { kind: "device", platform: "ios", targetId: "ipad-1" },
      }),
    (error: unknown) => error instanceof HttpError && error.status === 409,
  );
  assert.throws(
    () =>
      resolveScrollSurfaceCaptureSelection({
        appMap: map,
        expectedRevision: 7,
        screenId: "settings",
        variantId: "settings-ja",
        target: { kind: "device", platform: "ios", targetId: "ipad-english" },
      }),
    /does not match this Screen Variant/u,
  );
});
