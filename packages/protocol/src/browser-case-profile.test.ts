import assert from "node:assert/strict";
import test from "node:test";
import {
  browserCaseProfileSchema,
  compileBrowserEnvironment,
  parseBrowserCaseProfile,
  validateBrowserEnvironment,
} from "./browser-case-profile.js";

test("browser environment compilation is deterministic and immutable", () => {
  const first = compileBrowserEnvironment({
    engine: "firefox",
    viewport: { width: 1024, height: 768 },
    deviceScaleFactor: 2,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    colorScheme: "dark",
    offline: true,
    authenticationFixtureId: "fixture:staging",
  });
  const second = compileBrowserEnvironment({
    engine: "firefox",
    viewport: { width: 1024, height: 768 },
    deviceScaleFactor: 2,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    colorScheme: "dark",
    offline: true,
    authenticationFixtureId: "fixture:staging",
  });

  assert.deepEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.viewport), true);
  assert.equal(first.engine, "firefox");
  assert.equal(first.offline, true);
});

test("browser profile validation fails closed for unknown fields and engine channels", () => {
  assert.equal(validateBrowserEnvironment({ engine: "safari" }).ok, false);
  assert.equal(validateBrowserEnvironment({ engine: "firefox", channel: "chrome" }).ok, false);
  assert.equal(validateBrowserEnvironment({ timezoneId: "Mars/Base" }).ok, false);
  assert.throws(
    () =>
      parseBrowserCaseProfile({
        schemaVersion: 1,
        engine: "chromium",
        viewport: { width: 1280, height: 800 },
        locale: "en-US",
        timezoneId: "UTC",
        colorScheme: "light",
        reducedMotion: "no-preference",
        permissions: [],
        deviceScaleFactor: 1,
        mobile: false,
        touch: false,
        offline: false,
        environmentRevision: "relay.browser-environment.v1",
        unexpected: true,
      }),
    /Unrecognized key|unexpected/u,
  );
  assert.equal(browserCaseProfileSchema.safeParse({}).success, false);
});

test("mobile browser profiles require explicit touch capability", () => {
  assert.throws(
    () =>
      compileBrowserEnvironment({
        viewport: { width: 390, height: 844 },
        mobile: true,
      }),
    /mobile browser cases must explicitly enable touch/u,
  );
  assert.throws(
    () =>
      compileBrowserEnvironment({
        engine: "firefox",
        mobile: true,
      }),
    /Firefox does not support mobile emulation/u,
  );
  assert.equal(
    compileBrowserEnvironment({
      viewport: { width: 390, height: 844 },
      mobile: true,
      touch: true,
    }).touch,
    true,
  );
});
