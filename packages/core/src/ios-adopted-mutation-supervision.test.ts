import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { clearControl, requestCancel, runWithJobControl } from "./control.js";
import { setLocalDeviceProvider } from "./device-factory.js";
import { pressResolvedControl } from "./device-resolved-control.js";
import { resolveNamedControl } from "./device-target-resolution.js";
import {
  IosMutationOutcomeUnknownError,
  IosMutationRejectedError,
  IosSupervisionRequiredError,
  iosSelectorWasNotDispatched,
  runIosMutationOnce,
} from "./ios-mutation-policy.js";
import {
  labelNodesViaLiveIosRunnerListener,
  setLiveIosRunnerCommandPostForTests,
  snapshotViaLiveIosRunnerListener,
  tapViaLiveIosRunnerListener,
  typeViaLiveIosRunnerListener,
  type LiveIosRunnerCommand,
  type LiveIosRunnerCommandPost,
} from "./ios-runner-listener-command.js";
import { ensureSavedTestIosRunner } from "./session-ios-runner-readiness.js";
import { acquirePreparedSessionDevice } from "./session-provider-execution.js";
import type { TestJob } from "./session-contract.js";
import { runWithTargetContext } from "./target-context.js";
import { reserveTargetControl, TargetControlReservedError } from "./target-control.js";
import { runWithTargetSupervisorStore, TargetSupervisorStore } from "./target-supervisor-store.js";
import { deviceTestDouble } from "./testing.js";
import { catalogAwarePost } from "./ios-snapshot-catalog.fixtures.js";

const appBundleId = "com.example.adopted";
const rankedNodes = [
  {
    type: "StaticText",
    identifier: "close",
    hittable: true,
    rect: { x: 20, y: 40, width: 40, height: 40 },
  },
  {
    type: "Button",
    identifier: "close",
    enabled: true,
    hittable: true,
    rect: { x: 20, y: 40, width: 40, height: 40 },
  },
];

async function fixture(
  run: (input: {
    serial: string;
    store: TargetSupervisorStore;
    installPost(post: LiveIosRunnerCommandPost): void;
    mutate(kind: "tap" | "type"): Promise<void>;
    reopenedStartupIsBlocked(): Promise<void>;
  }) => Promise<void>,
  options: ConstructorParameters<typeof TargetSupervisorStore>[1] = {},
  supervised = true,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "relay-adopted-supervision-"));
  const serial = directory.split("/").at(-1)!;
  const context = { kind: "device", platform: "ios", serial } as const;
  const previous = process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
  process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = directory;
  await writeFile(
    join(directory, `${serial}.json`),
    JSON.stringify({ runnerPid: process.pid, ownerPid: process.pid, port: 50937 }),
  );
  const path = join(directory, "supervisors.sqlite");
  const store = new TargetSupervisorStore(path, options);
  let restorePost = () => {};
  try {
    const execute = () =>
      runWithTargetContext(context, () =>
        run({
          serial,
          store,
          installPost(post) {
            restorePost();
            restorePost = setLiveIosRunnerCommandPostForTests(catalogAwarePost(post));
          },
          mutate: (kind) =>
            runIosMutationOnce(serial, kind === "tap" ? "press" : "type", () =>
              kind === "tap"
                ? tapViaLiveIosRunnerListener({
                    serial,
                    selectorKey: "label",
                    selectorValue: "Fast",
                    appBundleId,
                  })
                : typeViaLiveIosRunnerListener({ serial, text: "public prompt", appBundleId }),
            ),
          async reopenedStartupIsBlocked() {
            store.close();
            const reopened = new TargetSupervisorStore(path);
            let probes = 0;
            let preparations = 0;
            let sdkCallbacks = 0;
            const sdkOpen = async () => {
              sdkCallbacks += 1;
            };
            const device = deviceTestDouble({
              apps: {
                open: sdkOpen,
              },
              interactions: {
                press: async () => {
                  sdkCallbacks += 1;
                },
                type: async () => {
                  sdkCallbacks += 1;
                },
              },
            });
            setLocalDeviceProvider({ kind: "device", create: () => device });
            try {
              assert.equal(reopened.health({ id: serial, kind: "ios" }).input.state, "uncertain");
              await assert.rejects(
                runWithTargetSupervisorStore(reopened, () =>
                  ensureSavedTestIosRunner(device, context, () => {}, {
                    checkpoint: async () => {},
                    probe: async () => {
                      probes += 1;
                      return null;
                    },
                    prepare: async () => {
                      preparations += 1;
                      await sdkOpen();
                    },
                  }),
                ),
                /blocked pending observation and review/u,
              );
              await assert.rejects(
                runWithTargetSupervisorStore(reopened, () =>
                  acquirePreparedSessionDevice(
                    { id: serial, targetContext: context, platform: "ios", serial } as TestJob,
                    { browserTarget: null },
                    () => {},
                    { requirePhysicalIosSemantics: true },
                  ),
                ),
                /blocked pending observation and review/u,
              );
              assert.deepEqual(
                { probes, preparations, sdkCallbacks },
                {
                  probes: 0,
                  preparations: 0,
                  sdkCallbacks: 0,
                },
              );
            } finally {
              setLocalDeviceProvider(undefined);
              reopened.close();
            }
          },
        }),
      );
    await (supervised ? runWithTargetSupervisorStore(store, execute) : execute());
  } finally {
    restorePost();
    store.close();
    if (previous === undefined) delete process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
    else process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
}

