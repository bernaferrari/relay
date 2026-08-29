import assert from "node:assert/strict";
import test from "node:test";
import {
  compileBrowserEnvironment,
  type BrowserCaseProfile,
  type TargetDefinition,
  type TargetProfile,
} from "@relay/protocol";
import { assertCurrentBrowserExecutionProfile } from "./browser-execution-profile-admission.js";
import { HttpError } from "./http.js";

const targetId = "browser-proof";
const frozen = compileBrowserEnvironment({
  engine: "webkit",
  viewport: { width: 390, height: 844 },
  locale: "pt-BR",
  timezoneId: "America/Maceio",
  colorScheme: "dark",
  networkProfile: "wifi-slow",
  authenticationFixtureId: "member-session",
  environmentRevision: "staging-42",
});

function target(profile: BrowserCaseProfile): TargetDefinition {
  return {
    id: targetId,
    name: "Browser Proof",
    kind: "browser",
    createdAt: 1,
    updatedAt: 1,
    browser: { startUrl: "https://relay.invalid", environment: profile },
  };
}

function execution(profile = frozen) {
  const targetProfile: TargetProfile = {
    id: `browser:${targetId}`,
    targetId,
    source: "browser",
    platform: "browser",
    name: "Browser Proof",
    viewport: profile.viewport,
    browserCaseProfile: profile,
    capabilities: [],
    observedAt: 1,
  };
  return {
    executionTarget: {
      schemaVersion: 1 as const,
      kind: "local-browser" as const,
      provider: { key: "relay.local.browser" as const, scope: "local" as const },
      targetId,
      platform: "browser" as const,
      identity: { kind: "browser-target" as const, value: targetId },
    },
    targetKind: "browser" as const,
    browserTargetId: targetId,
    browserCaseProfile: profile,
    targetProfile,
  };
}

test("current browser admission accepts only the complete frozen environment", async () => {
  await assert.doesNotReject(
    assertCurrentBrowserExecutionProfile({
      execution: execution(),
      runtime: { readTarget: async () => target(frozen) },
    }),
  );

  const driftCases: Array<[string, BrowserCaseProfile]> = [
    ["engine", { ...frozen, engine: "chromium" }],
    ["viewport", { ...frozen, viewport: { width: 1_280, height: 800 } }],
    ["locale", { ...frozen, locale: "en-US" }],
    ["timezone", { ...frozen, timezoneId: "Europe/Rome" }],
    ["color", { ...frozen, colorScheme: "light" }],
    ["network", { ...frozen, networkProfile: "wifi-fast" }],
    ["auth", { ...frozen, authenticationFixtureId: "guest-session" }],
    ["environment revision", { ...frozen, environmentRevision: "staging-43" }],
  ];
  for (const [field, current] of driftCases) {
    await assert.rejects(
      assertCurrentBrowserExecutionProfile({
        execution: execution(),
        runtime: { readTarget: async () => target(current) },
      }),
      (error) =>
        error instanceof HttpError &&
        error.status === 409 &&
        error.body?.code === "TARGET_PROFILE_TARGET_MISMATCH",
      field,
    );
  }
});

test("current browser admission fails closed without a frozen or managed profile", async () => {
  await assert.rejects(
    assertCurrentBrowserExecutionProfile({
      execution: { ...execution(), browserCaseProfile: undefined, targetProfile: undefined },
      runtime: { readTarget: async () => target(frozen) },
    }),
    (error) => error instanceof HttpError && error.body?.code === "FROZEN_BROWSER_PROFILE_REQUIRED",
  );
  await assert.rejects(
    assertCurrentBrowserExecutionProfile({
      execution: execution(),
      runtime: { readTarget: async () => null },
    }),
    (error) => error instanceof HttpError && error.body?.code === "TARGET_PROFILE_TARGET_MISMATCH",
  );
});

test("current browser admission leaves device executions unchanged", async () => {
  let reads = 0;
  await assertCurrentBrowserExecutionProfile({
    execution: {
      executionTarget: {
        schemaVersion: 1,
        kind: "local-device",
        provider: { key: "relay.local.agent-device", scope: "local" },
        targetId: "pixel-9",
        platform: "android",
        identity: { kind: "device-serial", value: "pixel-9" },
      },
      targetKind: "device",
      serial: "pixel-9",
      platform: "android",
    },
    runtime: {
      readTarget: async () => {
        reads += 1;
        return null;
      },
    },
  });
  assert.equal(reads, 0);
});
