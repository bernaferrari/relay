import assert from "node:assert/strict";
import test from "node:test";
import { selectDeviceTargetProfile } from "./run-workflow-support.js";

test("expected-screen intersections do not prove the current native runtime", () => {
  const variant = (id: string) => ({ targetProfileId: id, platform: "android", targetId: "phone" });
  const compiled = {
    plan: {
      rawAccessibilityTargetProfiles: [
        { id: "old", platform: "android", targetId: "phone" },
        { id: "recorded", platform: "android", targetId: "phone" },
      ],
      rawAccessibilityVariantsByScreenId: {
        start: [variant("recorded")],
        settings: [variant("old"), variant("recorded")],
      },
      recipes: {
        route: {
          steps: [
            { kind: "expect-screen", screenId: "start" },
            { kind: "expect-screen", screenId: "settings" },
          ],
        },
      },
    },
  } as unknown as Parameters<typeof selectDeviceTargetProfile>[0];
  assert.throws(
    () =>
      selectDeviceTargetProfile(compiled, {
        kind: "device",
        platform: "android",
        targetId: "phone",
      }),
    /viewport is unavailable/,
  );
  const variants = compiled.plan.rawAccessibilityVariantsByScreenId!;
  variants.start = [variant("old")] as typeof variants.start;
  assert.throws(
    () =>
      selectDeviceTargetProfile(compiled, {
        kind: "device",
        platform: "android",
        targetId: "phone",
      }),
    /viewport is unavailable/,
  );
});

test("passive current facts select complete physical capture evidence after merging screens", () => {
  const compiled = {
    plan: {
      rawAccessibilityTargetProfiles: [
        {
          id: "device:phone-old",
          platform: "android",
          targetId: "phone",
          viewport: { width: 1080, height: 2340 },
          osVersion: "16",
        },
        {
          id: "device:phone",
          platform: "android",
          targetId: "phone",
          viewport: { width: 1080, height: 2340 },
        },
      ],
    },
  } as unknown as Parameters<typeof selectDeviceTargetProfile>[0];
  assert.throws(
    () =>
      selectDeviceTargetProfile(compiled, {
        kind: "device",
        platform: "android",
        targetId: "phone",
      }),
    /viewport is unavailable/,
  );
  assert.equal(
    selectDeviceTargetProfile(
      compiled,
      { kind: "device", platform: "android", targetId: "phone" },
      {
        serial: "phone",
        platform: "android",
        osVersion: "16",
        viewport: { width: 1080, height: 2340 },
      },
    ),
    "device:phone-old",
  );
  compiled.plan.rawAccessibilityTargetProfiles![0]!.viewport = { width: 2340, height: 1080 };
  assert.throws(
    () =>
      selectDeviceTargetProfile(compiled, {
        kind: "device",
        platform: "android",
        targetId: "phone",
      }),
    /viewport is unavailable/,
  );
  assert.throws(
    () =>
      selectDeviceTargetProfile(
        compiled,
        { kind: "device", platform: "android", targetId: "phone" },
        {
          serial: "phone",
          platform: "android",
          osVersion: "16",
          viewport: { width: 1080, height: 2340 },
        },
      ),
    /no longer matches/,
  );
});
