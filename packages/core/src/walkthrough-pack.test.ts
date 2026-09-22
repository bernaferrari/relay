import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AppMap } from "@relay/protocol";
import type { PersistedRun } from "./runs.js";
import { exportWalkthroughPack, verifyWalkthroughPack } from "./walkthrough-pack.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4AWMAgv8AAQQBAP8H9UQAAAAASUVORK5CYII=",
  "base64",
);
const PNG_SHA = createHash("sha256").update(PNG).digest("hex");

function map(): AppMap {
  return {
    schemaVersion: 1,
    id: "walkthrough-map",
    organizationId: "local",
    projectId: "default",
    name: "Walkthrough",
    revision: 3,
    screens: {
      "screen-home": { id: "screen-home", title: "Home" },
      "screen-settings": { id: "screen-settings", title: "Settings" },
    },
    connections: {
      "open-settings": {
        id: "open-settings",
        fromScreenId: "screen-home",
        destination: { kind: "screen", screenId: "screen-settings" },
        label: "Open settings",
        state: "ready",
      },
    },
    tests: {
      "test-settings": {
        id: "test-settings",
        steps: [
          {
            id: "open-settings-step",
            kind: "instruction",
            binding: { status: "resolved", kind: "connections", connectionIds: ["open-settings"] },
          },
        ],
      },
    },
  } as unknown as AppMap;
}

function run(dir: string, id: string, account: string): PersistedRun {
  return {
    id,
    schemaVersion: 5,
    projectId: "default",
    action: "app-map.test.run",
    status: "ok",
    artifacts: [
      {
        kind: "capture-review",
        capturedAt: 2,
        data: {
          framePath: "frames/002.png",
          imageSha256: PNG_SHA,
          slotId: `test-settings::open-settings-step::${account}`,
          requirementId: "test-settings",
          checkpointId: "open-settings-step",
          caption: "Settings",
          configuration: { browser: account === "member" ? "firefox" : "chrome", account },
        },
      },
    ],
    dir,
  } as unknown as PersistedRun;
}

test("walkthrough export pins every joined run and refuses a changed frame", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "relay-walkthrough-pack-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const memberDir = join(root, "member");
  const adminDir = join(root, "admin");
  await mkdir(join(memberDir, "frames"), { recursive: true });
  await mkdir(join(adminDir, "frames"), { recursive: true });
  await writeFile(join(memberDir, "frames", "002.png"), PNG);
  await writeFile(join(adminDir, "frames", "002.png"), PNG);
  const member = run(memberDir, "run-member", "member");
  const admin = run(adminDir, "run-admin", "admin");

  const first = await exportWalkthroughPack({ map: map(), runs: [member, admin], now: 9 });
  const second = await exportWalkthroughPack({ map: map(), runs: [member, admin], now: 9 });
  assert.deepEqual(second, first);
  assert.equal(verifyWalkthroughPack(first).digest, first.digest);
  assert.deepEqual(first.manifest.pinned.runIds, ["run-member", "run-admin"]);
  assert.equal(first.frames.length, 2);
  assert.equal(first.manifest.captures.length, 2);
  assert.equal(first.manifest.variants.length, 2);

  await writeFile(join(adminDir, "frames", "002.png"), Buffer.from("tampered"));
  await assert.rejects(
    () => exportWalkthroughPack({ map: map(), runs: [member, admin], now: 9 }),
    /tampered frame frames\/002\.png on run run-admin/u,
  );

  await rm(join(adminDir, "frames", "002.png"));
  await assert.rejects(
    () => exportWalkthroughPack({ map: map(), runs: [member, admin], now: 9 }),
    /missing frame frames\/002\.png on run run-admin/u,
  );
});
