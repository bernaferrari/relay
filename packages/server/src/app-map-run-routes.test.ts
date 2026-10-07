import assert from "node:assert/strict";
import test from "node:test";
import {
  compileBrowserEnvironment,
  type AppMap,
  type AppMapCompiledRuntimeTargetProfile,
  type TargetProfile,
} from "@relay/protocol";
import {
  frozenEvidenceTargetProfileForTarget,
  frozenTestRunTargetProfile,
  offlinePreflightProfileRecovery,
} from "./app-map-run-routes.js";
import { HttpError } from "./http.js";

const pixelEn: AppMapCompiledRuntimeTargetProfile = {
  id: "pixel-en",
  targetId: "pixel-1",
  platform: "android",
};
const pixelIt: AppMapCompiledRuntimeTargetProfile = {
  id: "pixel-it",
  targetId: "pixel-1",
  platform: "android",
};
const ipadEn: AppMapCompiledRuntimeTargetProfile = {
  id: "ipad-en",
  targetId: "ipad-1",
  platform: "ios",
};
const pixel = { targetId: "pixel-1", platform: "android" } as const;

function browserMap(...profiles: TargetProfile[]): AppMap {
  return {
    screenVariants: Object.fromEntries(
      profiles.map((targetProfile, index) => [
        `variant-${index}`,
        { id: `variant-${index}`, targetProfile },
      ]),
    ),
  } as unknown as AppMap;
}

test("the offline-preflight path inherits the only saved profile for the target", () => {
  const resolved = frozenEvidenceTargetProfileForTarget({
    target: { ...pixel },
    profiles: [pixelEn, ipadEn],
  });
  assert.deepEqual(resolved, pixelEn);
});

test("explicit browser profile selection freezes every saved environment field", () => {
  const browserCaseProfile = compileBrowserEnvironment({
    engine: "firefox",
    viewport: { width: 1_024, height: 768 },
    locale: "it-IT",
    timezoneId: "Europe/Rome",
    networkProfile: "wifi",
    authenticationFixtureId: "signed-in",
  });
  const profile: TargetProfile = {
    id: "browser:shop",
    targetId: "shop",
    source: "browser",
    platform: "browser",
    name: "Shop",
    browserCaseProfile,
    capabilities: ["snapshot"],
    observedAt: 1,
  };
  assert.deepEqual(
    frozenTestRunTargetProfile({
      map: browserMap(profile),
      targetProfileId: profile.id,
      target: { targetId: "shop", platform: "browser" },
    }),
    {
      id: profile.id,
      targetId: "shop",
      platform: "browser",
      viewport: browserCaseProfile.viewport,
      browserCaseProfile,
    },
  );
  assert.throws(
    () =>
      frozenTestRunTargetProfile({
        map: browserMap(profile, {
          ...profile,
          browserCaseProfile: { ...browserCaseProfile, locale: "en-US" },
        }),
        targetProfileId: profile.id,
        target: { targetId: "shop", platform: "browser" },
      }),
    /conflicting saved identities/u,
  );
});

test("legacy browser profiles stop for recapture before execution", () => {
  const legacy: TargetProfile = {
    id: "browser:legacy",
    targetId: "legacy",
    source: "browser",
    platform: "browser",
    name: "Legacy",
    viewport: { width: 800, height: 600 },
    capabilities: ["snapshot"],
    observedAt: 1,
  };
  assert.throws(
    () =>
      frozenTestRunTargetProfile({
        map: browserMap(legacy),
        targetProfileId: legacy.id,
        target: { targetId: "legacy", platform: "browser" },
      }),
    (error: unknown) =>
      error instanceof HttpError && error.body?.code === "FROZEN_BROWSER_PROFILE_REQUIRED",
  );
  assert.throws(
    () =>
      frozenEvidenceTargetProfileForTarget({
        target: { targetId: "legacy", platform: "browser" },
        profiles: [
          {
            id: legacy.id,
            targetId: legacy.targetId,
            platform: legacy.platform,
            viewport: legacy.viewport,
          },
        ],
      }),
    (error: unknown) =>
      error instanceof HttpError && error.body?.code === "FROZEN_BROWSER_PROFILE_REQUIRED",
  );
});

test("several matching saved profiles fail with the candidate ids in the recovery", () => {
  assert.throws(
    () =>
      frozenEvidenceTargetProfileForTarget({ target: { ...pixel }, profiles: [pixelEn, pixelIt] }),
    (error: unknown) => {
      if (!(error instanceof HttpError) || error.status !== 409) return false;
      const body = error.body as {
        code?: string;
        targetProfileCandidates?: unknown[];
        recovery?: string;
      };
      return (
        body.code === "TARGET_PROFILE_SELECTION_REQUIRED" &&
        body.targetProfileCandidates?.length === 2 &&
        body.recovery ===
          "Bind an explicit saved targetProfileId for android:pixel-1: pixel-en, pixel-it."
      );
    },
  );
});

