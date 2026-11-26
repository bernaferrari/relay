import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSafeBrowserLaneId,
  bindBrowserLaneCookieStore,
  browserLaneCookieStore,
  browserLaneElectronPartition,
  browserLaneHostIdentity,
  browserLanePlaywrightUserDataName,
  browserLaneTabSessionKey,
} from "./browser-lane-session.js";

test("one Lane identity keys in-app tabs and Electron partitions together", () => {
  const gmail = browserLaneHostIdentity({ laneId: "account-gmail", targetId: "example-com" });
  const again = browserLaneHostIdentity({ laneId: "account-gmail", targetId: "example-com" });
  const email = browserLaneHostIdentity({ laneId: "account-email", targetId: "example-com" });
  const lab = browserLaneHostIdentity({
    laneId: "shared-lab",
    targetId: "example-com",
    authenticationFixtureId: "authfx:11111111-1111-4111-8111-111111111111:1",
  });
  assert.deepEqual(gmail, again);
  assert.equal(gmail.tabSessionKey, "lane:account-gmail");
  assert.equal(gmail.electronPartition, "persist:lane:account-gmail");
  assert.notEqual(gmail.tabSessionKey, email.tabSessionKey);
  assert.notEqual(gmail.electronPartition, email.electronPartition);
  assert.equal(lab.tabSessionKey, "lane:shared-lab");
  assert.equal(lab.electronPartition, "persist:lane:shared-lab");
  assert.equal(
    browserLaneTabSessionKey({
      targetId: "example-com",
      authenticationFixtureId: "authfx:11111111-1111-4111-8111-111111111111:1",
    }),
    "signin:example-com:authfx:11111111-1111-4111-8111-111111111111:1",
  );
  assert.equal(
    browserLaneTabSessionKey({ targetId: "example-com" }),
    "lane:example-com:signed-out",
  );
  assert.equal(browserLaneElectronPartition("account-x-out"), "persist:lane:account-x-out");
  assert.notEqual(browserLaneElectronPartition("seeded-member"), "id__lane_seeded-member");
  assert.doesNotMatch(browserLaneElectronPartition("seeded-member"), /^[/\\]/u);
  assert.throws(() => assertSafeBrowserLaneId("../etc"), /not a safe browser session key/);
});

test("Playwright user-data and Electron partitions are distinct stores even with the same Lane id", () => {
  const playwright = browserLaneCookieStore({
    kind: "playwright-user-data",
    laneId: "shared-lab",
    targetId: "example-com",
  });
  const electron = browserLaneCookieStore({ kind: "electron-partition", laneId: "shared-lab" });
  assert.equal(playwright.kind, "playwright-user-data");
  assert.equal(electron.kind, "electron-partition");
  assert.equal(playwright.name, "example-com__lane_shared-lab");
  assert.equal(electron.partition, "persist:lane:shared-lab");
  assert.notEqual(playwright.name, electron.partition);
  assert.equal(
    browserLanePlaywrightUserDataName("example-com", "daily-lane"),
    "example-com__lane_daily-lane",
  );
  assert.deepEqual(bindBrowserLaneCookieStore(playwright), playwright);
  assert.deepEqual(bindBrowserLaneCookieStore(playwright, playwright), playwright);
  assert.throws(() => bindBrowserLaneCookieStore(playwright, electron), /separate cookie stores/u);
  assert.throws(() => bindBrowserLaneCookieStore(electron, playwright), /separate cookie stores/u);
  assert.throws(
    () => browserLaneElectronPartition("example-com__lane_daily-lane"),
    /cannot reuse Playwright user-data/u,
  );
});
