import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  clearControl,
  cooperativeCheckpoint,
  JobCancelledError,
  JobControlOwnershipError,
  requestCancel,
  runWithJobControl,
  setControlValidator,
} from "./control.js";
import { rememberTargetApplication, type Device, type SnapshotNode } from "./device.js";
import { setLocalDeviceProvider } from "./device-factory.js";
import { setIosAppOpenRuntimeForTests } from "./ios-app-open.js";
import {
  setLiveIosRunnerCommandPostForTests,
  type LiveIosRunnerCommand,
} from "./ios-runner-listener-command.js";
import { runRecipeStep } from "./recipe-runner.js";
import type { RecipeRuntimeState } from "./recipe-runner-context.js";
import { targetPresent } from "./recipe-runner-support.js";
import { observeScreenIdentity } from "./screen-identity.js";
import { ensureSavedTestIosRunner } from "./session-ios-runner-readiness.js";
import {
  acquirePreparedSessionDevice,
  runColdAppMapStartup,
} from "./session-provider-execution.js";
import type { TestJob } from "./session-contract.js";
import { runWithTargetContext } from "./target-context.js";
import { reserveTargetControl, TargetControlReservedError } from "./target-control.js";
import { runWithTargetSupervisorStore, TargetSupervisorStore } from "./target-supervisor-store.js";
import { deviceTestDouble } from "./testing.js";
import {
  ensureIosRunnerPrepared,
  resetIosRunnerState,
  setIosSessionHostRuntimeForTests,
} from "./workspace-ios-session.js";

const appBundleId = "com.example.saved-test";
const nodes: SnapshotNode[] = [
  {
    type: "Application",
    depth: 0,
    bundleId: appBundleId,
    rect: { x: 0, y: 0, width: 1112, height: 834 },
  },
  {
    type: "Button",
    identifier: "sidebar.open.button",
    label: "Menu",
    bundleId: appBundleId,
    rect: { x: 16, y: 20, width: 44, height: 44 },
  },
];

