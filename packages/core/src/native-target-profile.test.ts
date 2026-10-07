import assert from "node:assert/strict";
import test from "node:test";
import { PNG } from "pngjs";
import type { AppMapCompiledRuntimeTargetProfile } from "@relay/protocol";
import {
  nativeCaptureTargetProfile,
  nativeViewportForTarget,
  NATIVE_VIEWPORT_FACT_TTL_MS,
  recordNativeViewport,
  selectNativeTargetProfile,
  type NativeDeviceFacts,
} from "./native-target-profile.js";
import { recordNativeScreenshotViewport } from "./workspace-capture-presentation.js";

const target = { targetId: "RQCY104BG8X", platform: "android" } as const;
const viewport = { width: 1080, height: 2340 };
const legacy: AppMapCompiledRuntimeTargetProfile = {
  ...target,
  id: `device:${target.targetId}`,
  viewport,
  capabilities: [],
};
const complete: AppMapCompiledRuntimeTargetProfile = {
  ...legacy,
  id: `device:${target.targetId}-1080x2340`,
  model: "device",
  osVersion: "16",
  capabilities: ["snapshot", "screenshot"],
};
const observed: NativeDeviceFacts = {
  serial: target.targetId,
  platform: target.platform,
  viewport,
  osVersion: "16",
};
const select = (profiles: AppMapCompiledRuntimeTargetProfile[], facts = observed) =>
  selectNativeTargetProfile({ target, profiles, observed: facts });

test("actual phone facts select its complete capture instead of its incomplete legacy recording", () => {
  assert.deepEqual(select([legacy, complete]), complete);
  assert.deepEqual(select([complete, legacy]), complete);
  assert.deepEqual(select([complete, complete, legacy]), complete);
});

test("a changed OS or viewport cannot fall back to incomplete legacy evidence", () => {
  assert.throws(
    () => select([legacy, complete], { ...observed, osVersion: "17" }),
    /no longer matches/,
  );
  assert.throws(
    () => select([legacy, complete], { ...observed, viewport: { width: 2340, height: 1080 } }),
    /no longer matches/,
  );
});

test("equal current facts do not choose between language identities or generic model labels", () => {
  assert.throws(() => select([complete, { ...complete, id: "grok-italian" }]), /more than one/);
  assert.throws(
    () => select([complete, { ...complete, id: "actual-model", model: "SM-S931B" }]),
    /more than one/,
  );
});

test("multiple viewport, OS and AVD identities require independent current facts", () => {
  assert.throws(
    () => selectNativeTargetProfile({ target, profiles: [legacy, complete] }),
    /viewport is unavailable/,
  );
  assert.throws(
    () =>
      selectNativeTargetProfile({
        target,
        profiles: [complete, { ...complete, id: "os17", osVersion: "17" }],
        observed: { ...observed, osVersion: undefined },
      }),
    /osVersion is unavailable/,
  );
  assert.throws(
    () =>
      select([
        complete,
        { ...complete, id: "avd-two", androidAvdName: "other" },
        { ...complete, id: "avd-one", androidAvdName: "Phone_API_36" },
      ]),
    /androidAvdName is unavailable/,
  );
  assert.equal(
    selectNativeTargetProfile({
      target,
      profiles: [
        { ...complete, id: "avd-one", androidAvdName: "Phone_API_36" },
        { ...complete, id: "avd-two", androidAvdName: "other" },
      ],
      observed: { ...observed, avdName: "Phone_API_36" },
    })?.id,
    "avd-one",
  );
});

test("runtime facts from another phone cannot resolve a native profile", () => {
  assert.throws(
    () => select([legacy, complete], { ...observed, serial: "other-phone" }),
    /another target/,
  );
});

test("native captures and recordings share the same canonical profile constructor", () => {
  assert.deepEqual(
    nativeCaptureTargetProfile({
      ...target,
      observedAt: 10,
      viewport,
      model: "device",
      osVersion: "16",
    }),
    {
      id: complete.id,
      targetId: target.targetId,
      source: "device",
      platform: "android",
      name: target.targetId,
      model: "device",
      osVersion: "16",
      viewport,
      capabilities: ["snapshot", "screenshot"],
      observedAt: 10,
    },
  );
  assert.equal(
    nativeCaptureTargetProfile({ ...target, observedAt: 10, viewport: { width: 0, height: 2340 } })
      .id,
    legacy.id,
  );
});

test("full display facts are phone scoped, expire, and cannot be replaced by older or invalid captures", () => {
  const phone = { targetId: "cache-regression-phone", platform: "android" } as const;
  assert.equal(
    nativeViewportForTarget(phone, 1000),
    undefined,
    "cold process has no fabricated geometry",
  );
  recordNativeViewport(phone, viewport, 1000);
  recordNativeViewport(phone, { width: 400, height: 300 }, 999);
  recordNativeViewport(phone, { width: 0, height: 0 }, 1001);
  assert.deepEqual(nativeViewportForTarget(phone, 1001), viewport);
  assert.equal(nativeViewportForTarget({ ...phone, targetId: "other-phone" }, 1001), undefined);
  assert.equal(nativeViewportForTarget(phone, 999), undefined);
  assert.equal(nativeViewportForTarget(phone, 1001 + NATIVE_VIEWPORT_FACT_TTL_MS), undefined);
  recordNativeViewport(phone, { width: 2340, height: 1080 }, 1002);
  assert.deepEqual(nativeViewportForTarget(phone, 1003), { width: 2340, height: 1080 });
});

test("empty or blank native captures never establish display geometry; iOS uses logical bounds", () => {
  const phone = { targetId: "blank-capture-regression", platform: "android" } as const;
  const png = new PNG({ width: 2, height: 3 });
  for (let offset = 3; offset < png.data.length; offset += 4) png.data[offset] = 255;
  recordNativeScreenshotViewport(phone, Buffer.alloc(0), undefined, 1000);
  recordNativeScreenshotViewport(phone, PNG.sync.write(png), undefined, 1000);
  assert.equal(nativeViewportForTarget(phone, 1001), undefined);
  png.data[0] = 255;
  const bytes = PNG.sync.write(png);
  recordNativeScreenshotViewport(phone, bytes, undefined, 1000);
  assert.deepEqual(nativeViewportForTarget(phone, 1001), { width: 2, height: 3 });
  const ipad = { targetId: "logical-capture-regression", platform: "ios" } as const;
  recordNativeScreenshotViewport(ipad, bytes, undefined, 1000);
  assert.equal(nativeViewportForTarget(ipad, 1001), undefined);
  recordNativeScreenshotViewport(ipad, bytes, { width: 1112, height: 834 }, 1000);
  assert.deepEqual(nativeViewportForTarget(ipad, 1001), { width: 1112, height: 834 });
});
