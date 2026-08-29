import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  BROWSER_TARGET_CAPABILITIES,
  digestAppMapTestExecutionValue,
  saveBrowserTarget,
} from "@relay/core";
import { compileBrowserEnvironment } from "@relay/protocol";
import { profileForCapture } from "./app-map-capture-support.js";

test("browser capture saves the complete active case profile", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-browser-capture-profile-"));
  const previousRoot = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_WORKSPACE_ROOT = root;
  try {
    const environment = compileBrowserEnvironment({
      engine: "webkit",
      viewport: { width: 390, height: 844 },
      locale: "pt-BR",
      timezoneId: "America/Maceio",
      colorScheme: "dark",
      networkProfile: "wifi-slow",
      authenticationFixtureId: "member-session",
      featureFlagFixtureId: "checkout-v2",
      environmentRevision: "browser-env-9",
    });
    await saveBrowserTarget({
      id: "checkout",
      name: "Checkout",
      startUrl: "https://example.com",
      environment,
    });
    const profile = await profileForCapture(
      { kind: "browser", targetId: "checkout", platform: "browser" },
      123,
      { width: 1_280, height: 800 },
    );
    assert.equal(
      profile.id,
      `browser:checkout-390x844-${digestAppMapTestExecutionValue(environment).slice(0, 12)}`,
    );
    assert.deepEqual(profile.viewport, environment.viewport);
    assert.deepEqual(profile.browserCaseProfile, environment);
    assert.deepEqual(profile.capabilities, [...BROWSER_TARGET_CAPABILITIES]);
    const secondEnvironment = { ...environment, locale: "en-US" };
    await saveBrowserTarget({
      id: "checkout",
      name: "Checkout",
      startUrl: "https://example.com",
      environment: secondEnvironment,
    });
    const secondProfile = await profileForCapture(
      { kind: "browser", targetId: "checkout", platform: "browser" },
      124,
      environment.viewport,
    );
    assert.notEqual(secondProfile.id, profile.id);
    assert.deepEqual(secondProfile.browserCaseProfile, secondEnvironment);
  } finally {
    if (previousRoot === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousRoot;
    await rm(root, { recursive: true, force: true });
  }
});
