import assert from "node:assert/strict";
import test from "node:test";
import { selectDeviceTargetProfile } from "./run-workflow-support.js";

test("a shared destination does not make the recording's unique starting profile ambiguous", () => {
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
  assert.equal(
    selectDeviceTargetProfile(compiled, { kind: "device", platform: "android", targetId: "phone" }),
    "recorded",
  );
  const variants = compiled.plan.rawAccessibilityVariantsByScreenId!;
  variants.start = [variant("old")] as typeof variants.start;
  assert.equal(
    selectDeviceTargetProfile(compiled, { kind: "device", platform: "android", targetId: "phone" }),
    "old",
  );
});

test("equivalent physical capture setups do not become ambiguous after merging screens", () => {
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
  assert.equal(
    selectDeviceTargetProfile(compiled, { kind: "device", platform: "android", targetId: "phone" }),
    "device:phone",
  );
  compiled.plan.rawAccessibilityTargetProfiles![0]!.viewport = { width: 2340, height: 1080 };
  assert.throws(
    () =>
      selectDeviceTargetProfile(compiled, {
        kind: "device",
        platform: "android",
        targetId: "phone",
      }),
    /more than one saved setup/,
  );
});
