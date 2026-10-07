import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { deviceTestDouble } from "./testing.js";
import { rememberTargetApplication } from "./device-target-applications.js";
import { runWithTargetContext } from "./target-context.js";
import { targetPresent } from "./recipe-runner-support.js";
import { runRecipeStep } from "./recipe-runner.js";
import type { Device, SnapshotNode } from "./device.js";
import {
  setLiveIosRunnerCommandPostForTests,
  type LiveIosRunnerCommand,
  type LiveIosRunnerCommandResult,
} from "./ios-runner-listener-command.js";

const appBundleId = "com.example.product";
const copy: SnapshotNode = { type: "Button", label: "Copy", identifier: "message.copy" };
const root: SnapshotNode = {
  type: "Application",
  depth: 0,
  bundleId: appBundleId,
  rect: { x: 0, y: 0, width: 1112, height: 834 },
};

async function withPresence(
  run: (fixture: {
    device: Device;
    commands: LiveIosRunnerCommand[];
    budgets: number[];
    sdkReads(): number;
  }) => Promise<void>,
  options: {
    query?: LiveIosRunnerCommandResult;
    tree?: LiveIosRunnerCommandResult;
    error?: Error;
    rememberedApp?: string;
    changedAppAfterQuery?: string;
    changedAppAfterTree?: string;
    listener?: boolean;
    sdkFound?: boolean;
  } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "relay-ios-presence-"));
  const serial = directory.split("/").at(-1)!;
  const context = { kind: "device", platform: "ios", serial } as const;
  const previousLease = process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
  const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
  process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = directory;
  process.env.RELAY_WORKSPACE_ROOT = directory;
  if (options.listener !== false) {
    await writeFile(
      join(directory, `${serial}.json`),
      JSON.stringify({
        runnerPid: process.pid,
        ownerPid: process.pid,
        port: 50937,
      }),
    );
  }
  const commands: LiveIosRunnerCommand[] = [];
  const budgets: number[] = [];
  const restore = setLiveIosRunnerCommandPostForTests(async (listener, command, budget) => {
    assert.equal(listener.serial, serial);
    assert.equal(command.appBundleId, appBundleId);
    assert.ok(
      ["querySelector", "snapshot"].includes(String(command.command)),
      "presence sends no input",
    );
    commands.push(command);
    budgets.push(budget);
    if (options.error) throw options.error;
    if (command.command === "querySelector") {
      if (options.changedAppAfterQuery)
        await rememberTargetApplication(options.changedAppAfterQuery, context);
      return options.query ?? { ok: true, data: { found: true, nodes: [copy] } };
    }
    assert.equal(command.interactiveOnly, false);
    assert.equal(command.depth, undefined, "absence cannot be inferred from a depth-capped tree");
    if (options.changedAppAfterTree)
      await rememberTargetApplication(options.changedAppAfterTree, context);
    return options.tree ?? { ok: true, data: { truncated: false, nodes: [root, copy] } };
  });
  let sdkReads = 0;
  const device = deviceTestDouble({
    interactions: {
      async find() {
        sdkReads += 1;
        if (!options.sdkFound)
          throw new Error(
            "iOS find requires an active app session on the target device. Run open first",
          );
      },
    },
    capture: { snapshot: async () => assert.fail("an adopted read must not use SDK capture") },
    command: { wait: async () => assert.fail("terminal presence reads must not poll") },
  });
  try {
    await rememberTargetApplication(options.rememberedApp ?? appBundleId, context);
    await runWithTargetContext(context, () =>
      run({ device, commands, budgets, sdkReads: () => sdkReads }),
    );
  } finally {
    restore();
    if (previousLease === undefined) delete process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
    else process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = previousLease;
    if (previousWorkspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousWorkspace;
    await rm(directory, { recursive: true, force: true });
  }
}

