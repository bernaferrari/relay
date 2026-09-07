import assert from "node:assert/strict";
import test from "node:test";
import {
  bindRequestedBrowserIdentity,
  browserLiveSessionKey,
  browserSessionProfileMatches,
  fixtureRevisionFromReference,
} from "./browser-execution-identity.js";

test("Member v7 cannot execute a saved Member v4 fixture", () => {
  const bound = bindRequestedBrowserIdentity({
    platform: "browser",
    requested: {
      engine: "chromium",
      account: {
        kind: "fixture",
        accountId: "acct-member",
        accountRevision: "7",
        reference: "authfx:11111111-1111-4111-8111-111111111111:7",
      },
    },
    saved: {
      engine: "chromium",
      authenticationFixtureId: "authfx:11111111-1111-4111-8111-111111111111:4",
    },
  });
  assert.equal(bound.status, "blocked");
  assert.match((bound as { reason: string }).reason, /revision 7.*revision 4/i);
});

test("Admin and Member on the same browser are distinct Live session keys", () => {
  assert.notEqual(
    browserLiveSessionKey({
      targetId: "browser-1",
      authenticationFixtureId: "authfx:admin:4",
    }),
    browserLiveSessionKey({
      targetId: "browser-1",
      authenticationFixtureId: "authfx:member:7",
    }),
  );
  assert.notEqual(
    browserLiveSessionKey({ targetId: "browser-1", signedOut: true }),
    browserLiveSessionKey({
      targetId: "browser-1",
      authenticationFixtureId: "authfx:admin:4",
    }),
  );
});

test("an already-open session cannot be reused without the requested profile", () => {
  assert.equal(
    browserSessionProfileMatches({ authenticationFixtureId: "authfx:admin:4" }, undefined),
    false,
  );
  assert.equal(
    browserSessionProfileMatches(
      { authenticationFixtureId: "authfx:admin:4" },
      { authenticationFixtureId: "authfx:member:7" },
    ),
    false,
  );
  assert.equal(
    browserSessionProfileMatches(
      { authenticationFixtureId: "authfx:admin:4" },
      { authenticationFixtureId: "authfx:admin:4" },
    ),
    true,
  );
});

test("signed-out cannot bind a saved logged-in fixture", () => {
  const bound = bindRequestedBrowserIdentity({
    platform: "browser",
    requested: { account: { kind: "signed-out", attested: true } },
    saved: { authenticationFixtureId: "authfx:admin:4" },
  });
  assert.equal(bound.status, "blocked");
});

test("device profileTargets without a browser case are not treated as account execution", () => {
  const bound = bindRequestedBrowserIdentity({
    platform: "android",
    requested: {
      engine: "chromium",
      account: { kind: "fixture", accountId: "acct-admin", accountRevision: "4" },
    },
    saved: {},
  });
  assert.equal(bound.status, "not-applicable");
});

test("fixture references expose their revision", () => {
  assert.equal(fixtureRevisionFromReference("authfx:00000000-0000-4000-8000-000000000000:7"), "7");
});