async function withSavedStartup(
  run: (fixture: {
    job: TestJob;
    device: Device;
    store: TargetSupervisorStore;
    acquire(): Promise<Device>;
    writeLease(): Promise<void>;
    commands: LiveIosRunnerCommand[];
    logs: string[];
    counts: { preparations: number; launches: number; sdkReads: number };
  }) => Promise<void>,
  options: { live?: boolean; missingAfterPrepare?: boolean; preparationError?: Error } = {},
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "relay-saved-ios-startup-"));
  const serial = directory.split("/").at(-1)!;
  const context = { kind: "device", platform: "ios", serial } as const;
  const previousLease = process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
  const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
  process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = directory;
  process.env.RELAY_WORKSPACE_ROOT = directory;
  const store = new TargetSupervisorStore(":memory:");
  const counts = { preparations: 0, launches: 0, sdkReads: 0 };
  const logs: string[] = [];
  const commands: LiveIosRunnerCommand[] = [];
  const job = {
    id: serial,
    targetContext: context,
    platform: "ios",
    serial,
    artifacts: [],
  } as TestJob;
  const device = deviceTestDouble({
    capture: {
      async snapshot() {
        counts.sdkReads += 1;
        throw new Error("iOS snapshot requires an active app session on the target device");
      },
    },
    interactions: {
      async find() {
        counts.sdkReads += 1;
        throw new Error("iOS find requires an active app session on the target device");
      },
    },
    command: { wait: async () => assert.fail("startup and immediate assertions must not poll") },
  });
  const writeLease = () =>
    writeFile(
      join(directory, `${serial}.json`),
      JSON.stringify({ runnerPid: process.pid, ownerPid: process.pid, port: 50937 }),
    );
  if (options.live) await writeLease();
  const restoreHost = setIosSessionHostRuntimeForTests({
    prepareIosRunner: async (_device, selection) => {
      counts.preparations += 1;
      assert.equal(selection.udid, serial);
      if (options.preparationError) throw options.preparationError;
      if (!options.missingAfterPrepare) await writeLease();
    },
    recoverIosRuntime: async () => assert.fail("saved startup must not enter full host recovery"),
  });
  const restorePost = setLiveIosRunnerCommandPostForTests(async (listener, command) => {
    assert.equal(listener.serial, serial);
    assert.equal(command.appBundleId, appBundleId);
    commands.push(command);
    if (command.command === "appState") {
      return { ok: true, data: { applicationState: "runningForeground" } };
    }
    if (command.command === "snapshot") {
      return {
        ok: true,
        data: { truncated: false, nodes: command.depth === 0 ? [nodes[0]!] : nodes },
      };
    }
    assert.equal(command.command, "querySelector", "startup assertions send no input");
    const matches = nodes.filter((node) =>
      command.selectorKey === "id"
        ? node.identifier === command.selectorValue
        : node.label === command.selectorValue,
    );
    return { ok: true, data: { found: matches.length > 0, nodes: matches } };
  });
  setLocalDeviceProvider({ kind: "device", create: () => device });
  setIosAppOpenRuntimeForTests({
    resolveBundleId: () => appBundleId,
    launch: async () => {
      counts.launches += 1;
      assert.fail("saved acquisition must not activate the app as a session prime");
    },
  });
  resetIosRunnerState();
  const release = reserveTargetControl(serial, job.id);
  try {
    await rememberTargetApplication(appBundleId, context);
    await runWithTargetSupervisorStore(store, () =>
      runWithJobControl(job.id, () =>
        runWithTargetContext(context, () =>
          run({
            job,
            device,
            store,
            writeLease,
            commands,
            logs,
            counts,
            acquire: () =>
              acquirePreparedSessionDevice(
                job,
                { browserTarget: null },
                (line) => logs.push(line),
                {
                  requirePhysicalIosSemantics: true,
                },
              ),
          }),
        ),
      ),
    );
  } finally {
    release();
    clearControl(job.id);
    restoreHost();
    restorePost();
    setLocalDeviceProvider(undefined);
    setIosAppOpenRuntimeForTests();
    resetIosRunnerState();
    store.close();
    if (previousLease === undefined) delete process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
    else process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = previousLease;
    if (previousWorkspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousWorkspace;
    await rm(directory, { recursive: true, force: true });
  }
}

test("saved physical acquisition prepares missing runner before fresh strict source and Copy absence", async () => {
  await withSavedStartup(async ({ acquire, job, counts, commands, logs }) => {
    const device = await acquire();
    let coldLaunches = 0;
    await runColdAppMapStartup(
      job,
      device,
      "cold",
      appBundleId,
      () => undefined,
      async () => {
        coldLaunches += 1;
      },
    );
    const runtime: RecipeRuntimeState = {};
    const identity = observeScreenIdentity(nodes);
    await runRecipeStep(
      device,
      {
        kind: "expect-screen",
        screenId: "home",
        screenTitle: "Home",
        fingerprint: identity.fingerprint,
        expectedApp: appBundleId,
        timeoutMs: 0,
        observations: [identity],
      },
      { log: () => undefined, runtime },
    );
    assert.ok(runtime.navigationCursor?.status === "proven");
    assert.equal(runtime.navigationCursor.screenId, "home");
    assert.equal(await targetPresent(device, { text: "Copy" }, appBundleId), false);
    assert.equal(counts.preparations, 1);
    assert.equal(coldLaunches, 1);
    assert.equal(counts.launches, 0);
    assert.equal(counts.sdkReads, 0);
    assert.ok(logs.some((line) => line.includes("prepared live")));
    assert.ok(
      commands.some((command) => command.command === "snapshot" && command.depth === undefined),
    );
  });
});

test("saved physical acquisition adopts healthy runner without preparation or activation", async () => {
  await withSavedStartup(
    async ({ acquire, counts }) => {
      await acquire();
      assert.deepEqual(counts, { preparations: 0, launches: 0, sdkReads: 0 });
    },
    { live: true },
  );
});

