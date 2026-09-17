import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { saveBrowserAuthenticationFixture } from "./browser-authentication-fixtures.js";
import {
  browserAuthenticationFixtureCanProbe,
  browserAuthenticationFixtureIsLive,
  collectBrowserTargetAccountHealth,
  concurrentBrowserAccountCopy,
  summarizeBrowserAccountHealth,
} from "./browser-account-health-summary.js";
import {
  GROK_AUTH_EMAIL_LANE,
  GROK_AUTH_GMAIL_LANE,
  GROK_AUTH_X_LANE,
  GROK_AUTH_X_OUT_LANE,
  GROK_DAILY_B_LANE,
  GROK_DAILY_C_LANE,
  GROK_DAILY_D_LANE,
  GROK_DAILY_E_LANE,
  GROK_DAILY_F_LANE,
  GROK_DAILY_G_LANE,
  GROK_DAILY_H_LANE,
  GROK_DAILY_LANE,
  GROK_LAB_LANE,
} from "./lane-seed.js";

const superGrok = "authfx:7189423f-193e-45ed-b674-154505cc5107:1";

test("revoked lab A/B/C are not live accounts", () => {
  assert.equal(browserAuthenticationFixtureIsLive({ health: { status: "ready" } }), true);
  assert.equal(
    browserAuthenticationFixtureIsLive({
      revokedAt: 1,
      health: { status: "ready" },
    }),
    false,
  );
  assert.equal(browserAuthenticationFixtureIsLive({ health: { status: "revoked" } }), false);
  assert.equal(browserAuthenticationFixtureIsLive({ health: { status: "needs-relogin" } }), false);
  assert.equal(browserAuthenticationFixtureIsLive({ health: { status: "expired" } }), false);
  assert.equal(browserAuthenticationFixtureIsLive({ health: { status: "error" } }), false);
  assert.equal(browserAuthenticationFixtureCanProbe({ health: { status: "needs-relogin" } }), true);
  assert.equal(browserAuthenticationFixtureCanProbe({ health: { status: "revoked" } }), false);
});

test("one live SuperGrok fixture is honest one-account, not a 3-account pack", () => {
  const summary = summarizeBrowserAccountHealth({
    targetId: "grok-com",
    fixtures: [
      {
        reference: superGrok,
        health: { status: "ready" },
      },
      {
        reference: "authfx:addeb648-90e6-43fe-9a6a-6e2c11d8bd09:1",
        revokedAt: 1,
        health: { status: "revoked" },
      },
      {
        reference: "authfx:5cc150b9-16f8-487e-8595-511da5e15981:1",
        revokedAt: 1,
        health: { status: "revoked" },
      },
      {
        reference: "authfx:bf31754a-03d1-4aaf-b6e3-6c3073335af2:1",
        revokedAt: 1,
        health: { status: "revoked" },
      },
    ],
    lanes: [
      GROK_DAILY_LANE,
      GROK_DAILY_B_LANE,
      GROK_DAILY_C_LANE,
      GROK_DAILY_D_LANE,
      GROK_DAILY_E_LANE,
      GROK_DAILY_F_LANE,
      GROK_DAILY_G_LANE,
      GROK_DAILY_H_LANE,
      GROK_AUTH_EMAIL_LANE,
      GROK_AUTH_GMAIL_LANE,
      GROK_AUTH_X_LANE,
      GROK_AUTH_X_OUT_LANE,
      GROK_LAB_LANE,
    ],
  });
  assert.equal(summary.liveCount, 1);
  assert.equal(summary.revokedCount, 3);
  assert.equal(summary.readyCount, 1);
  assert.equal(summary.concurrentAccountsPossible, false);
  assert.equal(summary.concurrentReason, concurrentBrowserAccountCopy(1));
  assert.equal(summary.electronGrokLabPartitionPresent, false);
  assert.match(summary.electronGrokLabReason, /Playwright SuperGrok fixture is not Electron/u);
  assert.deepEqual(
    summary.lanes.map((lane) => `${lane.id}:${lane.schedulingKey}:${lane.kind}:${lane.live}`),
    [
      "grok-daily:grok-com#signed-out:grok-daily:signed-out:true",
      "grok-daily-b:grok-com#signed-out:grok-daily-b:signed-out:true",
      "grok-daily-c:grok-com#signed-out:grok-daily-c:signed-out:true",
      "grok-daily-d:grok-com#signed-out:grok-daily-d:signed-out:true",
      "grok-daily-e:grok-com#signed-out:grok-daily-e:signed-out:true",
      "grok-daily-f:grok-com#signed-out:grok-daily-f:signed-out:true",
      "grok-daily-g:grok-com#signed-out:grok-daily-g:signed-out:true",
      "grok-daily-h:grok-com#signed-out:grok-daily-h:signed-out:true",
      "grok-auth-email:grok-com#signed-out:grok-auth-email:signed-out:true",
      "grok-auth-gmail:grok-com#signed-out:grok-auth-gmail:signed-out:true",
      "grok-auth-x:grok-com#signed-out:grok-auth-x:signed-out:true",
      "grok-auth-x-out:grok-com#signed-out:grok-auth-x-out:signed-out:true",
      `grok-lab:grok-com#${superGrok}:fixture:true`,
    ],
  );
});

