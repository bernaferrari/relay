import assert from "node:assert/strict";
import test from "node:test";
import type { CompatibilityMatrix, TargetDefinition } from "@relay/protocol";
import {
  buildTargetProfiles,
  resolveCompatibilityMatrix,
  validateCompatibilityMatrix,
} from "./matrix.js";

const matrix: CompatibilityMatrix = {
  id: "release-smoke",
  projectId: "default",
  name: "Release smoke",
  selectors: [
    { platforms: ["browser"], requiredCapabilities: ["network"] },
    { platforms: ["android"], requiredCapabilities: ["lock-screen"] },
  ],
  createdAt: 1,
  updatedAt: 1,
};

test("compatibility matrices freeze an explained, stable target expansion", () => {
  const targets: TargetDefinition[] = [
    {
      id: "web",
      name: "Chat web",
      kind: "browser",
      createdAt: 1,
      updatedAt: 1,
      browser: { startUrl: "https://example.com", viewport: { width: 1280, height: 800 } },
    },
  ];
  const profiles = buildTargetProfiles({
    devices: [
      {
        id: "ios",
        serial: "ios-1",
        name: "iPhone",
        kind: "iPhone 15",
        booted: true,
        platform: "ios",
      },
      {
        id: "android",
        serial: "android-1",
        name: "Pixel",
        kind: "Pixel 9",
        booted: true,
        platform: "android",
        osVersion: "15",
      },
    ],
    targets,
    observedAt: 10,
  });
  const expansion = resolveCompatibilityMatrix(matrix, profiles, 20);
  assert.deepEqual(
    expansion.profiles.map((profile) => profile.targetId),
    ["web", "android-1"],
  );
  assert.match(expansion.excluded[0]!.reason, /platform is ios/);
  assert.equal(expansion.profiles[0]!.viewport?.width, 1280);
  assert.equal(
    expansion.profiles.find((profile) => profile.targetId === "android-1")?.osVersion,
    "15",
  );
});

test("OS selectors match observed versions and explain unknown devices", () => {
  const profiles = buildTargetProfiles({
    devices: [
      {
        id: "pixel-15",
        serial: "pixel-15",
        name: "Pixel 9",
        kind: "Pixel 9",
        booted: true,
        platform: "android",
        osVersion: "15",
      },
      {
        id: "pixel-unknown",
        serial: "pixel-unknown",
        name: "Remote Android",
        kind: "Android device",
        booted: true,
        platform: "android",
      },
    ],
    targets: [],
    observedAt: 10,
  });
  const expansion = resolveCompatibilityMatrix(
    {
      ...matrix,
      id: "android-15",
      selectors: [{ platforms: ["android"], osVersionPrefixes: ["15"] }],
    },
    profiles,
    20,
  );
  assert.deepEqual(
    expansion.profiles.map((profile) => profile.targetId),
    ["pixel-15"],
  );
  assert.match(expansion.excluded[0]!.reason, /OS version was not reported/);
});

test("compatibility matrix validation rejects an accidental all-target selector", () => {
  assert.throws(
    () => validateCompatibilityMatrix({ id: "all", name: "All", selectors: [{}] }),
    /at least one constraint/,
  );
});
