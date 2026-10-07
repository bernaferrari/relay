import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  clearControl,
  JobCancelledError,
  JobControlOwnershipError,
  requestCancel,
  runWithJobControl,
} from "./control.js";
import { rememberTargetApplication } from "./device.js";
import { setIosAppOpenRuntimeForTests } from "./ios-app-open.js";
import {
  setLiveIosRunnerCommandPostForTests,
  type LiveIosRunnerCommandResult,
} from "./ios-runner-listener-command.js";
import { runExpectScreenStep } from "./recipe-runner-screen.js";
import type { RecipeRuntimeState } from "./recipe-runner-context.js";
import { observeScreenIdentity } from "./screen-identity.js";
import { runColdAppMapStartup } from "./session-provider-execution.js";
import type { TestJob } from "./session-contract.js";
import { runWithTargetContext } from "./target-context.js";
import { reserveTargetControl } from "./target-control.js";
import { runWithTargetSupervisorStore, TargetSupervisorStore } from "./target-supervisor-store.js";
import { deviceTestDouble } from "./testing.js";

const bundleId = "com.example.cold-test";
const nodes = [
  { type: "Application", depth: 0, bundleId, rect: { x: 0, y: 0, width: 1112, height: 834 } },
  { type: "Button", identifier: "sidebar.open.button", label: "Menu", bundleId },
];
const identity = observeScreenIdentity(nodes);

async function withColdStartup(
  operation: (value: {
    job: TestJob;
    startup(): Promise<void>;
    verify(): Promise<void>;
    runtime: RecipeRuntimeState;
    events: string[];
  }) => Promise<void>,
  options: {
    stateReply?: (input: {
      job: TestJob;
      read: number;
      timeoutMs: number;
      changeLease(): Promise<void>;
      changeApplication(): Promise<void>;
    }) => Promise<LiveIosRunnerCommandResult>;
    snapshotFailure?: { code: string; message: string };
  } = {},
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "relay-cold-launch-"));
  const serial = directory.split("/").at(-1)!;
  const context = { kind: "device", platform: "ios", serial } as const;
  const previousLease = process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
  const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
  process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = directory;
  process.env.RELAY_WORKSPACE_ROOT = directory;
  await writeFile(
    join(directory, `${serial}.json`),
    JSON.stringify({ runnerPid: process.pid, ownerPid: process.pid, port: 50937 }),
  );
  const events: string[] = [];
  const job: TestJob = {
    id: serial,
    targetContext: context,
    serial,
    platform: "ios",
    targetKind: "device",
    action: "saved-test",
    status: "running",
    queuedAt: 1,
    attempts: 1,
    logs: [],
    steps: [],
    frames: [],
    glyphs: [],
    kind: "Verify",
    tone: "dim",
    title: "Cold launch",
    artifacts: [],
    resolvedInputs: {},
    evidencePolicy: { schemaVersion: 1, sensitive: {} },
  };
  const runtime: RecipeRuntimeState = {};
  const device = deviceTestDouble({
    apps: { open: async () => assert.fail("No SDK launch") },
    capture: { snapshot: async () => assert.fail("No SDK snapshot") },
    interactions: { press: async () => assert.fail("No input") },
  });
  let stateReads = 0;
  let foreground = false;
  const restorePost = setLiveIosRunnerCommandPostForTests(async (listener, command, timeoutMs) => {
    assert.equal(listener.serial, serial);
    assert.equal(command.appBundleId, bundleId);
    events.push(String(command.command));
    if (command.command === "appState") {
      stateReads += 1;
      assert.ok(timeoutMs > 0 && timeoutMs * 2 <= 15_000);
      assert.equal(command.timeoutMs, timeoutMs);
      if (options.stateReply) {
        const reply = await options.stateReply({
          job,
          read: stateReads,
          timeoutMs,
          changeLease: () =>
            writeFile(
              join(directory, `${serial}.json`),
              JSON.stringify({ runnerPid: process.pid, ownerPid: process.pid, port: 50938 }),
            ),
          changeApplication: () => rememberTargetApplication("com.example.foreign", context),
        });
        foreground = reply.data?.applicationState === "runningForeground";
        return reply;
      }
      foreground = stateReads >= 2;
      return {
        ok: true,
        data: { applicationState: foreground ? "runningForeground" : "notRunning" },
      };
    }
    if (!foreground || options.snapshotFailure) {
      return {
        ok: false,
        error: options.snapshotFailure ?? {
          code: "APP_NOT_RUNNING",
          message: "App is not running",
        },
      };
    }
    if (command.command === "snapshot") {
      return { ok: true, data: { nodes: command.depth === 0 ? [nodes[0]!] : nodes } };
    }
    assert.equal(command.command, "querySelector");
    const matches = nodes.filter((node) => node.identifier === command.selectorValue);
    return { ok: true, data: { found: matches.length > 0, nodes: matches } };
  });
  setIosAppOpenRuntimeForTests({
    resolveBundleId: () => bundleId,
    launch: async (actualSerial, actualBundle, options) => {
      assert.equal(actualSerial, serial);
      assert.equal(actualBundle, bundleId);
      assert.deepEqual(options, { relaunch: true });
      events.push("launch");
      return { bundleId, method: "devicectl" };
    },
  });
  const store = new TargetSupervisorStore(":memory:");
  const release = reserveTargetControl(serial, job.id);
  try {
    await runWithTargetSupervisorStore(store, () =>
      runWithJobControl(job.id, () =>
        runWithTargetContext(context, () =>
          operation({
            job,
            runtime,
            events,
            startup: () => runColdAppMapStartup(job, device, "cold", bundleId, () => {}),
            verify: () =>
              runExpectScreenStep(
                device,
                {
                  kind: "expect-screen",
                  screenId: "home",
                  screenTitle: "Home",
                  fingerprint: identity.fingerprint,
                  observations: [identity],
                  expectedApp: bundleId,
                  timeoutMs: 0,
                },
                { job, runtime, log: () => {}, observeVisualFingerprint: async () => undefined },
              ),
          }),
        ),
      ),
    );
  } finally {
    release();
    clearControl(job.id);
    restorePost();
    setIosAppOpenRuntimeForTests();
    store.close();
    if (previousLease === undefined) delete process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
    else process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = previousLease;
    if (previousWorkspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousWorkspace;
    await rm(directory, { recursive: true, force: true });
  }
}

