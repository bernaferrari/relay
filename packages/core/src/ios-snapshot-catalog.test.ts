import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  setLiveIosRunnerCommandPostForTests,
  snapshotViaLiveIosRunnerListener,
  type LiveIosRunnerCommand,
  type LiveIosRunnerCommandResult,
} from "./ios-runner-listener-command.js";
import type { SnapshotNode } from "./device-capabilities.js";

const bundle = "ai.x.GrokApp";
const bounds = { x: 0, y: 0, width: 1112, height: 834 };
const application = { type: "Application", depth: 0, label: "Grok", rect: bounds };
const hamburger = {
  type: "Button",
  identifier: "sidebar.open.button",
  label: "Open sidebar",
  hittable: true,
  rect: { x: 10, y: 10, width: 44, height: 44 },
};

async function withListener(
  post: (command: LiveIosRunnerCommand) => Promise<LiveIosRunnerCommandResult>,
  run: (serial: string) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "relay-catalog-"));
  const previous = process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
  process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = directory;
  await writeFile(
    join(directory, "catalog-ipad.json"),
    JSON.stringify({ runnerPid: process.pid, port: 50937 }),
  );
  const restore = setLiveIosRunnerCommandPostForTests(async (_listener, command) => post(command));
  try {
    await run("catalog-ipad");
  } finally {
    restore();
    if (previous === undefined) delete process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
    else process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
}

function catalog(
  command: LiveIosRunnerCommand,
  select: (key: string, value: string) => SnapshotNode[],
) {
  const queries = command.selectorQueries as Array<{ selectorKey: string; selectorValue: string }>;
  return {
    ok: true,
    data: {
      selectorCatalog: {
        version: 1,
        source: "xcui-selector-catalog",
        coverage: "requested-selectors",
        appBundleId: bundle,
        appStateBefore: "runningForeground",
        appStateAfter: "runningForeground",
        coordinateSpace: "application-logical",
        geometrySource: "xcui-window-frame",
        bounds,
        results: queries.map(({ selectorKey, selectorValue }, queryIndex) => {
          const nodes = select(selectorKey, selectorValue);
          return {
            queryIndex,
            selectorKey,
            selectorValue,
            ok: true,
            found: nodes.length > 0,
            rawMatchCount: nodes.length,
            hittableMatchCount: nodes.length,
            nodes,
          };
        }),
      },
    },
  };
}

test("catalog observation sends one native selector census and preserves root, aliases, and adaptive Home provenance", async () => {
  const calls: LiveIosRunnerCommand[] = [];
  await withListener(
    async (command) => {
      calls.push(command);
      if (command.command === "querySelectorCatalog")
        return catalog(command, (key, value) => {
          if (
            (key === "id" && value === "sidebar.open.button") ||
            (key === "label" && value === "Open sidebar")
          )
            return [hamburger];
          if (value === "grok-gear") return [{ ...hamburger, label: "grok-gear" }];
          if (value === "sidebar.settings.button")
            return [{ ...hamburger, identifier: value, label: "Settings" }];
          return [];
        });
      if (command.command === "snapshot" && command.depth === 0)
        return { ok: true, data: { nodes: [application] } };
      assert.fail(`unexpected command ${String(command.command)}`);
    },
    async (serial) => {
      const nodes = await snapshotViaLiveIosRunnerListener({
        serial,
        appBundleId: bundle,
        includeLabels: ["Open sidebar"],
        separateRequestedSelectorEvidence: true,
      });
      assert.deepEqual(nodes, [
        application,
        {
          ...hamburger,
          logicalCoordinates: true,
          bundleId: bundle,
          recordingSelectorSupplemental: false,
        },
        {
          ...hamburger,
          logicalCoordinates: true,
          bundleId: bundle,
          recordingSelectorSupplemental: true,
        },
      ]);
      assert.deepEqual(
        calls.map((call) => call.command),
        ["querySelectorCatalog", "snapshot"],
      );
      assert.equal(calls[0]?.timeoutMs, 8_000);
    },
  );
});

test("Sidebar catalog retains exact query order and suppresses Home-only labels", async () => {
  await withListener(
    async (command) => {
      if (command.command === "querySelectorCatalog")
        return catalog(command, (key, value) =>
          key === "label" && ["grok-gear", "New temporary conversation"].includes(value)
            ? [{ ...hamburger, identifier: undefined, label: value }]
            : [],
        );
      return { ok: true, data: { nodes: [application] } };
    },
    async (serial) => {
      const nodes = await snapshotViaLiveIosRunnerListener({
        serial,
        appBundleId: bundle,
        separateRequestedSelectorEvidence: true,
      });
      assert.deepEqual(
        nodes.map((node) => node.label),
        ["Grok", "grok-gear"],
      );
      assert.equal(nodes[1]?.recordingSelectorSupplemental, false);
    },
  );
});

