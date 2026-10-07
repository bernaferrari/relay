import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SnapshotNode } from "./device-capabilities.js";
import { normalizeIosSnapshotNodes } from "./ios-geometry.js";
import {
  identifierNodesViaLiveIosRunnerListener,
  setLiveIosRunnerCommandPostForTests as setNativePost,
  snapshotViaLiveIosRunnerListener,
} from "./ios-runner-listener-command.js";
import { inferSnapshotBounds } from "./workspace-capture.js";
import { catalogAwarePost } from "./ios-snapshot-catalog.fixtures.js";

const setLiveIosRunnerCommandPostForTests: typeof setNativePost = (post) =>
  setNativePost(post ? catalogAwarePost(post) : undefined);

const landscapeSheet: SnapshotNode[] = [
  { depth: 0, type: "Application", rect: { x: 0, y: 0, width: 1112, height: 834 } },
  { depth: 1, type: "Window", rect: { x: 0, y: 0, width: 1112, height: 834 } },
  {
    type: "Button",
    identifier: "PopoverDismissRegion",
    label: "dismiss popup",
    rect: { x: 0, y: 0, width: 1112, height: 834 },
  },
  { type: "NavigationBar", label: "Settings", rect: { x: 204, y: 40, width: 704, height: 56 } },
];

for (const route of ["snapshot", "ambiguous-identifier"] as const) {
  test(`${route} keeps current runner landscape frames in the logical viewport`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "relay-ios-logical-tree-"));
    const serial = `logical-tree-${route}`;
    const previous = process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
    process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = dir;
    await writeFile(
      join(dir, `${serial}.json`),
      JSON.stringify({ runnerPid: process.pid, port: 50937 }),
    );
    let captures = 0;
    const restore = setLiveIosRunnerCommandPostForTests(async (_listener, command) => {
      if (command.command === "querySelector") {
        return route === "ambiguous-identifier"
          ? {
              ok: false,
              error: { code: "AMBIGUOUS_MATCH", message: "selector matched multiple elements" },
            }
          : { ok: true, data: { found: false, nodes: [] } };
      }
      assert.equal(command.command, "snapshot");
      captures += 1;
      return { ok: true, data: { nodes: landscapeSheet } };
    });
    try {
      const received =
        route === "snapshot"
          ? await snapshotViaLiveIosRunnerListener({
              serial,
              appBundleId: "ai.x.GrokApp",
              interactiveOnly: false,
            })
          : await identifierNodesViaLiveIosRunnerListener({
              serial,
              identifier: "PopoverDismissRegion",
            });
      assert.ok(received);
      const normalized = normalizeIosSnapshotNodes(received);
      assert.deepEqual(
        normalized.map(({ rect }) => rect),
        landscapeSheet.map(({ rect }) => rect),
      );
      assert.deepEqual(inferSnapshotBounds(normalized, "ios"), { width: 1112, height: 834 });
      assert.ok(normalized.every(({ logicalCoordinates }) => logicalCoordinates === true));
      assert.ok(landscapeSheet.every(({ logicalCoordinates }) => logicalCoordinates === undefined));
      assert.equal(captures, 1);
    } finally {
      restore();
      if (previous === undefined) delete process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
      else process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = previous;
      await rm(dir, { recursive: true, force: true });
    }
  });
}