test("cold saved physical launch waits for native foreground before a fresh strict source read", async () => {
  await withColdStartup(async ({ startup, verify, runtime, events }) => {
    await startup();
    await verify();
    assert.equal(events.filter((event) => event === "launch").length, 1);
    assert.deepEqual(events.slice(0, 3), ["launch", "appState", "appState"]);
    assert.ok(events.slice(3).includes("querySelector"));
    assert.equal(runtime.navigationCursor?.status, "proven");
    assert.equal(runtime.navigationCursor?.screenId, "home");
  });
});

test("state read errors, busy occupancy, and malformed replies stop after one launch and one probe", async () => {
  const failures: Array<{ reply(): Promise<LiveIosRunnerCommandResult>; expected: RegExp }> = [
    {
      reply: async () => ({
        ok: false,
        error: { code: "RUNNER_BUSY", message: "private details" },
      }),
      expected: /runner-busy\/RUNNER_BUSY/,
    },
    {
      reply: async () => ({
        ok: false,
        error: { code: "MAIN_THREAD_TIMEOUT", message: "private details" },
      }),
      expected: /timeout\/MAIN_THREAD_TIMEOUT/,
    },
    {
      reply: async () => ({
        ok: true,
        runnerMainThreadBusy: true,
        data: { applicationState: "runningForeground" },
      }),
      expected: /runner-busy\/RUNNER_BUSY/,
    },
    {
      reply: async () => ({ ok: true, data: { applicationState: "invalid" } }),
      expected: /malformed-state/,
    },
    { reply: async () => ({}), expected: /read-failed/ },
    {
      reply: async () => {
        throw Object.assign(new Error("private transport"), { code: "ETIMEDOUT" });
      },
      expected: /timeout\/ETIMEDOUT/,
    },
  ];
  for (const failure of failures) {
    await withColdStartup(
      async ({ startup, events, job }) => {
        await assert.rejects(startup(), failure.expected);
        assert.deepEqual(events, ["launch", "appState"]);
        assert.doesNotMatch(JSON.stringify(job.artifacts), /private/);
      },
      { stateReply: failure.reply },
    );
  }
});

test("valid nonforeground state cannot exceed the absolute 15 second deadline or trigger another launch", async (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  try {
    await withColdStartup(
      async ({ startup, events }) => {
        await assert.rejects(startup(), /foreground-deadline/);
        assert.deepEqual(events, ["launch", "appState"]);
      },
      {
        stateReply: async ({ timeoutMs }) => {
          assert.equal(timeoutMs, 2_000);
          t.mock.timers.tick(15_000);
          return { ok: true, data: { applicationState: "notRunning" } };
        },
      },
    );
  } finally {
    t.mock.timers.reset();
  }
});

test("cancellation and changed app or listener ownership forbid subsequent state or screen reads", async () => {
  for (const change of ["cancel", "app", "listener"] as const) {
    await withColdStartup(
      async ({ startup, events }) => {
        await assert.rejects(
          startup(),
          change === "cancel"
            ? JobCancelledError
            : change === "app"
              ? JobControlOwnershipError
              : /listener-changed/,
        );
        assert.deepEqual(events, ["launch", "appState"]);
      },
      {
        stateReply: async ({ job, changeLease, changeApplication }) => {
          if (change === "cancel") requestCancel(job.id);
          else if (change === "app") await changeApplication();
          else await changeLease();
          return { ok: true, data: { applicationState: "runningForeground" } };
        },
      },
    );
  }
});

test("foreground readiness never substitutes screen proof and actual native source failure retains its allowlisted code", async () => {
  await withColdStartup(
    async ({ startup, verify, runtime, job, events }) => {
      await startup();
      await assert.rejects(verify(), /semantic-read failed-read.*app-unavailable\/APP_NOT_RUNNING/);
      assert.equal(runtime.navigationCursor?.status, "unknown");
      assert.equal(runtime.observation, undefined);
      assert.equal(events.filter((event) => event === "launch").length, 1);
      const failure = job.artifacts.find(
        (artifact) => artifact.kind === "screen-inspection-failure",
      );
      assert.ok(failure);
      assert.doesNotMatch(JSON.stringify(failure), /private/);
    },
    {
      stateReply: async () => ({ ok: true, data: { applicationState: "runningForeground" } }),
      snapshotFailure: {
        code: "APP_NOT_RUNNING",
        message: "App is not running; private native body",
      },
    },
  );
});