test("three live fixtures are the only concurrent-account yes", () => {
  const summary = summarizeBrowserAccountHealth({
    targetId: "grok-com",
    fixtures: ["a", "b", "c"].map((id) => ({
      reference: `authfx:00000000-0000-4000-8000-00000000000${id}:1`,
      health: { status: "ready" as const },
    })),
  });
  assert.equal(summary.liveCount, 3);
  assert.equal(summary.concurrentAccountsPossible, true);
  assert.equal(summary.electronGrokLabPartitionPresent, false);
});

test("Electron grok-lab health is explicit and not a Playwright pass", () => {
  const absent = summarizeBrowserAccountHealth({
    targetId: "grok-com",
    fixtures: [{ reference: superGrok, health: { status: "ready" } }],
    electronGrokLabPartitionPresent: false,
  });
  assert.equal(absent.electronGrokLabPartitionPresent, false);
  assert.match(absent.electronGrokLabReason, /persist:lane:grok-lab is absent/u);
  const present = summarizeBrowserAccountHealth({
    targetId: "grok-com",
    fixtures: [{ reference: superGrok, health: { status: "ready" } }],
    electronGrokLabPartitionPresent: true,
  });
  assert.equal(present.electronGrokLabPartitionPresent, true);
  assert.match(present.electronGrokLabReason, /persist:lane:grok-lab is present/u);
});

test("collect probes only live fixtures and never invents a second account", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-account-health-"));
  const previous = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_WORKSPACE_ROOT = root;
  try {
    const live = await saveBrowserAuthenticationFixture({
      projectId: "default",
      targetId: "grok-com",
      name: "SuperGrok lab signed-in",
      createdBy: "human:local-cli",
      storageState: {
        cookies: [],
        origins: [{ origin: "https://grok.com", localStorage: [] }],
      },
    });
    const inspected: string[] = [];
    const collected = await collectBrowserTargetAccountHealth({
      projectId: "default",
      targetId: "grok-com",
      probe: true,
      inspectPage: async (_url, context) => {
        inspected.push(context.reference);
        return { title: "Grok", bodyText: "Ask Grok anything\nNew chat" };
      },
    });
    assert.deepEqual(inspected, [live.reference]);
    assert.equal(collected.summary.liveCount, 1);
    assert.equal(collected.summary.concurrentAccountsPossible, false);
    assert.equal(collected.fixtures[0]?.health?.signedIn, true);
    assert.equal(collected.summary.concurrentReason, concurrentBrowserAccountCopy(1));
    assert.equal(typeof collected.summary.electronGrokLabPartitionPresent, "boolean");
    assert.match(collected.summary.electronGrokLabReason, /persist:lane:grok-lab/u);
  } finally {
    if (previous === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});