test("unsupported runner, busy census, and malformed per-query receipts fail without retry or selector fallback", async () => {
  for (const failure of [
    {
      ok: false,
      error: { code: "UNSUPPORTED_OPERATION", message: "querySelectorCatalog is unsupported" },
    },
    { ok: false, error: { code: "RUNNER_BUSY", message: "occupied" } },
    { ok: true, data: { selectorCatalog: { version: 1, results: [] } } },
  ]) {
    let calls = 0;
    await withListener(
      async () => {
        calls += 1;
        return failure;
      },
      async (serial) => {
        await assert.rejects(
          snapshotViaLiveIosRunnerListener({ serial, appBundleId: bundle }),
          /catalog|occupied|unsupported/i,
        );
        assert.equal(calls, 1);
      },
    );
  }
});

test("catalog ownership, foreground, geometry, and cardinality refusals cannot become empty UI", async () => {
  const mutations: Array<(receipt: Record<string, unknown>) => void> = [
    (receipt) => {
      receipt.appBundleId = "com.apple.springboard";
    },
    (receipt) => {
      receipt.systemSurface = {};
    },
    (receipt) => {
      receipt.appStateAfter = "runningBackground";
    },
    (receipt) => {
      receipt.coordinateSpace = "device-native";
    },
    (receipt) => {
      receipt.bounds = { ...bounds, width: 0 };
    },
    (receipt) => {
      receipt.results = [];
    },
    (receipt) => {
      (receipt.results as Array<Record<string, unknown>>)[0]!.rawMatchCount = 0;
    },
  ];
  for (const mutate of mutations) {
    let calls = 0;
    await withListener(
      async (command) => {
        calls += 1;
        const result = catalog(command, (_key, value) =>
          value === "ask.toolbar.textfield" ? [{ ...hamburger, identifier: value }] : [],
        );
        mutate(result.data.selectorCatalog as unknown as Record<string, unknown>);
        return result;
      },
      async (serial) => {
        await assert.rejects(
          snapshotViaLiveIosRunnerListener({ serial, appBundleId: bundle }),
          /catalog/i,
        );
        assert.equal(calls, 1);
      },
    );
  }
});

test("catalog envelope ownership and activation refusals cannot be hidden by a valid scoped receipt", async () => {
  for (const envelope of [
    { appBundleId: "" },
    { coordinateSpace: "device-native" },
    { targetActivation: { reason: "stale_target" } },
    { systemSurface: { bundleId: "com.apple.SafariViewService" } },
  ]) {
    let calls = 0;
    await withListener(
      async (command) => {
        calls += 1;
        const result = catalog(command, () => []);
        return { ...result, data: { ...result.data, ...envelope } };
      },
      async (serial) => {
        await assert.rejects(
          snapshotViaLiveIosRunnerListener({ serial, appBundleId: bundle }),
          /catalog/i,
        );
        assert.equal(calls, 1);
      },
    );
  }
});

test("catalog cannot lend its ownership or geometry to a missing, mismatched, or system-surface root", async () => {
  for (const root of [
    { ok: true, data: { nodes: [] } },
    { ok: true, data: { nodes: [{ ...application, bundleId: "com.apple.springboard" }] } },
    { ok: true, data: { nodes: [{ ...application, rect: { ...bounds, width: 834 } }] } },
    {
      ok: true,
      data: { nodes: [application], systemSurface: { bundleId: "com.apple.SafariViewService" } },
    },
    { ok: true, data: { nodes: [application], targetActivation: { reason: "stale_target" } } },
  ]) {
    await withListener(
      async (command) =>
        command.command === "querySelectorCatalog"
          ? catalog(command, (_key, value) => (value === "sidebar.open.button" ? [hamburger] : []))
          : root,
      async (serial) => {
        await assert.rejects(
          snapshotViaLiveIosRunnerListener({ serial, appBundleId: bundle }),
          /catalog|application/i,
        );
      },
    );
  }
});

test("an empty catalog cannot authorize a bounded snapshot after ownership or geometry changes", async () => {
  for (const snapshot of [
    { ok: true, data: { nodes: [{ ...application, bundleId: "com.apple.springboard" }] } },
    {
      ok: true,
      data: { nodes: [application], systemSurface: { bundleId: "com.apple.SafariViewService" } },
    },
    { ok: true, data: { nodes: [{ ...application, logicalCoordinates: false }] } },
    { ok: true, data: { nodes: [application, { ...hamburger, bundleId: "another.application" }] } },
    { ok: true, data: { nodes: [application], targetActivation: { reason: "stale_target" } } },
    { ok: true, data: { nodes: [{ ...application, rect: { ...bounds, height: 1112 } }] } },
  ]) {
    const calls: LiveIosRunnerCommand[] = [];
    await withListener(
      async (command) => {
        calls.push(command);
        return command.command === "querySelectorCatalog" ? catalog(command, () => []) : snapshot;
      },
      async (serial) => {
        await assert.rejects(
          snapshotViaLiveIosRunnerListener({ serial, appBundleId: bundle }),
          /catalog|application/i,
        );
        assert.deepEqual(
          calls.map((call) => call.command),
          ["querySelectorCatalog", "snapshot"],
        );
        assert.equal(calls[1]?.depth, 4);
      },
    );
  }
});