test("missing post-preparation listener stops saved acquisition before launch or SDK fallback", async () => {
  await withSavedStartup(
    async ({ acquire, counts }) => {
      await assert.rejects(acquire(), /could not start device control.*Reconnect/u);
      assert.deepEqual(counts, { preparations: 1, launches: 0, sdkReads: 0 });
    },
    { missingAfterPrepare: true },
  );
});

test("saved acquisition preserves preparation diagnostics without another attempt", async () => {
  const failure = new Error("Xcode preparation failed with a concrete signing cause");
  await withSavedStartup(
    async ({ acquire, counts, logs }) => {
      await assert.rejects(acquire(), (error) => error instanceof Error && error.cause === failure);
      assert.equal(counts.preparations, 1);
      assert.ok(logs.some((line) => line.includes(failure.message)));
    },
    { preparationError: failure },
  );
});

test("pending uncertain input blocks saved preparation and activation without clearing the fence", async () => {
  for (const live of [false, true]) {
    await withSavedStartup(
      async ({ acquire, job, store, counts }) => {
        const target = { id: job.serial!, kind: "ios" } as const;
        store.transition(target, {
          kind: "input.intent-persisted",
          mutationId: "unknown-Fast",
          intent: "Fast",
        });
        store.transition(target, { kind: "input.dispatched", mutationId: "unknown-Fast" });
        store.transition(target, {
          kind: "input.outcome-unknown",
          mutationId: "unknown-Fast",
          reason: "Fast acknowledgment lost",
        });
        await assert.rejects(acquire(), /blocked pending observation and review/u);
        assert.deepEqual(counts, { preparations: 0, launches: 0, sdkReads: 0 });
        assert.equal(store.health(target).input.pendingMutationId, "unknown-Fast");
        assert.equal(store.health(target).input.state, "uncertain");
      },
      { live },
    );
  }
});

test("lost job ownership or cancellation prevents saved preparation", async () => {
  for (const cancelled of [false, true]) {
    await withSavedStartup(async ({ acquire, job, counts }) => {
      if (cancelled) requestCancel(job.id);
      else
        setControlValidator(job.id, async () => {
          throw new JobControlOwnershipError();
        });
      await assert.rejects(acquire(), cancelled ? JobCancelledError : JobControlOwnershipError);
      assert.equal(counts.preparations, 0);
      assert.equal(counts.launches, 0);
    });
  }
});

test("preparation ownership and cancellation errors retain their exact type", async () => {
  for (const error of [
    new JobControlOwnershipError(),
    new JobCancelledError(),
    new TargetControlReservedError("target"),
  ]) {
    await withSavedStartup(
      async ({ acquire }) => {
        await assert.rejects(acquire(), (actual) => actual === error);
      },
      { preparationError: error },
    );
  }
});

test("cancellation during preparation drains startup before returning and prevents launch", async () => {
  await withSavedStartup(async ({ job, device, counts }) => {
    let started!: () => void;
    let finish!: () => void;
    const preparationStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const preparationFinished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let returned = false;
    const startup = ensureSavedTestIosRunner(device, job.targetContext, () => undefined, {
      probe: async () => null,
      checkpoint: cooperativeCheckpoint,
      prepare: async () => {
        started();
        await preparationFinished;
      },
    });
    const outcome = startup.then(
      () => {
        returned = true;
      },
      (error: unknown) => {
        returned = true;
        return error;
      },
    );
    await preparationStarted;
    requestCancel(job.id);
    await Promise.resolve();
    assert.equal(returned, false, "target startup remains reserved until bounded prepare settles");
    finish();
    assert.ok((await outcome) instanceof JobCancelledError);
    assert.equal(counts.launches, 0);
  });
});