function inputEvents(store: TargetSupervisorStore, serial: string): string[] {
  return store
    .health({ id: serial, kind: "ios" })
    .events.filter((event) => event.code.startsWith("INPUT_"))
    .map((event) => event.code)
    .reverse();
}

for (const kind of ["tap", "type"] as const) {
  test(`adopted ${kind} ACK loss survives store restart and blocks saved startup`, async () => {
    await fixture(async ({ serial, store, installPost, mutate, reopenedStartupIsBlocked }) => {
      let posts = 0;
      installPost(async (_listener, command) => {
        posts += 1;
        assert.equal(command.command, kind);
        assert.deepEqual(inputEvents(store, serial), [
          "INPUT_INTENT_PERSISTED",
          "INPUT_DISPATCHED",
        ]);
        throw new Error("element not found while reading the native acknowledgement");
      });
      await assert.rejects(mutate(kind), (error) => {
        assert.ok(error instanceof IosMutationOutcomeUnknownError);
        assert.match(error.supervisedMutation?.mutationId ?? "", /^ios-input-/u);
        return true;
      });
      assert.equal(posts, 1);
      assert.deepEqual(inputEvents(store, serial), [
        "INPUT_INTENT_PERSISTED",
        "INPUT_DISPATCHED",
        "INPUT_OUTCOME_UNKNOWN",
      ]);
      await reopenedStartupIsBlocked();
    });
  });

  test(`healthy adopted ${kind} persists intent before post and completes once`, async () => {
    await fixture(async ({ serial, store, installPost, mutate }) => {
      let posts = 0;
      installPost(async () => {
        posts += 1;
        assert.deepEqual(inputEvents(store, serial), [
          "INPUT_INTENT_PERSISTED",
          "INPUT_DISPATCHED",
        ]);
        return { ok: true };
      });
      await mutate(kind);
      assert.equal(posts, 1);
      assert.deepEqual(inputEvents(store, serial), [
        "INPUT_INTENT_PERSISTED",
        "INPUT_DISPATCHED",
        "INPUT_COMPLETED",
      ]);
      assert.equal(store.health({ id: serial, kind: "ios" }).input.state, "ready");
    });
  });

  test(`adopted ${kind} malformed success reply keeps the input outcome unknown`, async () => {
    await fixture(async ({ serial, store, installPost, mutate }) => {
      let posts = 0;
      installPost(async () => {
        posts += 1;
        return {};
      });
      await assert.rejects(mutate(kind), IosMutationOutcomeUnknownError);
      assert.equal(posts, 1);
      assert.equal(inputEvents(store, serial).at(-1), "INPUT_OUTCOME_UNKNOWN");
    });
  });

  test(`required adopted ${kind} refuses before post without a durable store`, async () => {
    await fixture(
      async ({ serial, installPost }) => {
        let posts = 0;
        installPost(async () => {
          posts += 1;
          return { ok: true };
        });
        await assert.rejects(
          runIosMutationOnce(serial, kind === "tap" ? "press" : "type", () =>
            kind === "tap"
              ? tapViaLiveIosRunnerListener({ serial, point: { x: 20, y: 30 } })
              : typeViaLiveIosRunnerListener({ serial, text: "public prompt" }),
          ),
          IosSupervisionRequiredError,
        );
        assert.equal(posts, 0);
      },
      {},
      false,
    );
  });

  test(`required direct adopted ${kind} with a store needs a matching active intention`, async () => {
    await fixture(async ({ serial, store, installPost }) => {
      let posts = 0;
      installPost(async () => {
        posts += 1;
        return { ok: true };
      });
      const direct = () =>
        kind === "tap"
          ? tapViaLiveIosRunnerListener({ serial, point: { x: 20, y: 30 } })
          : typeViaLiveIosRunnerListener({ serial, text: "public prompt" });
      await assert.rejects(direct(), IosSupervisionRequiredError);
      await assert.rejects(
        runIosMutationOnce(`${serial}-other`, kind === "tap" ? "press" : "type", direct),
        IosSupervisionRequiredError,
      );
      assert.equal(posts, 0);
      assert.deepEqual(inputEvents(store, serial), []);
    });
  });
}

