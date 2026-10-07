import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { type Device, type SnapshotNode, rememberTargetApplication } from "./device.js";
import { runRecipeStep } from "./recipe-runner.js";
import type { RecipeStepContext } from "./recipe-runner-context.js";
import { runRecipeSteps } from "./session-recipe-execution.js";
import type { TestJob } from "./session-contract.js";
import { runWithTargetContext } from "./target-context.js";
import { JobCancelledError } from "./control.js";
import {
  observeRecipeResponse,
  requireCurrentActionResponseBoundary,
} from "./recipe-response-observation.js";
import {
  deviceTestDouble,
  runWithIosSupervisionMode,
  setLiveIosRunnerCommandPostForTests,
  type LiveIosRunnerCommand,
} from "./testing.js";
import type { LiveIosRunnerCommandResult } from "./ios-runner-listener-command.js";

const appBundleId = "com.example.response-product";
const root: SnapshotNode = {
  type: "Application",
  depth: 0,
  bundleId: appBundleId,
  rect: { x: 0, y: 0, width: 1112, height: 834 },
};
const chrome: SnapshotNode = {
  type: "TextView",
  identifier: "ask.toolbar.textfield",
  label: "New Message",
  editable: true,
};
const copy: SnapshotNode = { type: "Button", label: "Copy", visibleToUser: true };
// Synthetic response slots exercise the generic recipe contract. These are
// not assertions that a production iOS app exposes this identifier.
const turn = (ref: string): SnapshotNode => ({
  type: "StaticText",
  identifier: "assistant-message",
  value: "A useful answer",
  ref,
  visibleToUser: true,
});
const prompt = { kind: "type" as const, id: "new-prompt", text: "Explain a paper airplane fold" };
const extract = {
  kind: "extract" as const,
  as: "reply",
  role: "assistant" as const,
  target: { identifier: "assistant-message" },
};
const readiness = {
  kind: "wait-response" as const,
  target: { label: "Copy" },
  idleTarget: { label: "Copy" },
  timeoutMs: 1_000,
  stableForMs: 0,
};

