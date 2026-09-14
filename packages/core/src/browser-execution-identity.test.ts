import assert from "node:assert/strict";
import test from "node:test";
import { compileBrowserEnvironment } from "@relay/protocol";
import {
  accountFixtureIdsFromListed,
  bindRequestedBrowserIdentity,
  browserLiveIdentityMatches,
  browserLiveSessionKey,
  browserProofSessionKey,
  browserRuntimeConfigurationDigest,
  browserSessionBelongsToTarget,
  browserSessionProfileMatches,
  browserSessionStoreKey,
  fixtureRevisionFromReference,
  overlayRequestedBrowserAccountOnTargetProfile,
  liveBrowserSessionKeysToClose,
  resolveBrowserDeviceOpenIdentity,
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

test("opening a live account does not close authoring or the requested live key", () => {
  const keys = liveBrowserSessionKeysToClose({
    keys: [
      "authoring:browser-1",
      "live:browser-1:authfx:admin:4",
      "live:browser-1:authfx:member:7",
      "live:browser-2:authfx:admin:4",
    ],
    targetId: "browser-1",
    keepKey: "live:browser-1:authfx:member:7",
  });
  assert.deepEqual(keys, ["live:browser-1:authfx:admin:4"]);
  assert.notEqual(
    browserRuntimeConfigurationDigest({
      targetId: "browser-1",
      engine: "chromium",
      authenticationFixtureId: "authfx:admin:4",
    }),
    browserRuntimeConfigurationDigest({
      targetId: "browser-1",
      engine: "chromium",
      authenticationFixtureId: "authfx:member:7",
    }),
  );
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

test("proof sessions keep accounts on separate Playwright contexts", () => {
  assert.equal(
    browserProofSessionKey({ targetId: "grok-web", authenticationFixtureId: "authfx:admin:4" }),
    "proof:grok-web:authfx:admin:4",
  );
  assert.notEqual(
    browserProofSessionKey({ targetId: "grok-web", authenticationFixtureId: "authfx:admin:4" }),
    browserProofSessionKey({ targetId: "grok-web", authenticationFixtureId: "authfx:member:7" }),
  );
  assert.equal(
    browserSessionStoreKey({ targetId: "grok-web", mode: "proof" }),
    "proof:grok-web:signed-out",
  );
  assert.equal(
    browserProofSessionKey({ targetId: "grok-com", unsignedLaneId: "grok-daily" }),
    "proof:grok-com:signed-out:grok-daily",
  );
  assert.notEqual(
    browserProofSessionKey({ targetId: "grok-com", unsignedLaneId: "grok-daily" }),
    browserProofSessionKey({ targetId: "grok-com", unsignedLaneId: "grok-daily-b" }),
  );
  assert.equal(
    browserSessionBelongsToTarget("proof:grok-web:authfx:admin:4", "grok-web", "proof"),
    true,
  );
  assert.equal(browserSessionBelongsToTarget("authoring:grok-web", "grok-web", "proof"), false);
});

test("live identity reuse matches the complete requested profile", () => {
  assert.equal(
    browserLiveIdentityMatches(
      { engine: "chromium", authenticationFixtureId: "authfx:admin:4" },
      { engine: "chromium", authenticationFixtureId: "authfx:admin:4" },
    ),
    true,
  );
  assert.equal(
    browserLiveIdentityMatches(
      { engine: "chromium", authenticationFixtureId: "authfx:admin:4" },
      { engine: "chromium", authenticationFixtureId: "authfx:member:7" },
    ),
    false,
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

test("Plan account columns freeze the requested fixture onto the queued browser profile", () => {
  const queued = overlayRequestedBrowserAccountOnTargetProfile(
    {
      id: "browser:grok-com",
      targetId: "grok-com",
      platform: "browser",
      source: "browser",
      name: "Grok.com",
      capabilities: ["snapshot"],
      observedAt: 1,
      browserCaseProfile: compileBrowserEnvironment({ engine: "chromium" }),
    },
    {
      kind: "fixture",
      accountId: "acct-a",
      accountRevision: "1",
      reference: "authfx:11111111-1111-4111-8111-111111111111:1",
    },
  );
  assert.equal(
    queued?.browserCaseProfile?.authenticationFixtureId,
    "authfx:11111111-1111-4111-8111-111111111111:1",
  );
});

test("Member v7 cannot bind an opaque saved session or a different account at the same revision", () => {
  const requested = {
    engine: "chromium",
    account: { kind: "fixture" as const, accountId: "acct-member", accountRevision: "7" },
  };
  const opaque = bindRequestedBrowserIdentity({
    requested,
    saved: { engine: "chromium", authenticationFixtureId: "member-session" },
  });
  const otherAccount = bindRequestedBrowserIdentity({
    requested,
    saved: { engine: "chromium", authenticationFixtureId: "authfx:admin:7" },
  });
  const missing = bindRequestedBrowserIdentity({
    requested,
    saved: { engine: "chromium" },
  });
  assert.equal(opaque.status, "blocked");
  assert.equal(otherAccount.status, "blocked");
  assert.equal(missing.status, "blocked");
  assert.match((opaque as { reason: string }).reason, /canonical fixture/i);
  assert.match((otherAccount as { reason: string }).reason, /does not map|authfx:admin:7/i);
});

test("account and engine without a platform still bind as a browser case", () => {
  const bound = bindRequestedBrowserIdentity({
    requested: {
      engine: "chromium",
      account: {
        kind: "fixture",
        accountId: "member",
        accountRevision: "7",
        reference: "authfx:member:7",
      },
    },
    saved: { engine: "chromium", authenticationFixtureId: "authfx:member:7" },
  });
  assert.equal(bound.status, "bound");
});

test("a contradictory accountId and fixture reference cannot bind", () => {
  const bound = bindRequestedBrowserIdentity({
    requested: {
      engine: "chromium",
      account: {
        kind: "fixture",
        accountId: "acct-member",
        accountRevision: "7",
        reference: "authfx:admin:7",
      },
    },
    saved: { engine: "chromium", authenticationFixtureId: "authfx:admin:7" },
  });
  assert.equal(bound.status, "blocked");
  assert.match((bound as { reason: string }).reason, /does not map/i);
});

test("listed fixtures are an independent account registry", () => {
  const map = accountFixtureIdsFromListed([
    {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Member",
      reference: "authfx:11111111-1111-4111-8111-111111111111:7",
    },
  ]);
  assert.equal(map["11111111-1111-4111-8111-111111111111"], "11111111-1111-4111-8111-111111111111");
  assert.equal(map.Member, "11111111-1111-4111-8111-111111111111");
  assert.equal(map["acct-member"], undefined);
  const bound = bindRequestedBrowserIdentity({
    requested: {
      engine: "chromium",
      account: {
        kind: "fixture",
        accountId: "Member",
        accountRevision: "7",
        reference: "authfx:11111111-1111-4111-8111-111111111111:7",
      },
    },
    saved: {
      engine: "chromium",
      authenticationFixtureId: "authfx:11111111-1111-4111-8111-111111111111:7",
    },
    accountFixtureIds: map,
  });
  assert.equal(bound.status, "bound");
  assert.equal(
    bindRequestedBrowserIdentity({
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
        authenticationFixtureId: "authfx:11111111-1111-4111-8111-111111111111:7",
      },
      accountFixtureIds: map,
    }).status,
    "blocked",
  );
});

test("signed-out live identity wins over a saved fixture profile", () => {
  assert.deepEqual(
    resolveBrowserDeviceOpenIdentity({
      requested: { signedOut: true },
      savedProfile: { authenticationFixtureId: "authfx:admin:4" },
    }),
    { signedOut: true },
  );
  assert.deepEqual(
    resolveBrowserDeviceOpenIdentity({
      existingLive: { signedOut: true },
      savedProfile: { authenticationFixtureId: "authfx:admin:4" },
    }),
    { signedOut: true },
  );
  assert.deepEqual(
    resolveBrowserDeviceOpenIdentity({
      savedProfile: { authenticationFixtureId: "authfx:admin:4" },
    }),
    { authenticationFixtureId: "authfx:admin:4" },
  );
});

test("a missing saved engine cannot fully bind a fixture account", () => {
  const bound = bindRequestedBrowserIdentity({
    requested: {
      engine: "chromium",
      account: { kind: "fixture", accountId: "member", accountRevision: "7" },
    },
    saved: { authenticationFixtureId: "authfx:member:7" },
  });
  assert.equal(bound.status, "blocked");
  assert.match((bound as { reason: string }).reason, /engine/i);
});

test("Plan columns bind listed fixtures without a matching saved runtime account", () => {
  const listed = [
    {
      id: "acct-a",
      name: "Admin",
      reference: "authfx:acct-a:1",
    },
    {
      id: "acct-b",
      name: "Member",
      reference: "authfx:acct-b:1",
    },
  ];
  const admin = bindRequestedBrowserIdentity({
    platform: "browser",
    listedFixtureAuthority: true,
    listedFixtures: listed,
    requested: {
      engine: "chromium",
      account: { kind: "fixture", accountId: "acct-a", accountRevision: "1" },
    },
    saved: { engine: "chromium" },
  });
  const member = bindRequestedBrowserIdentity({
    platform: "browser",
    listedFixtureAuthority: true,
    listedFixtures: listed,
    requested: {
      engine: "chromium",
      account: { kind: "fixture", accountId: "acct-b", accountRevision: "1" },
    },
    saved: { engine: "chromium" },
  });
  assert.equal(admin.status, "bound");
  assert.equal(member.status, "bound");
  const unknown = bindRequestedBrowserIdentity({
    platform: "browser",
    listedFixtureAuthority: true,
    listedFixtures: listed,
    requested: {
      engine: "chromium",
      account: { kind: "fixture", accountId: "acct-c", accountRevision: "1" },
    },
    saved: { engine: "chromium" },
  });
  assert.equal(unknown.status, "blocked");
});

test("configuration identity distinguishes environment and fixture revisions", () => {
  const base = {
    targetId: "browser",
    engine: "chromium" as const,
    authenticationFixtureId: "authfx:member:7",
    viewport: { width: 390, height: 844 },
    locale: "en",
    colorScheme: "light" as const,
  };
  for (const change of [
    { authenticationFixtureId: "authfx:member:8" },
    { viewport: { width: 1440, height: 900 } },
    { locale: "ar" },
    { colorScheme: "dark" as const },
  ]) {
    assert.notEqual(
      browserRuntimeConfigurationDigest(base),
      browserRuntimeConfigurationDigest({ ...base, ...change }),
    );
    assert.equal(browserLiveIdentityMatches(base, { ...base, ...change }), false);
  }
  assert.equal(
    browserRuntimeConfigurationDigest(base),
    browserRuntimeConfigurationDigest(
      Object.fromEntries(Object.entries(base).reverse()) as typeof base,
    ),
  );
});