test("adopted read-only snapshots and queries never enter the input ledger", async () => {
  await fixture(async ({ serial, store, installPost }) => {
    installPost(async (_listener, command) => {
      assert.ok(command.command === "snapshot" || command.command === "querySelector");
      assert.deepEqual(inputEvents(store, serial), []);
      return {
        ok: true,
        data: {
          nodes:
            command.command === "snapshot"
              ? [
                  {
                    type: "Application",
                    depth: 0,
                    bundleId: appBundleId,
                    rect: { x: 0, y: 0, width: 1112, height: 834 },
                  },
                ]
              : [],
          found: false,
        },
      };
    });
    await labelNodesViaLiveIosRunnerListener({ serial, label: "Copy", appBundleId });
    await snapshotViaLiveIosRunnerListener({ serial, appBundleId });
    assert.deepEqual(inputEvents(store, serial), []);
  });
});

test("structured identifier ambiguity closes refused receipt before one ranked point dispatch", async () => {
  await fixture(async ({ serial, store, installPost }) => {
    const commands: LiveIosRunnerCommand[] = [];
    installPost(async (_listener, command) => {
      commands.push(command);
      if (command.command === "snapshot") {
        assert.equal(inputEvents(store, serial).at(-1), "INPUT_NOT_DISPATCHED");
        return { ok: true, data: { nodes: rankedNodes } };
      }
      if (command.selectorKey === "id") {
        return {
          ok: false,
          error: { code: "AMBIGUOUS_MATCH", message: "selector matched multiple elements" },
        };
      }
      assert.deepEqual([command.x, command.y], [40, 60]);
      assert.deepEqual(inputEvents(store, serial).slice(-2), [
        "INPUT_INTENT_PERSISTED",
        "INPUT_DISPATCHED",
      ]);
      return { ok: true };
    });
    await runIosMutationOnce(serial, "press", () =>
      tapViaLiveIosRunnerListener({
        serial,
        selectorKey: "id",
        selectorValue: "close",
        appBundleId,
      }),
    );
    assert.deepEqual(
      commands.map((command) => command.command),
      ["tap", "snapshot", "tap"],
    );
    assert.deepEqual(inputEvents(store, serial), [
      "INPUT_INTENT_PERSISTED",
      "INPUT_DISPATCHED",
      "INPUT_NOT_DISPATCHED",
      "INPUT_INTENT_PERSISTED",
      "INPUT_DISPATCHED",
      "INPUT_COMPLETED",
    ]);
  });
});

test("message-only identifier ambiguity cannot authorize a second native post", async () => {
  await fixture(async ({ serial, store, installPost }) => {
    let posts = 0;
    installPost(async () => {
      posts += 1;
      return { ok: false, error: "AMBIGUOUS_MATCH: selector matched multiple elements" };
    });
    await assert.rejects(
      runIosMutationOnce(serial, "press", () =>
        tapViaLiveIosRunnerListener({ serial, selectorKey: "id", selectorValue: "close" }),
      ),
      (error) => {
        assert.ok(error instanceof IosMutationOutcomeUnknownError);
        assert.equal(iosSelectorWasNotDispatched(error), false);
        return true;
      },
    );
    assert.equal(posts, 1);
    assert.equal(inputEvents(store, serial).at(-1), "INPUT_OUTCOME_UNKNOWN");
  });
});

test("generic Type failure cannot become a selector miss from unchanged field text", async () => {
  await fixture(async ({ serial, store, installPost }) => {
    const commands: string[] = [];
    installPost(async (_listener, command) => {
      commands.push(String(command.command));
      return command.command === "querySelector"
        ? { ok: true, data: { nodes: [{ identifier: "composer", value: "" }] } }
        : {
            ok: false,
            error: { code: "MAIN_THREAD_TIMEOUT", message: "element not found after typing" },
          };
    });
    await assert.rejects(
      runIosMutationOnce(serial, "type", () =>
        typeViaLiveIosRunnerListener({
          serial,
          text: "public prompt",
          selectorKey: "id",
          selectorValue: "composer",
        }),
      ),
      (error) => {
        assert.ok(error instanceof IosMutationOutcomeUnknownError);
        assert.equal(iosSelectorWasNotDispatched(error), false);
        return true;
      },
    );
    assert.deepEqual(commands, ["type"]);
    assert.equal(inputEvents(store, serial).at(-1), "INPUT_OUTCOME_UNKNOWN");
  });
});

