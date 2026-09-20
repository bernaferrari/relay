import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, BrowserCaseProfile, TargetProfile } from "@relay/protocol";
import {
  fixtureVariantsUnderUnsignedProfileIds,
  repairFixtureVariantProfileIds,
} from "./app-map-fixture-variant-repair.js";

const fixtureEnvironment: BrowserCaseProfile = {
  schemaVersion: 1,
  engine: "chromium",
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  mobile: false,
  touch: false,
  locale: "en-US",
  timezoneId: "UTC",
  colorScheme: "light",
  reducedMotion: "no-preference",
  permissions: [],
  offline: false,
  environmentRevision: "relay.browser-environment.v1",
  authenticationFixtureId: "authfx:admin:1",
};

type VariantRecord = NonNullable<AppMap["screenVariants"]>[string];

function variant(id: string, screenId: string, profile: Partial<TargetProfile>): VariantRecord {
  return {
    organizationId: "local",
    projectId: "default",
    appMapId: "store",
    id,
    screenId,
    targetProfile: {
      id: "browser:shop-admin",
      targetId: "shop-admin",
      source: "browser",
      platform: "browser",
      name: "Shop admin",
      viewport: { width: 1280, height: 800 },
      browserCaseProfile: { ...fixtureEnvironment },
      capabilities: [],
      observedAt: 1,
      ...profile,
    },
    observation: { fingerprint: "f", nodes: [] },
    createdAt: 1,
    updatedAt: 1,
  } as unknown as VariantRecord;
}

function mapWith(variants: Record<string, VariantRecord>): AppMap {
  return {
    organizationId: "local",
    projectId: "default",
    id: "store",
    name: "Store",
    revision: 3,
    screens: {},
    screenVariants: variants,
    connections: [],
    flows: {},
    tests: {},
    combines: {},
    variables: {},
    groups: [],
    createdAt: 1,
    updatedAt: 1,
  } as unknown as AppMap;
}

test("detects a fixture variant recorded under the unsigned managed id", () => {
  const repairs = fixtureVariantsUnderUnsignedProfileIds(
    mapWith({ "v-1": variant("v-1", "s-1", {}) }),
  );
  assert.equal(repairs.length, 1);
  assert.equal(repairs[0]!.variantId, "v-1");
  assert.equal(repairs[0]!.fromProfileId, "browser:shop-admin");
  assert.match(repairs[0]!.toProfileId, /^browser:shop-admin-1280x800-[0-9a-f]{12}$/u);
});

test("leaves unsigned variants and already-honest fixture variants alone", () => {
  const unsigned = variant("v-unsigned", "s-1", {
    browserCaseProfile: { ...fixtureEnvironment, authenticationFixtureId: undefined },
  });
  const honest = variant("v-honest", "s-1", {
    id: "browser:shop-admin-1280x800-abc123def456",
  });
  const repairs = fixtureVariantsUnderUnsignedProfileIds(
    mapWith({ "v-u": unsigned, "v-h": honest }),
  );
  assert.deepEqual(repairs, []);
});

test("repair re-keys only the misconfigured variants and is idempotent", () => {
  const good = variant("v-good", "s-2", {
    id: "browser:shop-admin-1280x800-abc123def456",
  });
  const first = repairFixtureVariantProfileIds(
    mapWith({ "v-bad": variant("v-bad", "s-1", {}), "v-good": good }),
  );
  assert.equal(first.repairs.length, 1);
  const repairedProfile = first.appMap.screenVariants!["v-bad"]!.targetProfile;
  assert.match(repairedProfile.id, /^browser:shop-admin-1280x800-[0-9a-f]{12}$/u);
  assert.equal(repairedProfile.browserCaseProfile?.authenticationFixtureId, "authfx:admin:1");
  assert.equal(
    first.appMap.screenVariants!["v-good"]!.targetProfile.id,
    "browser:shop-admin-1280x800-abc123def456",
  );
  const second = repairFixtureVariantProfileIds(first.appMap);
  assert.deepEqual(second.repairs, []);
  assert.equal(second.appMap, first.appMap);
});
