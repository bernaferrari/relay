import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { browserLaneElectronPartition, browserLaneTabSessionKey } from "@relay/protocol";
import { browserAccountSchedulingKey, unsignedBrowserLaneId } from "./browser-account-lane.js";
import { createAppMap, resetControlDatabaseCache } from "./collaboration.js";
import { applyLaneToInteract } from "./lane-run.js";
import {
  GROK_AUTH_EMAIL_LANE,
  GROK_AUTH_GMAIL_LANE,
  GROK_AUTH_X_LANE,
  GROK_AUTH_X_OUT_LANE,
  GROK_LAB_LANE,
  seedGrokLanes,
} from "./lane-seed.js";
import { browserProfileDir, readTarget, saveBrowserTarget } from "./targets.js";

async function withStateRoot<T>(operation: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "relay-grok-auth-lanes-"));
  const previousState = process.env.RELAY_STATE_DIR;
  const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_STATE_DIR = root;
  process.env.RELAY_WORKSPACE_ROOT = root;
  try {
    return await operation(root);
  } finally {
    resetControlDatabaseCache();
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    if (previousWorkspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousWorkspace;
    await rm(root, { recursive: true, force: true });
  }
}

test("unsigned auth Lanes isolate Chrome user-data and scheduler keys", () => {
  const shared = browserProfileDir("grok-com");
  const email = browserProfileDir("grok-com", GROK_AUTH_EMAIL_LANE.id);
  const gmail = browserProfileDir("grok-com", GROK_AUTH_GMAIL_LANE.id);
  const x = browserProfileDir("grok-com", GROK_AUTH_X_LANE.id);
  const xOut = browserProfileDir("grok-com", GROK_AUTH_X_OUT_LANE.id);
  assert.notEqual(email, shared);
  assert.notEqual(gmail, email);
  assert.notEqual(x, xOut);
  assert.equal(email.startsWith(`${shared}/`), false);
  assert.equal(gmail.startsWith(`${shared}/`), false);
  assert.notEqual(
    browserAccountSchedulingKey("grok-com", undefined, GROK_AUTH_EMAIL_LANE.id),
    browserAccountSchedulingKey("grok-com", undefined, GROK_AUTH_GMAIL_LANE.id),
  );
  assert.equal(unsignedBrowserLaneId({ laneId: GROK_AUTH_X_OUT_LANE.id }), GROK_AUTH_X_OUT_LANE.id);
  assert.equal(
    unsignedBrowserLaneId({
      laneId: GROK_LAB_LANE.id,
      accountKind: GROK_LAB_LANE.account.kind,
    }),
    undefined,
  );
  assert.throws(() => browserProfileDir("grok-com", "../etc"), /not a safe browser session key/);
  assert.throws(
    () => browserProfileDir("grok-com", "persist:lane:grok-lab"),
    /cannot reuse an Electron partition|not a safe/u,
  );
  assert.equal(
    browserLaneTabSessionKey({ laneId: GROK_AUTH_GMAIL_LANE.id, targetId: "grok-com" }),
    "lane:grok-auth-gmail",
  );
  assert.equal(
    browserLaneElectronPartition(GROK_AUTH_GMAIL_LANE.id),
    "persist:lane:grok-auth-gmail",
  );
  assert.notEqual(
    browserLaneElectronPartition(GROK_AUTH_EMAIL_LANE.id),
    browserLaneElectronPartition(GROK_AUTH_GMAIL_LANE.id),
  );
  assert.equal(
    browserLaneTabSessionKey({ laneId: GROK_LAB_LANE.id, targetId: "grok-com" }),
    "lane:grok-lab",
  );
});

test("seeded grok-auth Lanes do not persist a fixture onto grok-com", async () => {
  await withStateRoot(async () => {
    await createAppMap({
      organizationId: "local",
      projectId: "default",
      appMapId: "grok-web",
      name: "Grok",
    });
    await saveBrowserTarget({
      id: "grok-com",
      name: "Grok",
      startUrl: "https://grok.com/",
    });
    await seedGrokLanes("default");
    assert.equal(
      (await readTarget("grok-com"))?.browser?.environment?.authenticationFixtureId,
      undefined,
    );
    const email = await applyLaneToInteract({
      projectId: "default",
      laneId: GROK_AUTH_EMAIL_LANE.id,
    });
    assert.deepEqual(email, {
      serial: "grok-com",
      laneId: GROK_AUTH_EMAIL_LANE.id,
      unsignedLaneId: GROK_AUTH_EMAIL_LANE.id,
    });
    const gmail = await applyLaneToInteract({
      projectId: "default",
      laneId: GROK_AUTH_GMAIL_LANE.id,
    });
    assert.equal(gmail.unsignedLaneId, GROK_AUTH_GMAIL_LANE.id);
    assert.equal(gmail.laneId, GROK_AUTH_GMAIL_LANE.id);
    assert.equal(gmail.authenticationFixtureId, undefined);
    const lab = await applyLaneToInteract({
      projectId: "default",
      laneId: GROK_LAB_LANE.id,
    });
    assert.equal(lab.authenticationFixtureId, GROK_LAB_LANE.account.reference);
    assert.equal(lab.laneId, GROK_LAB_LANE.id);
    assert.equal(lab.unsignedLaneId, undefined);
  });
});
