import assert from "node:assert/strict";
import test from "node:test";
import { compileBrowserEnvironment } from "@relay/protocol";
import { BROWSER_TARGET_CAPABILITIES } from "./targets.js";
import {
  browserCaseProfileForTarget,
  canonicalUnsignedBrowserRuntimeProfileId,
  inheritSavedRuntimeProfileId,
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
  assert.deepEqual(
    profile.browserCaseProfile,
    compileBrowserEnvironment({ viewport: profile.viewport }),
  );
  assert.deepEqual(buildTargetProfiles({ devices: [], targets: [target], observedAt: 10 }), [
    profile,
  ]);
});

test("logged-out grok.com inherits browser:grok-com, not the unique signed-in profile", () => {
  const saved = ["browser:grok-com", "browser:grok-com-1280x800-339a5a430a41"];
  assert.equal(canonicalUnsignedBrowserRuntimeProfileId("grok-com", saved), "browser:grok-com");
  assert.equal(
    inheritSavedRuntimeProfileId({
      savedIds: saved,
      platform: "browser",
      targetId: "grok-com",
    }),
    "browser:grok-com",
  );
  assert.equal(
    inheritSavedRuntimeProfileId({
      savedIds: saved,
      platform: "browser",
      targetId: "grok-com",
      explicitProfileId: "browser:grok-com-1280x800-339a5a430a41",
    }),
    "browser:grok-com-1280x800-339a5a430a41",
  );
});

test("a browser without a saved profile stays unbound", () => {
  assert.equal(canonicalUnsignedBrowserRuntimeProfileId("chatgpt-qa-pilot", []), undefined);
  assert.equal(
    inheritSavedRuntimeProfileId({
      savedIds: [],
      platform: "browser",
      targetId: "chatgpt-qa-pilot",
    }),
    undefined,
  );
  assert.equal(
    inheritSavedRuntimeProfileId({
      savedIds: [
        "browser:chatgpt-qa-pilot-1280x800-aaaa",
        "browser:chatgpt-qa-pilot-1280x800-bbbb",
      ],
      platform: "browser",
      targetId: "chatgpt-qa-pilot",
    }),
    undefined,
  );
});
