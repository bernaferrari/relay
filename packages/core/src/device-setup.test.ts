import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  agentDeviceDaemonExecutable,
  agentDeviceDaemonPidsForStateDir,
  findAppleSigningIdentities,
  findXcodeProvisioningTeams,
  readDeviceSetup,
  saveAppleDeviceSetup,
  suggestAppleDeviceSetup,
} from "./device-setup.js";

test("identifies the exact installed agent-device daemon build", () => {
  assert.equal(
    agentDeviceDaemonExecutable(
      "/usr/bin/node /repo/node_modules/.pnpm/agent-device@0.18.3_patch_hash=new/node_modules/agent-device/dist/src/internal/daemon.js",
    ),
    "/repo/node_modules/.pnpm/agent-device@0.18.3_patch_hash=new/node_modules/agent-device/dist/src/internal/daemon.js",
  );
  assert.equal(
    agentDeviceDaemonExecutable("node /repo/not-agent-device/internal/daemon.js"),
    undefined,
  );
});

test("finds only verified agent-device daemons for the same state directory", () => {
  const output = [
    "101 node /repo/node_modules/agent-device/dist/src/internal/daemon.js AGENT_DEVICE_STATE_DIR=/Users/me/.agent-device",
    "102 node /repo/node_modules/agent-device/dist/src/internal/daemon.js AGENT_DEVICE_STATE_DIR=/tmp/test-state",
    "103 node /repo/not-agent-device/internal/daemon.js AGENT_DEVICE_STATE_DIR=/Users/me/.agent-device",
    "104 node /repo/node_modules/agent-device/dist/src/internal/daemon.js AGENT_DEVICE_STATE_DIR=/Users/me/.agent-device-old",
  ].join("\n");
  assert.deepEqual(agentDeviceDaemonPidsForStateDir(output, "/Users/me/.agent-device"), [101]);
});

test("derives a safe local runner suggestion from an Apple Development identity", () => {
  const output =
    '  1) 8562AF4B1AC3B85D40AC21B17B4C6CC79E71FED1 "Apple Development: Bernardo Ferrari (DESXYH8838)"\n     1 valid identities found';
  assert.deepEqual(findAppleSigningIdentities(output), [
    {
      teamId: "DESXYH8838",
      name: "Apple Development: Bernardo Ferrari",
    },
  ]);
  assert.deepEqual(suggestAppleDeviceSetup(output), {
    teamId: "DESXYH8838",
    bundleId: "com.relay.local.desxyh8838.runner",
    label: "Apple Development: Bernardo Ferrari",
  });
  assert.equal(suggestAppleDeviceSetup("0 valid identities found"), undefined);
});

test("prefers the Personal Team connected to Xcode over a stale Keychain identity", () => {
  const identities =
    '  1) HASH "Apple Development: Bernardo Ferrari (DESXYH8838)"\n     1 valid identities found';
  const xcodeTeams = `{
    "ACCOUNT" = (
      {
        isFreeProvisioningTeam = 1;
        teamID = M74VKW2N97;
        teamName = "Bernardo Ferrari (Personal Team)";
        teamType = "Personal Team";
      }
    );
  }`;
  assert.deepEqual(findXcodeProvisioningTeams(xcodeTeams), [
    {
      teamId: "M74VKW2N97",
      name: "Bernardo Ferrari (Personal Team)",
      personal: true,
    },
  ]);
  assert.deepEqual(suggestAppleDeviceSetup(identities, xcodeTeams), {
    teamId: "M74VKW2N97",
    bundleId: "com.relay.local.m74vkw2n97.runner",
    label: "Bernardo Ferrari (Personal Team)",
  });
});

test("Apple device setup persists in the Relay workspace and applies at runtime", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-device-setup-"));
  const previousRoot = process.env.RELAY_WORKSPACE_ROOT;
  const previousTeam = process.env.AGENT_DEVICE_IOS_TEAM_ID;
  const previousBundle = process.env.AGENT_DEVICE_IOS_BUNDLE_ID;
  const previousIdentity = process.env.AGENT_DEVICE_IOS_SIGNING_IDENTITY;
  const previousProfile = process.env.AGENT_DEVICE_IOS_PROVISIONING_PROFILE;
  try {
    process.env.RELAY_WORKSPACE_ROOT = root;
    const saved = await saveAppleDeviceSetup({
      teamId: "ABCDE12345",
      bundleId: "com.example.relay.runner",
    });
    assert.deepEqual(saved.ios, {
      teamId: "ABCDE12345",
      bundleId: "com.example.relay.runner",
    });
    assert.deepEqual(await readDeviceSetup(), saved);
    assert.equal(process.env.AGENT_DEVICE_IOS_TEAM_ID, "ABCDE12345");
    assert.equal(process.env.AGENT_DEVICE_IOS_BUNDLE_ID, "com.example.relay.runner");
    assert.equal(process.env.AGENT_DEVICE_IOS_SIGNING_IDENTITY, undefined);
    assert.equal(process.env.AGENT_DEVICE_IOS_PROVISIONING_PROFILE, undefined);
    await assert.rejects(
      saveAppleDeviceSetup({ teamId: "not a team", bundleId: "com.example.relay.runner" }),
      /Apple Team ID/,
    );
    await assert.rejects(
      saveAppleDeviceSetup({
        teamId: "ABCDE12345",
        bundleId: "com.example.relay.runner",
        signingIdentity: "Apple Development: Example",
      }),
      /both a signing identity and provisioning profile/,
    );
  } finally {
    if (previousRoot === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousRoot;
    if (previousTeam === undefined) delete process.env.AGENT_DEVICE_IOS_TEAM_ID;
    else process.env.AGENT_DEVICE_IOS_TEAM_ID = previousTeam;
    if (previousBundle === undefined) delete process.env.AGENT_DEVICE_IOS_BUNDLE_ID;
    else process.env.AGENT_DEVICE_IOS_BUNDLE_ID = previousBundle;
    if (previousIdentity === undefined) delete process.env.AGENT_DEVICE_IOS_SIGNING_IDENTITY;
    else process.env.AGENT_DEVICE_IOS_SIGNING_IDENTITY = previousIdentity;
    if (previousProfile === undefined) delete process.env.AGENT_DEVICE_IOS_PROVISIONING_PROFILE;
    else process.env.AGENT_DEVICE_IOS_PROVISIONING_PROFILE = previousProfile;
    await rm(root, { recursive: true, force: true });
  }
});