test("a new uncertain mutation during preparation blocks the post-prepare startup boundary", async () => {
  await withSavedStartup(async ({ job, device, store, counts, writeLease }) => {
    const target = { id: job.serial!, kind: "ios" } as const;
    await assert.rejects(
      ensureSavedTestIosRunner(device, job.targetContext, () => undefined, {
        probe: async () => null,
        checkpoint: cooperativeCheckpoint,
        prepare: async () => {
          await writeLease();
          store.transition(target, {
            kind: "input.intent-persisted",
            mutationId: "late-unknown",
            intent: "Fast",
          });
          store.transition(target, { kind: "input.dispatched", mutationId: "late-unknown" });
          store.transition(target, {
            kind: "input.outcome-unknown",
            mutationId: "late-unknown",
            reason: "acknowledgment lost",
          });
        },
      }),
      /blocked pending observation and review/u,
    );
    assert.equal(store.health(target).input.pendingMutationId, "late-unknown");
    assert.equal(counts.launches, 0);
  });
});

test("saved readiness bypasses simulator browser Android and provider targets", async () => {
  for (const context of [
    { kind: "device", platform: "ios", serial: "12345678-1234-1234-1234-123456789ABC" },
    { kind: "device", platform: "android", serial: "android" },
    { kind: "browser", platform: "browser", targetId: "browser" },
    { kind: "cloud", platform: "ios", provider: "remote", sessionId: "remote" },
  ] as const) {
    await ensureSavedTestIosRunner({} as Device, context, () => assert.fail("no startup work"), {
      checkpoint: async () => assert.fail("no local control checks"),
      probe: async () => assert.fail("no local runner probe"),
      prepare: async () => assert.fail("no local preparation"),
    });
  }
});

test("settled physical preparation is revalidated and prepared again after runner death", async () => {
  let preparations = 0;
  let live = false;
  const serial = "cache-ipad";
  const restore = setIosSessionHostRuntimeForTests({
    prepareIosRunner: async () => {
      preparations += 1;
      live = true;
    },
    probeLiveIosRunnerListener: async () => (live ? { serial, runnerPid: 123, port: 1 } : null),
  });
  resetIosRunnerState();
  try {
    await ensureIosRunnerPrepared({} as Device, serial);
    await ensureIosRunnerPrepared({} as Device, serial);
    assert.equal(preparations, 1);
    live = false;
    await ensureIosRunnerPrepared({} as Device, serial);
    assert.equal(preparations, 2);
  } finally {
    restore();
    resetIosRunnerState();
  }
});

test("concurrent callers keep one preparation in flight despite missing listener", async () => {
  let preparations = 0;
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const restore = setIosSessionHostRuntimeForTests({
    prepareIosRunner: async () => {
      preparations += 1;
      await pending;
    },
    probeLiveIosRunnerListener: async () => null,
  });
  resetIosRunnerState();
  try {
    const first = ensureIosRunnerPrepared({} as Device, "in-flight-ipad");
    const second = ensureIosRunnerPrepared({} as Device, "in-flight-ipad");
    assert.equal(preparations, 1);
    finish();
    await Promise.all([first, second]);
  } finally {
    finish();
    restore();
    resetIosRunnerState();
  }
});

test("settled cache revalidation cannot delete a replacement preparation already in flight", async () => {
  let preparations = 0;
  let probing!: () => void;
  let finish!: () => void;
  const probeGate = new Promise<void>((resolve) => {
    probing = resolve;
  });
  const preparationGate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const restore = setIosSessionHostRuntimeForTests({
    prepareIosRunner: async () => {
      preparations += 1;
      if (preparations > 1) await preparationGate;
    },
    probeLiveIosRunnerListener: async () => {
      await probeGate;
      return null;
    },
  });
  resetIosRunnerState();
  try {
    await ensureIosRunnerPrepared({} as Device, "cache-race-ipad");
    const first = ensureIosRunnerPrepared({} as Device, "cache-race-ipad");
    const second = ensureIosRunnerPrepared({} as Device, "cache-race-ipad");
    probing();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(preparations, 2, "both revalidations join one replacement");
    finish();
    await Promise.all([first, second]);
  } finally {
    probing();
    finish();
    restore();
    resetIosRunnerState();
  }
});