async function withNativeResponse(
  read: (
    index: number,
  ) => LiveIosRunnerCommandResult | Error | Promise<LiveIosRunnerCommandResult | Error>,
  run: (fixture: {
    device: Device;
    ctx: RecipeStepContext;
    commands: LiveIosRunnerCommand[];
    treeReads(): number;
    changeOwner(): Promise<void>;
  }) => Promise<void>,
  requireBaselineBeforeType = false,
) {
  const directory = await mkdtemp(join(tmpdir(), "relay-response-native-"));
  const serial = directory.split("/").at(-1)!;
  const context = { kind: "device", platform: "ios", serial } as const;
  const saved = {
    lease: process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR,
    workspace: process.env.RELAY_WORKSPACE_ROOT,
    visual: process.env.RELAY_AUTO_VISUAL_EVIDENCE,
  };
  process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = directory;
  process.env.RELAY_WORKSPACE_ROOT = directory;
  process.env.RELAY_AUTO_VISUAL_EVIDENCE = "0";
  await writeFile(
    join(directory, `${serial}.json`),
    JSON.stringify({
      runnerPid: process.pid,
      ownerPid: process.pid,
      port: 50937,
    }),
  );
  const commands: LiveIosRunnerCommand[] = [];
  let treeReads = 0;
  const restore = setLiveIosRunnerCommandPostForTests(async (_listener, command) => {
    commands.push(command);
    if (command.command === "type") {
      if (requireBaselineBeforeType) {
        const preceding = commands.at(-2);
        assert.equal(preceding?.command, "snapshot");
        assert.equal(preceding?.depth, undefined, "input requires complete response baseline");
        assert.equal(preceding?.interactiveOnly, false);
      }
      return { ok: true };
    }
    if (command.command === "querySelector") {
      return {
        ok: true,
        data: { nodes: command.selectorValue === chrome.identifier ? [chrome] : [] },
      };
    }
    assert.equal(command.command, "snapshot", "fixture never dispatches any other input");
    if (command.depth === 0) return { ok: true, data: { nodes: [root] } };
    const result = await read(treeReads++);
    if (result instanceof Error) throw result;
    return result;
  });
  const device = deviceTestDouble({
    capture: { snapshot: async () => assert.fail("native response must not use SDK snapshots") },
    command: {
      wait: async ({ durationMs }: { durationMs: number }) => {
        await new Promise((resolve) => setTimeout(resolve, Math.min(durationMs, 1)));
      },
    },
  });
  const ctx: RecipeStepContext = { log() {}, variables: {}, artifacts: [], runtime: {} };
  try {
    await rememberTargetApplication(appBundleId, context);
    await runWithIosSupervisionMode("test-optional", () =>
      runWithTargetContext(context, () =>
        run({
          device,
          ctx,
          commands,
          treeReads: () => treeReads,
          changeOwner: () => rememberTargetApplication("com.example.other", context),
        }),
      ),
    );
  } finally {
    restore();
    for (const [name, value] of [
      ["AGENT_DEVICE_IOS_RUNNER_LEASE_DIR", saved.lease],
      ["RELAY_WORKSPACE_ROOT", saved.workspace],
      ["RELAY_AUTO_VISUAL_EVIDENCE", saved.visual],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
}

const complete = (nodes: SnapshotNode[]): LiveIosRunnerCommandResult => ({
  ok: true,
  data: { truncated: false, nodes: [root, chrome, ...nodes] },
});

test("Type observes the complete native baseline before dispatch and reminted old reply is not current", async () => {
  await withNativeResponse(
    (index) => complete([turn(index ? "@reminted" : "@old"), copy]),
    async ({ device, ctx, commands, treeReads }) => {
      await runRecipeStep(device, prompt, ctx);
      assert.equal(ctx.runtime?.responseBoundary?.turnIds.length, 1);
      assert.equal(treeReads(), 1);
      assert.deepEqual(
        commands.map(({ command }) => command),
        ["snapshot", "type"],
      );
      assert.equal(commands[0]?.depth, undefined);
      assert.equal(commands[0]?.interactiveOnly, false);
      assert.equal(commands[0]?.appBundleId, appBundleId);
      await assert.rejects(runRecipeStep(device, extract, ctx), /no verified new answer/);
      assert.equal(ctx.variables?.reply, undefined);
      assert.equal(treeReads(), 2);
    },
  );
});

test("frozen saved Test keeps the native boundary from nested Type through new readiness and extraction", async () => {
  await withNativeResponse(
    (index) => complete(index ? [turn("@old"), turn("@new"), copy] : [turn("@old")]),
    async ({ device, commands }) => {
      const job = {
        id: "native-response-frozen",
        action: "test",
        platform: "ios",
        queuedAt: Date.now(),
        steps: [],
        artifacts: [],
        frames: [],
        resolvedInputs: {},
        recipeId: "saved-test",
        recipeSnapshot: {
          id: "saved-test",
          title: "Saved Test",
          steps: [{ kind: "module", recipeId: "recorded-type" }, readiness, extract],
        },
        recipeGraph: {
          "recorded-type": { id: "recorded-type", title: "Recorded Type", steps: [prompt] },
        },
      } as unknown as TestJob;
      await runRecipeSteps(
        job,
        device,
        () => {},
        () => {},
      );
      assert.equal(job.resolvedInputs.reply, "A useful answer");
      const receipt = job.artifacts.find((artifact) => artifact.kind === "response-completion");
      assert.equal(
        (receipt?.data as { initiatingActionId?: string }).initiatingActionId,
        prompt.id,
      );
      const response = job.artifacts.find((artifact) => artifact.kind === "conversation-turn");
      assert.match(String((response?.data as { responseId?: string }).responseId), /#1$/);
      assert.equal(commands.filter(({ command }) => command === "type").length, 1);
      assert.ok(
        commands.every(
          ({ command, depth }) =>
            command === "type" || (command === "snapshot" && depth === undefined),
        ),
      );
    },
    true,
  );
});

const unavailableBaselines: Array<[string, LiveIosRunnerCommandResult | Error]> = [
  ["incomplete", { ok: true, data: { truncated: true, nodes: [root, turn("@old")] } }],
  ["legacy unproven", { ok: true, data: { nodes: [root, turn("@old")] } }],
  ["foreign", complete([{ ...turn("@old"), bundleId: "com.example.other" }])],
  [
    "system surface",
    {
      ok: true,
      data: {
        truncated: false,
        nodes: [root],
        systemSurface: { bundleId: "com.apple.SafariViewService" },
      },
    },
  ],
  [
    "unknown system surface",
    { ok: true, data: { truncated: false, nodes: [root], systemSurface: {} } },
  ],
  ["empty", { ok: true, data: { truncated: false, nodes: [] } }],
  ["failed", { ok: false, error: { code: "COMMAND_FAILED", message: "tree unavailable" } }],
  ["unavailable", new Error("current native tree unavailable")],
];
for (const [name, result] of unavailableBaselines) {
  test(`${name} second native baseline cannot inherit the first prompt or prove a current reply`, async () => {
    await withNativeResponse(
      (index) =>
        index === 0 ? complete([]) : index === 1 ? result : complete([turn("@new"), copy]),
      async ({ device, ctx, commands, treeReads }) => {
        await runRecipeStep(device, { ...prompt, id: "first-prompt" }, ctx);
        await runRecipeStep(device, { ...prompt, id: "second-prompt" }, ctx);
        assert.equal(ctx.runtime?.responseBoundary, undefined);
        const readsBeforeChecks = treeReads();
        await assert.rejects(
          runRecipeStep(device, extract, ctx),
          /initiating.*boundary|baseline.*unavailable/,
        );
        await assert.rejects(
          runRecipeStep(device, readiness, ctx),
          /initiating.*boundary|baseline.*unavailable/,
        );
        assert.equal(
          treeReads(),
          readsBeforeChecks,
          "failed baseline cannot be repaired after input",
        );
        assert.equal(ctx.variables?.reply, undefined);
        assert.equal(commands.filter(({ command }) => command === "type").length, 2);
      },
    );
  });
}

test("native assistant extraction without an initiating baseline fails before any observation", async () => {
  await withNativeResponse(
    () => complete([turn("@old"), copy]),
    async ({ device, ctx, commands }) => {
      await assert.rejects(runRecipeStep(device, extract, ctx), /initiating.*boundary/);
      assert.deepEqual(commands, []);
    },
  );
});

test("a native response boundary cannot cross a remembered application change", async () => {
  await withNativeResponse(
    () => complete([]),
    async ({ device, ctx, changeOwner, commands }) => {
      await runRecipeStep(device, prompt, ctx);
      await changeOwner();
      const before = commands.length;
      await assert.rejects(
        runRecipeStep(device, extract, ctx),
        /application.*changed|boundary.*application/,
      );
      assert.equal(commands.length, before);
    },
  );
});

test("native Copy readiness is never extracted as assistant answer content", async () => {
  await withNativeResponse(
    (index) => complete(index ? [copy] : []),
    async ({ device, ctx }) => {
      await runRecipeStep(device, prompt, ctx);
      await assert.rejects(
        runRecipeStep(device, { ...extract, target: { label: "Copy" } }, ctx),
        /readiness.*response content/,
      );
      assert.equal(ctx.variables?.reply, undefined);
    },
  );
});

test("a mixed native match cannot extract a newly visible readiness control beside old content", async () => {
  const content: SnapshotNode = {
    type: "StaticText",
    label: "shared target",
    value: "Existing native reply",
    ref: "@old",
    visibleToUser: true,
  };
  const readinessControl = { ...copy, label: "shared target", ref: "@new-button" };
  await withNativeResponse(
    (index) => complete(index ? [content, readinessControl] : [content]),
    async ({ device, ctx }) => {
      await runRecipeStep(device, prompt, ctx);
      await assert.rejects(
        runRecipeStep(device, { ...extract, target: { label: "shared target" } }, ctx),
        /no verified new answer/,
      );
      assert.equal(ctx.variables?.reply, undefined);
    },
  );
});

test("hidden native content cannot qualify a new matching readiness control as an assistant reply", async () => {
  const hidden: SnapshotNode = {
    type: "StaticText",
    label: "shared target",
    value: "Hidden native reply",
    ref: "@hidden",
    visibleToUser: false,
  };
  await withNativeResponse(
    (index) => complete(index ? [hidden, { ...copy, label: "shared target" }] : []),
    async ({ device, ctx }) => {
      await runRecipeStep(device, prompt, ctx);
      await assert.rejects(
        runRecipeStep(device, { ...extract, target: { label: "shared target" } }, ctx),
        /readiness.*response content/,
      );
      assert.equal(ctx.variables?.reply, undefined);
    },
  );
});

test("an old response beyond the retained 256-node cap is still included in the complete initiating census", async () => {
  const filler: SnapshotNode[] = Array.from({ length: 260 }, (_, index) => ({
    type: "StaticText",
    label: `history ${index}`,
  }));
  await withNativeResponse(
    (index) => complete([...filler, turn(index ? "@reminted" : "@old"), copy]),
    async ({ device, ctx }) => {
      await runRecipeStep(device, prompt, ctx);
      assert.equal(ctx.runtime?.responseBoundary?.turnIds.length, 1);
      assert.ok((ctx.runtime?.responseBoundary?.priorTargetNodes?.length ?? 0) > 256);
      await assert.rejects(runRecipeStep(device, extract, ctx), /no verified new answer/);
    },
  );
});

test("ownership changing during the current response read refuses its otherwise complete tree", async () => {
  let changeOwner: () => Promise<void> = async () => {};
  await withNativeResponse(
    async (index) => {
      if (index) await changeOwner();
      return complete(index ? [turn("@new")] : []);
    },
    async ({ device, ctx, changeOwner: change, commands }) => {
      changeOwner = change;
      await runRecipeStep(device, prompt, ctx);
      await assert.rejects(runRecipeStep(device, extract, ctx), /application changed during/);
      assert.equal(ctx.variables?.reply, undefined);
      assert.equal(commands.filter(({ command }) => command === "type").length, 1);
    },
  );
});

test("a native initiating boundary cannot be used on another physical target", async () => {
  await withNativeResponse(
    () => complete([]),
    async ({ device, ctx, commands }) => {
      await runRecipeStep(device, prompt, ctx);
      const before = commands.length;
      await runWithTargetContext(
        { kind: "device", platform: "ios", serial: "other-response-target" },
        () =>
          assert.rejects(
            runRecipeStep(device, extract, ctx),
            /boundary application changed|another target/,
          ),
      );
      assert.equal(commands.length, before);
    },
  );
});

test("cancelled complete native baseline never dispatches Type", async () => {
  const cancellation = new JobCancelledError();
  await withNativeResponse(
    () => cancellation,
    async ({ device, ctx, commands }) => {
      await assert.rejects(runRecipeStep(device, prompt, ctx), (error) => error === cancellation);
      assert.equal(ctx.runtime?.responseBoundary, undefined);
      assert.deepEqual(
        commands.map(({ command }) => command),
        ["snapshot"],
      );
    },
  );
});

test("browser, Android, simulator, and cloud response observations preserve the existing SDK route", async () => {
  let reads = 0;
  let listenerPosts = 0;
  const restore = setLiveIosRunnerCommandPostForTests(async () => {
    listenerPosts += 1;
    throw new Error("no listener route");
  });
  const device = deviceTestDouble({
    capture: {
      snapshot: async () => {
        reads += 1;
        return { nodes: [turn("@sdk")] };
      },
    },
  });
  try {
    for (const context of [
      { kind: "browser", platform: "browser", targetId: "legacy-response" },
      { kind: "device", platform: "android", serial: "android-response" },
      { kind: "device", platform: "ios", serial: "12345678-1234-1234-1234-123456789ABC" },
      { kind: "cloud", platform: "ios", provider: "fixture", sessionId: "cloud-response" },
    ] as const) {
      await runWithTargetContext(context, async () => {
        const ctx: RecipeStepContext = { log() {}, runtime: {} };
        await requireCurrentActionResponseBoundary(ctx);
        assert.deepEqual(await observeRecipeResponse(device, ctx), { nodes: [turn("@sdk")] });
      });
    }
    assert.equal(reads, 4);
    assert.equal(listenerPosts, 0);
  } finally {
    restore();
  }
});

test("legacy boundary checks without an ambient target do not impose native-only requirements", async () => {
  await requireCurrentActionResponseBoundary({ log() {}, runtime: {} });
});