test("an unknown adopted selector reply cannot reenter resolved-control point fallback", async () => {
  await fixture(async ({ serial, store, installPost }) => {
    const commands: string[] = [];
    let sdkCallbacks = 0;
    installPost(async (_listener, command) => {
      commands.push(String(command.command));
      return { ok: false, error: { code: "MAIN_THREAD_TIMEOUT", message: "element not found" } };
    });
    const device = deviceTestDouble({
      capture: {
        snapshot: async () => {
          sdkCallbacks += 1;
          return [];
        },
      },
      interactions: {
        press: async () => {
          sdkCallbacks += 1;
        },
      },
    });
    const target = { label: "Fast" };
    const resolution = resolveNamedControl(
      [
        {
          type: "Button",
          label: "Fast",
          hittable: true,
          rect: { x: 20, y: 40, width: 40, height: 40 },
        },
      ],
      target,
    );
    assert.ok(resolution);
    await assert.rejects(
      pressResolvedControl(device, resolution, target, undefined, {
        refreshBeforePointFallbackForApp: appBundleId,
      }),
      IosMutationOutcomeUnknownError,
    );
    assert.deepEqual(commands, ["tap"]);
    assert.equal(sdkCallbacks, 0);
    assert.equal(inputEvents(store, serial).at(-1), "INPUT_OUTCOME_UNKNOWN");
  });
});

