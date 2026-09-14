import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap } from "@relay/protocol";
import {
  recordedPlanPlatformsFromAppMap,
  testRoutePlatformStatuses,
  unrecordedNativeEditorNotice,
} from "./test-route-platforms.js";

test("recordedPlanPlatformsFromAppMap uses browser variants when origin is missing", () => {
  const platforms = recordedPlanPlatformsFromAppMap(
    {
      screens: {
        home: {
          variantIds: ["web-home"],
        } as AppMap["screens"][string],
      },
      screenVariants: {
        "web-home": {
          targetProfile: { platform: "browser" },
        } as AppMap["screenVariants"][string],
      },
      connections: {
        open: {
          fromScreenId: "home",
          destination: { kind: "end" },
        } as AppMap["connections"][string],
      },
    },
    {
      steps: [
        {
          id: "open",
          kind: "instruction",
          intent: "Open",
          binding: { status: "resolved", kind: "connections", connectionIds: ["open"] },
        },
      ],
    },
  );
  assert.deepEqual(platforms, ["browser"]);
});

test("a grok.com Test without native variants shows Android and iOS as unrecorded", () => {
  const statuses = testRoutePlatformStatuses({
    originApplication: "https://grok.com",
  });
  assert.deepEqual(
    statuses.map((item) => [item.platform, item.status]),
    [
      ["browser", "reviewed"],
      ["android", "unrecorded"],
      ["ios", "unrecorded"],
    ],
  );
  assert.match(statuses[1]?.reason ?? "", /Android/u);
  assert.match(statuses[2]?.reason ?? "", /Grok Settings/u);
});

test("browser screen variants mark Web recorded when originApplication is missing", () => {
  const statuses = testRoutePlatformStatuses({}, { recordedPlatforms: ["browser"] });
  assert.equal(statuses[0]?.status, "reviewed");
  assert.equal(statuses[1]?.status, "unrecorded");
  assert.equal(statuses[2]?.status, "unrecorded");
});

test("reviewed route variants stay reviewed per platform predicate", () => {
  const statuses = testRoutePlatformStatuses({
    family: {
      logicalIntentRevision: 1,
      bindingRevision: 1,
      routeVariants: [
        {
          id: "web",
          revision: 1,
          predicate: { platforms: ["browser"] },
          bindings: {},
          reviewedAt: 1,
          reviewedBy: "reviewer",
        },
      ],
    },
  });
  assert.equal(statuses[0]?.status, "reviewed");
  assert.equal(statuses[0]?.variantId, "web");
  assert.equal(statuses[1]?.status, "unrecorded");
});

test("editor notice names disabled native platforms", () => {
  const statuses = testRoutePlatformStatuses({ originApplication: "https://grok.com" });
  assert.match(unrecordedNativeEditorNotice(statuses) ?? "", /Android and iOS/u);
  assert.match(unrecordedNativeEditorNotice(statuses) ?? "", /Grok Settings/u);
});

test("an Android companion is Linked, not Recorded, and iOS stays unrecorded", () => {
  const statuses = testRoutePlatformStatuses({
    originApplication: "https://grok.com",
    nativeRouteCompanions: [
      {
        platform: "android",
        appMapId: "grok-android",
        testId: "test-grok-android-home-chrome",
      },
    ],
  });
  assert.equal(statuses[0]?.status, "reviewed");
  assert.equal(statuses[1]?.status, "linked");
  assert.equal(statuses[1]?.companion?.testId, "test-grok-android-home-chrome");
  assert.match(statuses[1]?.reason ?? "", /grok-android/u);
  assert.equal(statuses[2]?.status, "unrecorded");
  assert.match(statuses[2]?.reason ?? "", /Grok Settings/u);
  assert.match(unrecordedNativeEditorNotice(statuses) ?? "", /^iOS/u);
});

test("a compile-blocked iOS route variant is Blocked, not Recorded", () => {
  const statuses = testRoutePlatformStatuses(
    {
      family: {
        logicalIntentRevision: 1,
        bindingRevision: 1,
        routeVariants: [
          {
            id: "ios-airplane",
            revision: 1,
            predicate: { platforms: ["ios"] },
            bindings: {},
            reviewedAt: 1,
            reviewedBy: "reviewer",
          },
        ],
      },
    },
    {
      platformBlockers: {
        ios: "airplane on iOS is a Settings handoff, not settings airplane on the Grok runner",
      },
    },
  );
  assert.equal(statuses[2]?.status, "blocked");
  assert.match(statuses[2]?.reason ?? "", /Settings handoff/u);
  assert.notEqual(statuses[2]?.status, "reviewed");
});
