import assert from "node:assert/strict";
import test from "node:test";
import { resolveTarget } from "./goal-session-support.js";
import type { RelayOperationPort } from "./operation-port.js";

type OperationLog = readonly { operationId: string; input: unknown }[];

function port(
  responses: Record<string, (input: never) => unknown>,
  log: { operationId: string; input: unknown }[] = [],
): { port: RelayOperationPort; log: OperationLog } {
  const implemented = {
    invoke(operationId: string, input: never) {
      log.push({ operationId, input });
      const handler = responses[operationId];
      if (!handler) throw new TypeError(`unexpected operation ${operationId}`);
      return Promise.resolve(handler(input));
    },
  };
  return { port: implemented as unknown as RelayOperationPort, log };
}

function browserLane(overrides: Record<string, unknown> = {}) {
  return {
    id: "member-lane",
    appMapId: "grok-web",
    target: { kind: "browser", browserTargetId: "browser-member" },
    account: {
      kind: "fixture",
      accountId: "acct-member",
      accountRevision: "3",
    },
    projectId: "local",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function goalOpenResponses() {
  return {
    "target.create": () => ({
      target: { id: "goal-session-1", kind: "browser" },
    }),
    "target.open": () => ({
      session: {
        targetId: "goal-session-1",
        sessionId: "live-1",
        authenticationFixtureId: "authfx:acct-member:3",
        configurationDigest: "{}",
      },
    }),
    "target.browser-device.open": () => ({ session: { sessionId: "device-1" } }),
  };
}

test("a URL goal with a fixture Lane attaches to the Lane's bound browser", async () => {
  const { port: operations, log } = port({
    "lane.list": () => ({ lanes: [browserLane()] }),
    "target.devices.list": () => ({
      devices: [{ id: "browser-member", serial: "browser-member", platform: "browser" }],
    }),
    "target.list": () => ({
      targets: [
        {
          id: "browser-member",
          kind: "browser",
          browser: { startUrl: "https://staging.example.test/home" },
        },
      ],
    }),
    "target.open": () => ({
      session: {
        targetId: "browser-member",
        sessionId: "live-1",
        authenticationFixtureId: "authfx:acct-member:3",
        configurationDigest: "{}",
      },
    }),
    "target.browser-device.open": () => ({ session: { sessionId: "device-1" } }),
  });
  const resolved = await resolveTarget(
    operations,
    {
      goal: "open settings",
      startUrl: "https://staging.example.test/settings",
      laneId: "member-lane",
    },
    "session-1",
  );
  const open = log.find((entry) => entry.operationId === "target.open");
  assert.ok(open, "target.open was invoked");
  const openInput = open.input as Record<string, unknown>;
  // The goal attaches to the Lane's own browser: the fixture lives on that
  // profile, so a fresh goal browser must never claim it.
  assert.equal(openInput.targetId, "browser-member");
  assert.equal(openInput.authenticationFixtureReference, "authfx:acct-member:3");
  assert.equal("signedOut" in openInput, false, "the Lane's fixture replaces signed-out");
  assert.equal(
    log.some((entry) => entry.operationId === "target.create"),
    false,
    "a fixture Lane does not mint a fresh goal browser",
  );
  assert.equal(resolved.target.targetId, "browser-member");
  assert.equal(resolved.target.laneId, "member-lane");
  assert.equal(resolved.target.authenticationFixtureReference, "authfx:acct-member:3");
  assert.equal(resolved.target.appliedAuthenticationFixtureId, "authfx:acct-member:3");
  assert.equal(resolved.laneId, "member-lane");
});

test("a fixture Lane refuses a goal URL on a different app origin", async () => {
  const { port: operations } = port({
    "lane.list": () => ({ lanes: [browserLane()] }),
    "target.list": () => ({
      targets: [
        {
          id: "browser-member",
          kind: "browser",
          browser: { startUrl: "https://staging.example.test/home" },
        },
      ],
    }),
  });
  await assert.rejects(
    resolveTarget(
      operations,
      {
        goal: "open settings",
        startUrl: "https://other-app.example.test/settings",
        laneId: "member-lane",
      },
      "session-1",
    ),
    /Ask on that app's Lane/u,
  );
});

test("a URL goal with a signed-out Lane opens an attested clean context", async () => {
  const { port: operations, log } = port({
    "lane.list": () => ({
      lanes: [
        browserLane({
          id: "unsigned-lane",
          account: { kind: "signed-out", attested: true },
        }),
      ],
    }),
    ...goalOpenResponses(),
  });
  const resolved = await resolveTarget(
    operations,
    { goal: "open settings", startUrl: "https://staging.example.test", laneId: "unsigned-lane" },
    "session-1",
  );
  const open = log.find((entry) => entry.operationId === "target.open");
  const openInput = open!.input as Record<string, unknown>;
  assert.equal(openInput.signedOut, true);
  assert.equal("authenticationFixtureReference" in openInput, false);
  assert.equal(resolved.target.signedOut, true);
});

test("a URL goal with a device Lane fails closed instead of rebinding the Lane", async () => {
  const { port: operations } = port({
    "lane.list": () => ({
      lanes: [
        browserLane({
          id: "device-lane",
          target: { kind: "device", serial: "emulator-5554", platform: "android" },
          account: undefined,
          engine: undefined,
        }),
      ],
    }),
  });
  await assert.rejects(
    resolveTarget(
      operations,
      { goal: "open settings", startUrl: "https://staging.example.test", laneId: "device-lane" },
      "session-1",
    ),
    /bound to a connected device/u,
  );
});

test("a URL goal with an unknown Lane names the missing configuration", async () => {
  const { port: operations } = port({ "lane.list": () => ({ lanes: [] }) });
  await assert.rejects(
    resolveTarget(
      operations,
      { goal: "open settings", startUrl: "https://staging.example.test", laneId: "ghost" },
      "session-1",
    ),
    /Lane ghost is not saved/u,
  );
});

test("a URL goal without a Lane keeps the clean signed-out default", async () => {
  const { port: operations, log } = port(goalOpenResponses());
  const resolved = await resolveTarget(
    operations,
    { goal: "open settings", startUrl: "https://staging.example.test" },
    "session-1",
  );
  const open = log.find((entry) => entry.operationId === "target.open");
  const openInput = open!.input as Record<string, unknown>;
  assert.equal(openInput.signedOut, true);
  assert.equal(resolved.target.signedOut, true);
});