test("raw server native admission uses the same current geometry and OS selection as workflows", () => {
  const legacy: AppMapCompiledRuntimeTargetProfile = {
    ...pixelEn,
    id: "device:pixel-1",
    viewport: { width: 1080, height: 2340 },
    capabilities: [],
  };
  const complete: AppMapCompiledRuntimeTargetProfile = {
    ...legacy,
    id: "device:pixel-1-1080x2340",
    osVersion: "16",
    model: "device",
    capabilities: ["snapshot", "screenshot"],
  };
  assert.deepEqual(
    frozenEvidenceTargetProfileForTarget({
      target: pixel,
      profiles: [legacy, complete],
      observedDevice: {
        serial: "pixel-1",
        platform: "android",
        osVersion: "16",
        viewport: legacy.viewport,
      },
    }),
    complete,
  );
  for (const observedDevice of [
    undefined,
    { serial: "pixel-1", platform: "android", osVersion: "17", viewport: legacy.viewport },
    {
      serial: "pixel-1",
      platform: "android",
      osVersion: "16",
      viewport: { width: 2340, height: 1080 },
    },
  ])
    assert.throws(
      () =>
        frozenEvidenceTargetProfileForTarget({
          target: pixel,
          profiles: [legacy, complete],
          observedDevice,
        }),
      (error: unknown) =>
        error instanceof HttpError && error.body?.code === "TARGET_PROFILE_SELECTION_REQUIRED",
    );
  assert.throws(
    () =>
      frozenEvidenceTargetProfileForTarget({
        target: pixel,
        profiles: [complete, { ...complete, id: "italian" }],
        observedDevice: {
          serial: "pixel-1",
          platform: "android",
          osVersion: "16",
          viewport: legacy.viewport,
        },
      }),
    (error: unknown) =>
      error instanceof HttpError && error.body?.code === "TARGET_PROFILE_SELECTION_REQUIRED",
  );
});

test("a target with only foreign saved profiles fails with capture guidance", () => {
  assert.throws(
    () => frozenEvidenceTargetProfileForTarget({ target: { ...pixel }, profiles: [ipadEn] }),
    (error: unknown) => {
      if (!(error instanceof HttpError) || error.status !== 409) return false;
      const body = error.body as { code?: string; recovery?: string };
      return (
        body.code === "TARGET_PROFILE_TARGET_MISMATCH" &&
        body.recovery ===
          "No saved runtime profile for target android:pixel-1 — capture a screen on this target first."
      );
    },
  );
});

test("a map with no saved profiles yet leaves the run to lenient preflight", () => {
  assert.equal(
    frozenEvidenceTargetProfileForTarget({ target: { ...pixel }, profiles: undefined }),
    undefined,
  );
});

test("offline preflight recovery names the inherited profile", () => {
  assert.equal(
    offlinePreflightProfileRecovery({
      runtimeTargetProfile: pixelEn,
      explicit: false,
      candidates: ["pixel-en"],
      target: { ...pixel },
    }),
    "Relay inherited the only saved runtime profile for android:pixel-1: pixel-en. Review its frozen evidence findings, then retry this exact Test revision.",
  );
});

test("offline preflight recovery keeps the explicit-selection wording for an explicit profile", () => {
  assert.equal(
    offlinePreflightProfileRecovery({
      runtimeTargetProfile: pixelEn,
      explicit: true,
      candidates: ["pixel-en", "pixel-it"],
      target: { ...pixel },
    }),
    "Review the frozen evidence findings, select or recapture the required profile, then retry this exact Test revision.",
  );
});

test("offline preflight recovery without a profile lists bindable ids", () => {
  assert.equal(
    offlinePreflightProfileRecovery({
      runtimeTargetProfile: undefined,
      explicit: false,
      candidates: ["pixel-en", "pixel-it"],
      target: { ...pixel },
    }),
    "Bind an explicit saved targetProfileId for android:pixel-1: pixel-en, pixel-it, then retry this exact Test revision.",
  );
});

test("offline preflight recovery without any saved profile asks for a capture", () => {
  assert.equal(
    offlinePreflightProfileRecovery({
      runtimeTargetProfile: undefined,
      explicit: false,
      candidates: [],
      target: { ...pixel },
    }),
    "No saved runtime profile for target android:pixel-1 — capture a screen on this target first.",
  );
});
