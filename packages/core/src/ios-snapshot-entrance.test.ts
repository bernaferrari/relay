import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  setLiveIosRunnerCommandPostForTests as setNativePost,
  snapshotViaLiveIosRunnerListener,
} from "./ios-runner-listener-command.js";
import { catalogAwarePost } from "./ios-snapshot-catalog.fixtures.js";

const setLiveIosRunnerCommandPostForTests: typeof setNativePost = (post) =>
  setNativePost(post ? catalogAwarePost(post) : undefined);

// Real listener orchestration; every transport request is injected, with no hardware or input.
test("requested entrance capture tags its actual query census without changing ordinary reads", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-entrance-listener-"));
  const previous = process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
  process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = directory;
  await writeFile(
    join(directory, "entrance-ipad.json"),
    JSON.stringify({ runnerPid: process.pid, port: 50937 }),
  );
  const calls: Array<Record<string, unknown>> = [];
  let surface = false;
  const restore = setLiveIosRunnerCommandPostForTests(async (_listener, command) => {
    calls.push(command);
    assert.equal(command.appBundleId, "ai.x.GrokApp");
    if (command.command === "querySelector") {
      const data =
        command.selectorValue === "sidebar.open.button"
          ? {
              nodes: [
                {
                  identifier: "sidebar.open.button",
                  label: "Open sidebar",
                  hittable: true,
                  rect: { x: 10, y: 10, width: 44, height: 44 },
                },
              ],
            }
          : command.selectorValue === "Quick responses · Grok 4.7"
            ? {
                nodes: [80].map((y) => ({
                  type: "Button",
                  label: "Quick responses · Grok 4.7",
                  hittable: true,
                  recordingSelectorSupplemental: false,
                  rect: { x: 820, y, width: 224, height: 70 },
                })),
              }
            : { nodes: [] };
      return {
        ok: true,
        data: surface
          ? { ...data, systemSurface: { bundleId: "com.apple.SafariViewService" } }
          : data,
      };
    }
    assert.equal(command.command, "snapshot");
    assert.equal(command.depth, 0);
    return {
      ok: true,
      data: {
        nodes: [
          {
            type: "Application",
            depth: 0,
            label: "Grok",
            rect: { x: 0, y: 0, width: 1112, height: 834 },
          },
        ],
      },
    };
  });
  try {
    const options = {
      serial: "entrance-ipad",
      appBundleId: "ai.x.GrokApp",
      includeLabels: ["Quick responses · Grok 4.7"],
    };
    const requested = await snapshotViaLiveIosRunnerListener({
      ...options,
      separateRequestedSelectorEvidence: true,
    });
    assert.equal(requested.filter((node) => node.recordingSelectorSupplemental === true).length, 1);
    assert.equal(
      requested.find((node) => node.identifier === "sidebar.open.button")
        ?.recordingSelectorSupplemental,
      false,
    );
    assert.equal(calls.filter((call) => call.command === "snapshot").length, 1);
    assert.equal(
      calls.filter((call) => call.selectorValue === "Quick responses · Grok 4.7").length,
      1,
    );
    assert.ok(
      calls.every((call) => call.command === "snapshot" || call.command === "querySelector"),
    );
    calls.length = 0;
    const ordinary = await snapshotViaLiveIosRunnerListener(options);
    assert.equal(
      ordinary.find((node) => node.identifier === "sidebar.open.button")
        ?.recordingSelectorSupplemental,
      undefined,
    );
    assert.equal(ordinary.filter((node) => node.label === "Quick responses · Grok 4.7").length, 1);
    surface = true;
    await assert.rejects(
      snapshotViaLiveIosRunnerListener({ ...options, separateRequestedSelectorEvidence: true }),
      /system surface/u,
    );
  } finally {
    restore();
    if (previous === undefined) delete process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
    else process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
