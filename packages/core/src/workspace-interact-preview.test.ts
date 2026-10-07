import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PNG } from "pngjs";
import { rememberTargetApplication } from "./device.js";
import { setLiveIosRunnerCommandPostForTests } from "./ios-runner-listener-command.js";
import { runWithTargetContext } from "./target-context.js";
import { deviceTestDouble } from "./testing.js";
import { cleanupScreenshot } from "./workspace-capture.js";
import { previewInteract } from "./workspace-interact.js";

const appBundleId = "com.example.preview";
const rect = { x: 80, y: 160, width: 200, height: 50 };
const windowBounds = { x: 0, y: 0, width: 1112, height: 834 };

function receipt(status: string) {
  return {
    version: 1,
    source: "xcui-tap-selector-policy",
    appBundleId,
    appStateBefore: "runningForeground",
    appStateAfter: "runningForeground",
    selectorKey: "label",
    selectorValue: "Fast",
    allowNonHittableCoordinateFallback: true,
    filtersByExpectedPoint: false,
    coordinateSpace: "application-logical",
    status,
    candidateCount: status === "ambiguous" ? 2 : 1,
    ...(status === "resolved"
      ? { candidateBounds: rect, candidateHittable: true, windowBounds }
      : {}),
  };
}

async function fixture(value: unknown, expectedState: string, remembered = true) {
  const directory = await mkdtemp(join(tmpdir(), "relay-preview-receipt-"));
  const serial = directory.split("/").at(-1)!;
  const context = { kind: "device", platform: "ios", serial } as const;
  const previous = {
    lease: process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR,
    state: process.env.RELAY_STATE_DIR,
    goIos: process.env.RELAY_GO_IOS_BIN,
  };
  process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = directory;
  process.env.RELAY_STATE_DIR = directory;
  process.env.RELAY_GO_IOS_BIN = "/usr/bin/false";
  await writeFile(
    join(directory, `${serial}.json`),
    JSON.stringify({ runnerPid: process.pid, ownerPid: process.pid, port: 50937 }),
  );
  const png = new PNG({ width: 2224, height: 1668 });
  png.data.fill(255);
  const raster = PNG.sync.write(png);
  const order: string[] = [];
  let mutations = 0;
  let snapshots = 0;
  let probes = 0;
  const restore = setLiveIosRunnerCommandPostForTests(async (_listener, command) => {
    if (command.command === "querySelectorTapCandidate") {
      probes += 1;
      order.push("receipt");
      assert.equal(command.appBundleId, appBundleId);
      assert.equal(command.allowNonHittableCoordinateFallback, true);
      assert.equal(command.selectorKey, "label");
      return { ok: true, data: { selectorCandidateReceipt: value } };
    }
    if (command.command === "snapshot" || command.command === "querySelector") {
      snapshots += 1;
      return {
        ok: true,
        data: {
          nodes:
            command.selectorValue === "toolbar.model.selector.button"
              ? [
                  {
                    type: "Button",
                    identifier: "toolbar.model.selector.button",
                    label: "Fast",
                    hittable: true,
                    rect,
                  },
                ]
              : [],
        },
      };
    }
    mutations += 1;
    throw new Error("preview cannot send native input");
  });
  const device = deviceTestDouble({
    capture: {
      snapshot: async () => {
        snapshots += 1;
        return { nodes: [] };
      },
      screenshot: async (input: { path: string }) => {
        order.push("png");
        await writeFile(input.path, raster);
      },
    },
    interactions: {
      press: async () => {
        mutations += 1;
      },
    },
  });
  try {
    if (remembered) await rememberTargetApplication(appBundleId, context);
    const result = await runWithTargetContext(context, () =>
      previewInteract({ kind: "label", label: "Fast", point: { x: 900, y: 700 } }, { device }),
    );
    try {
      assert.equal(result.resolutionState, expectedState);
      assert.equal(mutations, 0);
      assert.equal(probes, remembered ? 1 : 0);
      assert.equal(snapshots, 0);
      assert.deepEqual(order, remembered ? ["receipt", "png"] : ["png"]);
      if (expectedState === "resolved") {
        assert.deepEqual(result.resolution, {
          method: "label",
          bounds: rect,
          point: { x: 180, y: 185 },
        });
        assert.equal(Buffer.from(result.base64, "base64").equals(raster), false);
      } else {
        assert.equal(result.resolution, undefined);
        assert.equal(Buffer.from(result.base64, "base64").equals(raster), true);
      }
    } finally {
      await cleanupScreenshot(result.path);
    }
  } finally {
    restore();
    for (const [key, saved] of [
      ["AGENT_DEVICE_IOS_RUNNER_LEASE_DIR", previous.lease],
      ["RELAY_STATE_DIR", previous.state],
      ["RELAY_GO_IOS_BIN", previous.goIos],
    ] as const) {
      if (saved === undefined) delete process.env[key];
      else process.env[key] = saved;
    }
    await rm(directory, { recursive: true, force: true });
  }
}

for (const state of ["resolved", "ambiguous", "unresolved", "unavailable"]) {
  test(`native ${state} receipt controls actual preview rather than bounded Fast or fallback point`, () =>
    fixture(receipt(state), state));
}
test("an old runner reply without a receipt stays unmarked", () =>
  fixture(undefined, "unavailable"));
test("a foreign app receipt stays unmarked", () =>
  fixture({ ...receipt("resolved"), appBundleId: "com.example.foreign" }, "unavailable"));
test("a preview without explicit remembered app cannot query or mark", () =>
  fixture(undefined, "unavailable", false));
test("offset window geometry cannot create a full-display marker", () =>
  fixture({ ...receipt("resolved"), windowBounds: { ...windowBounds, x: 204 } }, "unavailable"));
test("a receipt for another selector cannot annotate the requested label", () =>
  fixture({ ...receipt("resolved"), selectorValue: "Auto" }, "unavailable"));
test("a nonhittable fallback candidate cannot be promoted to a preview location", () =>
  fixture({ ...receipt("resolved"), candidateHittable: false }, "unavailable"));
test("a rotated logical window cannot mark landscape pixels", () =>
  fixture(
    { ...receipt("resolved"), windowBounds: { x: 0, y: 0, width: 834, height: 1112 } },
    "unavailable",
  ));