test("late ambiguity after cancellation cannot clear unknown receipt or send fallback", async () => {
  await fixture(async ({ serial, store, installPost }) => {
    const jobId = `cancel-${serial}`;
    let resolvePost!: (result: Awaited<ReturnType<LiveIosRunnerCommandPost>>) => void;
    let posted!: () => void;
    const started = new Promise<void>((resolve) => {
      posted = resolve;
    });
    let posts = 0;
    installPost(async () => {
      posts += 1;
      posted();
      return new Promise((resolve) => {
        resolvePost = resolve;
      });
    });
    try {
      const action = runWithJobControl(jobId, () =>
        runIosMutationOnce(serial, "press", () =>
          tapViaLiveIosRunnerListener({ serial, selectorKey: "id", selectorValue: "close" }),
        ),
      );
      await started;
      requestCancel(jobId);
      await assert.rejects(action, IosMutationOutcomeUnknownError);
      clearControl(jobId);
      resolvePost({
        ok: false,
        error: { code: "AMBIGUOUS_MATCH", message: "selector matched multiple elements" },
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(posts, 1);
      assert.equal(inputEvents(store, serial).at(-1), "INPUT_OUTCOME_UNKNOWN");
    } finally {
      clearControl(jobId);
    }
  });
});

test("target reservation rejects adopted input before ledger or native callback", async () => {
  await fixture(async ({ serial, store, installPost, mutate }) => {
    let posts = 0;
    installPost(async () => {
      posts += 1;
      return { ok: true };
    });
    const release = reserveTargetControl(serial, "another-job");
    try {
      await assert.rejects(mutate("tap"), TargetControlReservedError);
      assert.equal(posts, 0);
      assert.deepEqual(inputEvents(store, serial), []);
    } finally {
      release();
    }
  });
});

test("a lost completed receipt fences a healthy adopted input after store restart", async () => {
  await fixture(
    async ({ serial, installPost, mutate, reopenedStartupIsBlocked }) => {
      let posts = 0;
      installPost(async () => {
        posts += 1;
        return { ok: true };
      });
      await assert.rejects(mutate("type"), IosMutationOutcomeUnknownError);
      assert.equal(posts, 1);
      await reopenedStartupIsBlocked();
    },
    {
      beforePersistTransition(event) {
        if (event.kind === "input.completed") throw new Error("completion persistence unavailable");
      },
    },
  );
});

test("failed identifier refusal persistence cannot authorize ranking or a second input", async () => {
  await fixture(
    async ({ serial, store, installPost, reopenedStartupIsBlocked }) => {
      let posts = 0;
      installPost(async () => {
        posts += 1;
        return {
          ok: false,
          error: { code: "AMBIGUOUS_MATCH", message: "selector matched multiple elements" },
        };
      });
      await assert.rejects(
        runIosMutationOnce(serial, "press", () =>
          tapViaLiveIosRunnerListener({ serial, selectorKey: "id", selectorValue: "close" }),
        ),
        IosMutationOutcomeUnknownError,
      );
      assert.equal(posts, 1);
      assert.equal(store.health({ id: serial, kind: "ios" }).input.state, "uncertain");
      assert.ok(!inputEvents(store, serial).includes("INPUT_NOT_DISPATCHED"));
      assert.ok(store.health({ id: serial, kind: "ios" }).input.pendingMutationId);
      await reopenedStartupIsBlocked();
    },
    {
      beforePersistTransition(event) {
        if (event.kind === "input.not-dispatched")
          throw new Error("refusal persistence unavailable");
      },
    },
  );
});

test("native label ambiguity remains terminal without point fallback or unknown dispatch receipt", async () => {
  await fixture(async ({ serial, store, installPost }) => {
    let posts = 0;
    let sdkCallbacks = 0;
    installPost(async (_listener, command) => {
      posts += 1;
      assert.equal(command.command, "tap");
      assert.equal(command.selectorKey, "label");
      return {
        ok: false,
        error: { code: "AMBIGUOUS_MATCH", message: "selector matched multiple elements" },
      };
    });
    const device = deviceTestDouble({
      interactions: {
        press: async () => {
          sdkCallbacks += 1;
        },
      },
    });
    const target = { label: "Fast" };
    const resolution = resolveNamedControl(
      [
        {
          type: "Button",
          label: "Fast",
          hittable: true,
          rect: { x: 20, y: 40, width: 40, height: 40 },
        },
      ],
      target,
    );
    assert.ok(resolution);
    await assert.rejects(pressResolvedControl(device, resolution, target), (error) => {
      assert.ok(error instanceof IosMutationRejectedError);
      assert.equal(error.cause.code, "AMBIGUOUS_MATCH");
      assert.equal(error.iosMutation.outcome, "selector-rejected");
      assert.ok(!(error instanceof IosMutationOutcomeUnknownError));
      assert.equal(iosSelectorWasNotDispatched(error), false);
      return true;
    });
    assert.equal(posts, 1);
    assert.equal(sdkCallbacks, 0);
    assert.equal(inputEvents(store, serial).at(-1), "INPUT_NOT_DISPATCHED");
    assert.equal(store.health({ id: serial, kind: "ios" }).input.state, "ready");
  });
});

test("failed terminal label refusal persistence preserves the unknown fence", async () => {
  await fixture(
    async ({ installPost, mutate, reopenedStartupIsBlocked }) => {
      let posts = 0;
      installPost(async () => {
        posts += 1;
        return {
          ok: false,
          error: { code: "AMBIGUOUS_MATCH", message: "selector matched multiple elements" },
        };
      });
      await assert.rejects(mutate("tap"), IosMutationOutcomeUnknownError);
      assert.equal(posts, 1);
      await reopenedStartupIsBlocked();
    },
    {
      beforePersistTransition(event) {
        if (event.kind === "input.not-dispatched") throw new Error("refusal storage unavailable");
      },
    },
  );
});

test("explicit native selector miss releases its receipt without sending another Type", async () => {
  await fixture(async ({ serial, store, installPost, mutate }) => {
    let posts = 0;
    installPost(async () => {
      posts += 1;
      return { ok: false, error: { code: "ELEMENT_NOT_FOUND", message: "element not found" } };
    });
    await assert.rejects(mutate("type"), (error) => iosSelectorWasNotDispatched(error));
    assert.equal(posts, 1);
    assert.equal(inputEvents(store, serial).at(-1), "INPUT_NOT_DISPATCHED");
    assert.equal(store.health({ id: serial, kind: "ios" }).input.state, "ready");
  });
});

test("cancellation after ranking snapshot cannot send the point fallback", async () => {
  await fixture(async ({ serial, store, installPost }) => {
    const jobId = `cancel-snapshot-${serial}`;
    const commands: string[] = [];
    installPost(async (_listener, command) => {
      commands.push(String(command.command));
      if (command.command === "snapshot") {
        requestCancel(jobId);
        return { ok: true, data: { nodes: rankedNodes } };
      }
      return {
        ok: false,
        error: { code: "AMBIGUOUS_MATCH", message: "selector matched multiple elements" },
      };
    });
    try {
      await assert.rejects(
        runWithJobControl(jobId, () =>
          runIosMutationOnce(serial, "press", () =>
            tapViaLiveIosRunnerListener({ serial, selectorKey: "id", selectorValue: "close" }),
          ),
        ),
        IosMutationOutcomeUnknownError,
      );
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.deepEqual(commands, ["tap", "snapshot"]);
      assert.equal(inputEvents(store, serial).at(-1), "INPUT_NOT_DISPATCHED");
    } finally {
      clearControl(jobId);
    }
  });
});
