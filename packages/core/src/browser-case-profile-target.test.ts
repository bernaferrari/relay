import assert from "node:assert/strict";
import test from "node:test";
import { compileBrowserEnvironment } from "@relay/protocol";
import { BROWSER_TARGET_CAPABILITIES } from "./targets.js";
import {
  browserCaseProfileForTarget,
  managedBrowserTargetProfile,
} from "./browser-case-profile-target.js";
import { buildTargetProfiles } from "./matrix.js";

test("managed browser profiles freeze the compiled environment under browser:id", () => {
  const target = {
    id: "grok-com",
    name: "Grok.com",
    kind: "browser" as const,
    createdAt: 1,
    updatedAt: 1,
    browser: {
      startUrl: "https://grok.com/",
      viewport: { width: 1440, height: 900 },
    },
  };
  const profile = managedBrowserTargetProfile(target, 10);
  assert.equal(profile.id, "browser:grok-com");
  assert.deepEqual(profile.browserCaseProfile, browserCaseProfileForTarget(target));
  assert.deepEqual(profile.viewport, { width: 1440, height: 900 });
  assert.deepEqual(profile.capabilities, [...BROWSER_TARGET_CAPABILITIES]);
  assert.deepEqual(profile.browserCaseProfile, compileBrowserEnvironment({ viewport: profile.viewport }));
  assert.deepEqual(buildTargetProfiles({ devices: [], targets: [target], observedAt: 10 }), [
    profile,
  ]);
});
