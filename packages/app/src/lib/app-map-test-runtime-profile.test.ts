import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap } from "@relay/protocol";
import {
  appMapTestRuntimeProfileMatchesDevice,
  appMapTestRuntimeProfiles,
  appMapTestRuntimeProfileScope,
  suggestedAppMapTestRuntimeProfileId,
} from "./app-map-test-runtime-profile.js";

function map(): AppMap {
  return {
    schemaVersion: 1,
    id: "map",
    organizationId: "org",
    projectId: "project",
    name: "Map",
    revision: 1,
    notes: {},
    groups: {},
    screens: {},
    screenVariants: {
      "settings-pt": {
        id: "settings-pt",
        organizationId: "org",
        projectId: "project",
        appMapId: "map",
        screenId: "settings",
        targetProfile: {
          id: "ipad-pt-BR",
          targetId: "ipad-1",
          source: "device",
          platform: "ios",
          name: "iPad · Portuguese",
          capabilities: [],
          observedAt: 2,
        },
        evidenceIds: [],
        createdAt: 2,
        updatedAt: 2,
      },
      "settings-en": {
        id: "settings-en",
        organizationId: "org",
        projectId: "project",
        appMapId: "map",
        screenId: "settings",
        targetProfile: {
          id: "ipad-en-US",
          targetId: "ipad-1",
          source: "device",
          platform: "ios",
          name: "iPad · English",
          capabilities: [],
          observedAt: 1,
        },
        evidenceIds: [],
        createdAt: 1,
        updatedAt: 1,
      },
      "home-en": {
        id: "home-en",
        organizationId: "org",
        projectId: "project",
        appMapId: "map",
        screenId: "home",
        targetProfile: {
          id: "ipad-en-US",
          targetId: "ipad-1",
          source: "device",
          platform: "ios",
          name: "iPad · English",
          capabilities: [],
          observedAt: 1,
        },
        evidenceIds: [],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    connections: {},
    caseStacks: {},
    variables: {},
    tests: {},
    combines: {},
    routines: {},
    flows: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: 1,
    updatedAt: 1,
  };
}

test("keeps target/locale profiles explicit instead of choosing a locale by name", () => {
  const profiles = appMapTestRuntimeProfiles(map());

  assert.deepEqual(
    profiles.map((profile) => profile.id),
    ["ipad-en-US", "ipad-pt-BR"],
  );
  assert.equal(
    suggestedAppMapTestRuntimeProfileId(profiles, {
      serial: "ipad-1",
      platform: "ios",
    }),
    undefined,
  );
  assert.equal(
    appMapTestRuntimeProfileMatchesDevice(profiles[0]!, {
      serial: "ipad-1",
      platform: "ios",
    }),
    true,
  );
  assert.equal(
    appMapTestRuntimeProfileMatchesDevice(profiles[0]!, {
      serial: "android-1",
      platform: "android",
    }),
    false,
  );
});

test("selects the only exact runtime profile and never a profile from another device", () => {
  const profiles = appMapTestRuntimeProfiles(map()).filter(
    (profile) => profile.id === "ipad-pt-BR",
  );

  assert.equal(
    suggestedAppMapTestRuntimeProfileId(profiles, {
      serial: "ipad-1",
      platform: "ios",
    }),
    "ipad-pt-BR",
  );
  assert.equal(
    suggestedAppMapTestRuntimeProfileId(profiles, {
      serial: "android-1",
      platform: "android",
    }),
    undefined,
  );
});

test("makes a lone profile from another target an explicit blocked scope", () => {
  const profiles = appMapTestRuntimeProfiles(map()).filter(
    (profile) => profile.id === "ipad-pt-BR",
  );
  const scope = appMapTestRuntimeProfileScope({
    profiles,
    device: { serial: "android-1", platform: "android" },
  });

  assert.equal(scope.status, "no-compatible-profile");
  assert.equal(scope.selectedProfileId, undefined);
  assert.deepEqual(scope.compatibleProfiles, []);

  const incompatibleSelection = appMapTestRuntimeProfileScope({
    profiles,
    device: { serial: "android-1", platform: "android" },
    requestedProfileId: "ipad-pt-BR",
  });
  assert.equal(incompatibleSelection.status, "selected-profile-incompatible");
  assert.equal(incompatibleSelection.selectedProfileId, "ipad-pt-BR");
});