test("explicitly owned adopted label and text presence use exact fresh queries without SDK find", async () => {
  await withPresence(
    async ({ device, commands, budgets, sdkReads }) => {
      assert.equal(await targetPresent(device, { label: "Copy" }, appBundleId), true);
      assert.equal(await targetPresent(device, { text: "copy" }, appBundleId), true);
      assert.deepEqual(
        commands.map((command) => [command.command, command.selectorKey, command.selectorValue]),
        [
          ["querySelector", "label", "Copy"],
          ["querySelector", "text", "copy"],
        ],
      );
      assert.deepEqual(budgets, [8_000, 8_000]);
      assert.equal(sdkReads(), 0);
    },
    { query: { ok: true, data: { found: true, nodes: [{ ...copy, bundleId: appBundleId }] } } },
  );
});

test("a native exact miss still finds substring text in one complete current tree", async () => {
  await withPresence(
    async ({ device, commands, budgets, sdkReads }) => {
      assert.equal(await targetPresent(device, { text: "hello world" }, appBundleId), true);
      assert.equal(commands.length, 2);
      assert.deepEqual(budgets, [8_000, 20_000]);
      assert.equal(sdkReads(), 0);
    },
    {
      query: { ok: true, data: { found: false, nodes: [] } },
      tree: {
        ok: true,
        data: {
          truncated: false,
          nodes: [root, { label: "prefix Hello   World suffix", hittable: false }],
        },
      },
    },
  );
});

for (const surfaceBundleId of ["com.apple.SafariViewService", "com.apple.PassbookUIService"]) {
  test(`an anonymous native Continue match on ${surfaceBundleId} cannot prove product presence`, async () => {
    const anonymous = { type: "Button", label: "Continue", hittable: true };
    await withPresence(
      async ({ device, commands, sdkReads }) => {
        await assert.rejects(
          targetPresent(device, { label: "Continue" }, appBundleId),
          /another application/,
        );
        assert.deepEqual(
          commands.map((command) => command.command),
          ["querySelector", "snapshot"],
        );
        assert.equal(sdkReads(), 0);
      },
      {
        query: { ok: true, data: { found: true, nodes: [anonymous] } },
        tree: {
          ok: true,
          data: {
            truncated: false,
            nodes: [{ ...root, bundleId: undefined }, anonymous],
            systemSurface: { bundleId: surfaceBundleId },
          },
        },
      },
    );
  });
}

test("an anonymous native positive also refuses a freshly observed foreign owner", async () => {
  await withPresence(
    async ({ device, commands }) => {
      await assert.rejects(
        targetPresent(device, { label: "Copy" }, appBundleId),
        /another application/,
      );
      assert.equal(commands.length, 2);
    },
    {
      query: { ok: true, data: { found: true, nodes: [copy] } },
      tree: {
        ok: true,
        data: { truncated: false, nodes: [root, { ...copy, bundleId: "com.example.other" }] },
      },
    },
  );
});

test("a genuine anonymous native positive matches only after the guarded current app snapshot", async () => {
  await withPresence(
    async ({ device, commands, budgets, sdkReads }) => {
      assert.equal(await targetPresent(device, { label: "Copy" }, appBundleId), true);
      assert.deepEqual(
        commands.map((command) => command.command),
        ["querySelector", "snapshot"],
      );
      assert.deepEqual(budgets, [8_000, 20_000]);
      assert.equal(sdkReads(), 0);
    },
    {
      query: { ok: true, data: { found: true, nodes: [copy] } },
      tree: {
        ok: true,
        data: { truncated: false, nodes: [{ ...root, bundleId: undefined }, copy] },
      },
    },
  );
});

test("an anonymous query match is not reused when the current owned tree no longer matches", async () => {
  await withPresence(
    async ({ device, commands, sdkReads }) => {
      assert.equal(await targetPresent(device, { label: "Copy" }, appBundleId), false);
      assert.equal(commands.length, 2);
      assert.equal(sdkReads(), 0);
    },
    {
      query: { ok: true, data: { found: true, nodes: [copy] } },
      tree: { ok: true, data: { truncated: false, nodes: [root] } },
    },
  );
});

