import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap } from "@relay/protocol";
import { suggestedAndroidAppPackage } from "./app-map-android-package";

function mapWithIdentifiers(name: string, identifiers: string[]): AppMap {
  const now = 1;
  return {
    schemaVersion: 1,
    id: "map",
    name,
    organizationId: "org",
    projectId: "project",
    revision: 1,
    createdAt: now,
    updatedAt: now,
    groups: {},
    notes: {},
    screens: {},
    screenVariants: {
      variant: {
        id: "variant",
        organizationId: "org",
        projectId: "project",
        appMapId: "map",
        screenId: "screen",
        targetProfile: {
          id: "device",
          targetId: "device",
          source: "device",
          platform: "android",
          name: "Phone",
          capabilities: [],
          observedAt: now,
        },
        evidenceIds: [],
        observation: {
          fingerprint: "screen",
          nodes: identifiers.map((identifier) => ({ role: "button", identifier })),
          volatileSignals: [],
        },
        createdAt: now,
        updatedAt: now,
      },
    },
    connections: {},
    caseStacks: {},
    flows: {},
    variables: {},
    tests: {},
    combines: {},
    routines: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
  };
}

test("suggests the app package corroborated by App Map evidence", () => {
  assert.equal(
    suggestedAndroidAppPackage(
      mapWithIdentifiers("Grok Settings · Android", [
        "com.android.chrome:id/address_bar",
        "ai.x.grok:id/settings",
        "ai.x.grok:id/voice",
      ]),
    ),
    "ai.x.grok",
  );
});

test("does not guess a package when the map name has no supporting evidence", () => {
  assert.equal(
    suggestedAndroidAppPackage(mapWithIdentifiers("Settings map", ["ai.x.grok:id/settings"])),
    undefined,
  );
});
