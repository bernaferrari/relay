import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSafeBrowserLaneId,
  browserLaneElectronPartition,
  browserLaneHostIdentity,
  browserLaneTabSessionKey,
} from "./browser-lane-session.js";

test("one Lane identity keys in-app tabs and Electron partitions together", () => {
  const gmail = browserLaneHostIdentity({ laneId: "grok-auth-gmail", targetId: "grok-com" });
  const again = browserLaneHostIdentity({ laneId: "grok-auth-gmail", targetId: "grok-com" });
  const email = browserLaneHostIdentity({ laneId: "grok-auth-email", targetId: "grok-com" });
  const lab = browserLaneHostIdentity({
    laneId: "grok-lab",
    targetId: "grok-com",
    authenticationFixtureId: "authfx:7189423f-193e-45ed-b674-154505cc5107:1",
  });
  assert.deepEqual(gmail, again);
  assert.equal(gmail.tabSessionKey, "lane:grok-auth-gmail");
  assert.equal(gmail.electronPartition, "persist:lane:grok-auth-gmail");
  assert.notEqual(gmail.tabSessionKey, email.tabSessionKey);
  assert.notEqual(gmail.electronPartition, email.electronPartition);
  assert.equal(lab.tabSessionKey, "lane:grok-lab");
  assert.equal(lab.electronPartition, "persist:lane:grok-lab");
  assert.equal(
    browserLaneTabSessionKey({
      targetId: "grok-com",
      authenticationFixtureId: "authfx:7189423f-193e-45ed-b674-154505cc5107:1",
    }),
    "signin:grok-com:authfx:7189423f-193e-45ed-b674-154505cc5107:1",
  );
  assert.equal(browserLaneTabSessionKey({ targetId: "grok-com" }), "lane:grok-com:signed-out");
  assert.equal(browserLaneElectronPartition("grok-auth-x-out"), "persist:lane:grok-auth-x-out");
  assert.throws(() => assertSafeBrowserLaneId("../etc"), /not a safe browser session key/);
});