test("ambiguous current Copy controls prove presence without authorizing an input", async () => {
  await withPresence(
    async ({ device, commands }) => {
      await runRecipeStep(
        device,
        { kind: "wait-for", target: { label: "Copy" }, timeoutMs: 120_000 },
        { log() {}, recordingIosAppBundleId: appBundleId },
      );
      assert.deepEqual(
        commands.map((command) => command.command),
        ["querySelector", "snapshot"],
      );
    },
    {
      query: {
        ok: false,
        error: { code: "AMBIGUOUS_MATCH", message: "selector matched multiple elements" },
      },
      tree: {
        ok: true,
        data: {
          truncated: false,
          nodes: [root, copy, { ...copy, rect: { x: 500, y: 20, width: 44, height: 44 } }],
        },
      },
    },
  );
});

test("gone passes only after a genuine complete current absence receipt", async () => {
  await withPresence(
    async ({ device, commands, sdkReads }) => {
      await runRecipeStep(
        device,
        { kind: "expect", condition: "gone", target: { label: "Copy" }, timeoutMs: 120_000 },
        { log() {}, recordingIosAppBundleId: appBundleId },
      );
      assert.equal(commands.length, 2);
      assert.equal(sdkReads(), 0);
    },
    {
      query: { ok: true, data: { found: false, nodes: [] } },
      tree: { ok: true, data: { truncated: false, nodes: [root] } },
    },
  );
});

for (const truncated of [true, undefined]) {
  test(`an ${truncated ? "incomplete" : "unproven legacy"} tree cannot prove Copy gone`, async () => {
    await withPresence(
      async ({ device, commands }) => {
        await assert.rejects(
          runRecipeStep(
            device,
            { kind: "expect", condition: "gone", target: { label: "Copy" } },
            { log() {}, recordingIosAppBundleId: appBundleId },
          ),
          /complete current accessibility tree/,
        );
        assert.equal(commands.length, 2);
      },
      {
        query: { ok: true, data: { found: false, nodes: [] } },
        tree: { ok: true, data: { truncated, nodes: [root] } },
      },
    );
  });
}

for (const result of [
  {
    ok: false,
    error: { code: "COMMAND_FAILED", message: "current accessibility tree unavailable" },
  },
  { ok: false, error: { code: "RUNNER_BUSY", message: "still finishing a previous command" } },
  { ok: true, data: { nodes: [] } },
  { data: { found: true, nodes: [copy] } },
] satisfies LiveIosRunnerCommandResult[]) {
  test(`a failed or unknown presence receipt never proves gone (${JSON.stringify(result)})`, async () => {
    await withPresence(
      async ({ device, commands, sdkReads }) => {
        await assert.rejects(
          targetPresent(device, { label: "Copy" }, appBundleId),
          /unavailable|still finishing|authoritative match receipt/,
        );
        assert.equal(commands.length, 1);
        assert.equal(sdkReads(), 0);
      },
      { query: result },
    );
  });
}

test("unknown transport timeout is one read with no retry or SDK fallback", async () => {
  await withPresence(
    async ({ device, commands, sdkReads }) => {
      await assert.rejects(
        targetPresent(device, { label: "Copy" }, appBundleId),
        /read acknowledgement timed out/,
      );
      assert.equal(commands.length, 1);
      assert.equal(sdkReads(), 0);
    },
    { error: new Error("read acknowledgement timed out") },
  );
});

for (const message of ["Timed out reading usbmux", "Timed out connecting to usbmuxd"]) {
  test(`expect visible preserves the current transport failure: ${message}`, async () => {
    const failure = new Error(message);
    await withPresence(
      async ({ device, commands, sdkReads }) => {
        await assert.rejects(
          runRecipeStep(
            device,
            {
              kind: "expect",
              condition: "visible",
              target: { label: "Copy" },
              timeoutMs: 120_000,
            },
            { log() {}, recordingIosAppBundleId: appBundleId },
          ),
          (error) => {
            assert.equal(error, failure);
            assert.doesNotMatch((error as Error).message, /not visible after/);
            return true;
          },
        );
        assert.equal(commands.length, 1);
        assert.equal(sdkReads(), 0);
      },
      { error: failure },
    );
  });
}

test("expect visible still reports an authored condition timeout after a real current absence", async () => {
  await withPresence(
    async ({ device, commands }) => {
      await assert.rejects(
        runRecipeStep(
          device,
          {
            kind: "expect",
            condition: "visible",
            target: { label: "Copy" },
            timeoutMs: 0,
          },
          { log() {}, recordingIosAppBundleId: appBundleId },
        ),
        /not visible after 0s/,
      );
      assert.equal(commands.length, 2);
    },
    {
      query: { ok: true, data: { found: false, nodes: [] } },
      tree: { ok: true, data: { truncated: false, nodes: [root] } },
    },
  );
});

test("missing snapshot success status cannot establish current absence", async () => {
  await withPresence(
    async ({ device, commands, sdkReads }) => {
      await assert.rejects(
        targetPresent(device, { label: "Copy" }, appBundleId),
        /snapshot failed/,
      );
      assert.equal(commands.length, 2);
      assert.equal(sdkReads(), 0);
    },
    {
      query: { ok: true, data: { found: false, nodes: [] } },
      tree: { data: { truncated: false, nodes: [root] } },
    },
  );
});

test("recording app ownership mismatch refuses before any native observation", async () => {
  await withPresence(
    async ({ device, commands, sdkReads }) => {
      await assert.rejects(
        targetPresent(device, { label: "Copy" }, appBundleId),
        /not bound to the recording application/,
      );
      assert.equal(commands.length, 0);
      assert.equal(sdkReads(), 0);
    },
    { rememberedApp: "com.example.other" },
  );
});

for (const query of [
  { ok: true, data: { found: true, nodes: [{ ...copy, bundleId: "com.example.other" }] } },
  {
    ok: true,
    data: { found: true, nodes: [copy], systemSurface: { bundleId: "com.apple.springboard" } },
  },
  { ok: true, data: { found: true, nodes: [copy], systemSurface: {} } },
  {
    ok: true,
    data: { found: true, nodes: [{ ...copy, identifier: "agent-device.clipboard.probe" }] },
  },
] satisfies LiveIosRunnerCommandResult[]) {
  test("foreign, unknown surface and runner-host matches cannot prove product presence", async () => {
    await withPresence(
      async ({ device, commands }) => {
        await assert.rejects(
          targetPresent(device, { label: "Copy" }, appBundleId),
          /another application/,
        );
        assert.equal(commands.length, 1);
      },
      { query },
    );
  });
}

for (const phase of ["query", "tree"] as const) {
  test(`app ownership changing during the ${phase} read refuses the receipt`, async () => {
    await withPresence(
      async ({ device, commands, sdkReads }) => {
        await assert.rejects(
          targetPresent(device, { label: "Copy" }, appBundleId),
          /application changed during observation/,
        );
        assert.equal(commands.length, phase === "query" ? 1 : 2);
        assert.equal(sdkReads(), 0);
      },
      phase === "query"
        ? { changedAppAfterQuery: "com.example.other" }
        : {
            query: { ok: true, data: { found: false, nodes: [] } },
            changedAppAfterTree: "com.example.other",
          },
    );
  });
}

test("without an adopted listener the existing SDK presence route stays available", async () => {
  await withPresence(
    async ({ device, commands, sdkReads }) => {
      assert.equal(await targetPresent(device, { label: "Copy" }), true);
      assert.equal(commands.length, 0);
      assert.equal(sdkReads(), 1);
    },
    { listener: false, sdkFound: true },
  );
});

test("Android and browser presence still use their existing SDK route", async () => {
  await withPresence(
    async ({ device, commands, sdkReads }) => {
      for (const context of [
        { kind: "device", platform: "android", serial: "android-presence" },
        { kind: "browser", platform: "browser", targetId: "browser-presence" },
      ] as const) {
        assert.equal(
          await runWithTargetContext(context, () => targetPresent(device, { label: "Copy" })),
          true,
        );
      }
      assert.equal(commands.length, 0);
      assert.equal(sdkReads(), 2);
    },
    { sdkFound: true },
  );
});
