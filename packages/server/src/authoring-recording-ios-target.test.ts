import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  persistCapturedAuthoringObservation,
  rememberTargetApplication,
  runWithTargetContext,
  seedAuthoringRawRecording,
  type AuthoringRuntime,
  type CapturedAuthoringObservation,
  type Device,
  type SnapshotNode,
} from "@relay/core";
import type { AuthoringInteraction, AuthoringObservation, AuthoringSession } from "@relay/protocol";
import {
  recordAuthoringInteraction,
  runWithIosSupervisionMode,
  setLiveIosRunnerCommandPostForTests,
  type LiveIosRunnerCommand,
} from "@relay/core/testing";
import { captureAuthoringObservation, createAuthoringRuntime } from "./authoring-routes.js";

const appBundleId = "ai.x.GrokApp";
const application: SnapshotNode = {
  index: 0,
  depth: 0,
  type: "Application",
  identifier: appBundleId,
  logicalCoordinates: true,
  rect: { x: 0, y: 0, width: 1112, height: 834 },
};
const sidebar: SnapshotNode = {
  index: 1,
  type: "Button",
  identifier: "sidebar.open.button",
  label: "Open sidebar",
  enabled: true,
  hittable: true,
  logicalCoordinates: true,
  rect: { x: 16, y: 20, width: 44, height: 44 },
};

function recordingSession(serial: string): AuthoringSession {
  const target = { kind: "device", platform: "ios", targetId: serial } as const;
  const before: AuthoringObservation = {
    id: "old-take-endpoint",
    capturedAt: 1,
    screen: { id: "old", fingerprint: "old", capturedAt: 1, source: "recording", deviceId: serial },
    evidenceIds: [],
  };
  return {
    schemaVersion: 1,
    id: "recording-regression",
    organizationId: "org",
    projectId: "project",
    actorId: "human",
    actorKind: "human",
    appMapId: "map",
    originApplication: appBundleId,
    state: "recording",
    target,
    leaseId: "lease",
    expectedAppMapRevision: 1,
    createdAt: 1,
    updatedAt: 1,
    take: {
      id: "take",
      state: "recording",
      createdAt: 1,
      updatedAt: 1,
      currentRevision: 1,
      revisions: [
        {
          id: "take:1",
          takeId: "take",
          revision: 1,
          createdAt: 1,
          createdBy: "human",
          reason: "recording",
          actions: [],
          evidence: [],
          observations: [before],
          before,
          after: before,
        },
      ],
      replayAttempts: [],
      ...seedAuthoringRawRecording({
        target,
        trigger: "recording",
        recordedAt: 1,
        observation: before,
      }),
    },
  };
}

async function recordingFixture(
  nodes: SnapshotNode[],
  run: (input: {
    record(): Promise<AuthoringSession>;
    commands: LiveIosRunnerCommand[];
    inputs(): number;
    capturedNodes(): SnapshotNode[];
  }) => Promise<void>,
  options: {
    queryNodes?: SnapshotNode[];
    control?: SnapshotNode;
    fallbackNodes?: SnapshotNode[];
    fallbackTruncated?: boolean | null;
    fallbackRememberedApplication?: string;
    fallbackSurfaceBundleId?: string;
    application?: SnapshotNode | null;
    rememberedApplication?: string;
    semanticFailure?: "miss" | "unknown";
    interaction?: AuthoringInteraction;
    originApplication?: string;
  } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "relay-recording-ios-target-"));
  const serial = `recording-${directory.split("/").at(-1)}`;
  const context = { kind: "device", platform: "ios", serial } as const;
  const previousLeaseDirectory = process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
  const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
  process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = directory;
  process.env.RELAY_WORKSPACE_ROOT = directory;
  await writeFile(
    join(directory, `${serial}.json`),
    JSON.stringify({ runnerPid: process.pid, ownerPid: process.pid, port: 50937 }),
  );
  const intentPath = join(directory, "intent.json");
  const commands: LiveIosRunnerCommand[] = [];
  let inputs = 0;
  let rejectedSelector = false;
  const control = options.control ?? sidebar;
  const matches = nodes.filter(
    (node) => node.identifier === control.identifier || node.label === control.label,
  );
  const restorePost = setLiveIosRunnerCommandPostForTests(async (_listener, command) => {
    commands.push(command);
    assert.equal(command.appBundleId, appBundleId);
    if (command.command === "querySelector") {
      if (![control.identifier, control.label].includes(String(command.selectorValue))) {
        if ([sidebar.identifier, sidebar.label].includes(String(command.selectorValue)))
          return {
            ok: true,
            data: { nodes: nodes.filter((node) => node.identifier === sidebar.identifier) },
          };
        return { ok: true, data: { nodes: [] } };
      }
      return matches.length === 1
        ? {
            ok: true,
            data: {
              nodes:
                options.queryNodes ??
                (rejectedSelector
                  ? [{ ...control, rect: { x: 200, y: 20, width: 44, height: 44 } }]
                  : matches),
            },
          }
        : {
            ok: false,
            error: { code: "AMBIGUOUS_MATCH", message: "selector matched multiple elements" },
          };
    }
    if (command.command === "snapshot") {
      return {
        ok: true,
        data: {
          nodes:
            command.depth === 0
              ? options.application === null
                ? []
                : [options.application ?? application]
              : rejectedSelector
                ? (options.fallbackNodes ??
                  nodes.map((node) =>
                    matches.includes(node)
                      ? { ...node, rect: { x: 200, y: 20, width: 44, height: 44 } }
                      : node,
                  ))
                : nodes,
          ...(options.fallbackTruncated === null
            ? {}
            : { truncated: options.fallbackTruncated ?? false }),
          ...(rejectedSelector && options.fallbackSurfaceBundleId
            ? { systemSurface: { bundleId: options.fallbackSurfaceBundleId } }
            : {}),
        },
      };
    }
    assert.equal(command.command, "tap");
    const durable = JSON.parse(await readFile(intentPath, "utf8")) as AuthoringSession;
    assert.equal(durable.take!.rawEvents!.at(-1)!.kind, "interaction-intent");
    if (command.selectorKey && options.semanticFailure) {
      rejectedSelector = true;
      if (options.fallbackRememberedApplication)
        await rememberTargetApplication(options.fallbackRememberedApplication, context);
      if (options.semanticFailure === "unknown")
        throw new Error("native acknowledgement timed out");
      return {
        ok: false,
        error: { code: "ELEMENT_NOT_FOUND", message: "did not match an element" },
      };
    }
    if (matches.length > 1 && command.selectorKey === "id") {
      return {
        ok: false,
        error: { code: "AMBIGUOUS_MATCH", message: "selector matched multiple elements" },
      };
    }
    inputs += 1;
    return { ok: true };
  });
  const realRuntime = createAuthoringRuntime();
  let clock = Date.now();
  let captures = 0;
  let capturedNodes: SnapshotNode[] = [];
  const runtime: AuthoringRuntime = {
    ...realRuntime,
    settle: async () => {},
    async observe(session) {
      const fingerprint = ++captures === 1 ? "entrance" : "exit";
      const captured = await captureAuthoringObservation(session, {
        async resolveDevice() {
          return {} as Device;
        },
        async captureSnapshot() {
          return {
            serial,
            capturedAt: ++clock,
            nodes,
            interactive: nodes,
            bounds: { width: 1112, height: 834 },
            inspectable: true,
            source: "sdk",
            foregroundApp: appBundleId,
            treeApp: appBundleId,
            bindingState: "matched",
            screenIdentity: { schemaVersion: 1, fingerprint, nodes: [], volatileSignals: [] },
          };
        },
        async captureScreenshot() {
          return {
            serial,
            capturedAt: ++clock,
            mime: "image/png",
            base64: Buffer.from(fingerprint).toString("base64"),
            path: join(directory, "unused.png"),
            bytes: fingerprint.length,
            width: 2224,
            height: 1668,
          };
        },
      });
      capturedNodes = captured.nodes ?? [];
      return captured;
    },
  };
  const record = () =>
    recordAuthoringInteraction<CapturedAuthoringObservation>(
      {
        ...recordingSession(serial),
        ...(options.originApplication ? { originApplication: options.originApplication } : {}),
      },
      options.interaction ?? { kind: "tap", target: { point: { x: 38, y: 42 } } },
      runtime,
      {
        now: () => ++clock,
        persistObservation: persistCapturedAuthoringObservation,
        persistEvidence: async () => {
          throw new Error("no video");
        },
        writeSession: (session) => writeFile(intentPath, JSON.stringify(session)),
        nextRevision(session, reason, mutate) {
          const previous = session.take!.revisions.at(-1)!;
          const revision = mutate(structuredClone(previous));
          revision.revision = previous.revision + 1;
          revision.reason = reason;
          revision.id = `take:${revision.revision}`;
          return {
            ...session,
            take: {
              ...session.take!,
              currentRevision: revision.revision,
              revisions: [...session.take!.revisions, revision],
            },
          };
        },
      },
    );
  try {
    await rememberTargetApplication(options.rememberedApplication ?? appBundleId, context);
    await runWithIosSupervisionMode("test-optional", () =>
      runWithTargetContext(context, () =>
        run({ record, commands, inputs: () => inputs, capturedNodes: () => capturedNodes }),
      ),
    );
  } finally {
    restorePost();
    if (previousLeaseDirectory === undefined) delete process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
    else process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = previousLeaseDirectory;
    if (previousWorkspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousWorkspace;
    await rm(directory, { recursive: true, force: true });
  }
}

test("a real recording keeps fresh selector dispatch without rereading entrance Application geometry", async () => {
  await recordingFixture([application, sidebar], async ({ record, commands, inputs }) => {
    const recorded = await record();
    const action = recorded.take!.revisions.at(-1)!.actions[0]!;
    const step = action.steps[0]!;
    assert.ok(step.kind === "tap");
    assert.deepEqual(step.target, { identifier: sidebar.identifier });
    assert.equal(inputs(), 1);
    assert.deepEqual(
      commands
        .filter((command) => command.command === "querySelector")
        .map((command) => command.selectorValue),
      [sidebar.identifier],
    );
    assert.equal(
      commands.filter((command) => command.command === "snapshot" && command.depth === 0).length,
      0,
    );
    assert.equal(commands.filter((command) => command.command === "tap").length, 1);
    for (const endpoint of [action.entranceObservationId, action.exitObservationId]) {
      const observation = recorded
        .take!.revisions.at(-1)!
        .observations!.find((item) => item.id === endpoint)!;
      assert.equal(observation.proof!.captureOrder, "pixels-ax-pixels");
      assert.equal(observation.proof!.pixels.bracket!.status, "coherent");
      assert.ok(observation.nodes!.some((node) => node.type === "Application"));
    }
  });
});

test("recording rejects a changed app owner before selector lookup or input", async () => {
  await recordingFixture(
    [application, sidebar],
    async ({ record, commands, inputs }) => {
      await assert.rejects(record(), /could not inspect/iu);
      assert.deepEqual(commands, []);
      assert.equal(inputs(), 0);
    },
    { rememberedApplication: "com.example.other" },
  );
});

test("a promoted iOS label keeps fresh native selector dispatch without an Application read", async () => {
  await recordingFixture(
    [application, { ...sidebar, identifier: undefined }],
    async ({ record, commands, inputs }) => {
      const recorded = await record();
      const step = recorded.take!.revisions.at(-1)!.actions[0]!.steps[0]!;
      assert.ok(step.kind === "tap");
      assert.deepEqual(step.target, { label: sidebar.label });
      assert.deepEqual(
        commands
          .filter((command) => command.command === "querySelector")
          .map((command) => command.selectorValue),
        [sidebar.label],
      );
      assert.equal(commands.filter((command) => command.command === "snapshot").length, 0);
      const taps = commands.filter((command) => command.command === "tap");
      assert.equal(taps.length, 1);
      assert.equal(taps[0]!.selectorKey, "label");
      assert.equal(inputs(), 1);
    },
  );
});

test("the existing direct-query coordinate annotation does not supply native tap coordinates", async () => {
  await recordingFixture(
    [application, sidebar],
    async ({ record, commands, inputs }) => {
      await record();
      assert.equal(commands.filter((command) => command.command === "snapshot").length, 0);
      const taps = commands.filter((command) => command.command === "tap");
      assert.equal(taps.length, 1);
      assert.equal(taps[0]!.selectorKey, "id");
      assert.equal(taps[0]!.x, undefined);
      assert.equal(taps[0]!.y, undefined);
      assert.equal(inputs(), 1);
    },
    { queryNodes: [{ ...sidebar, logicalCoordinates: undefined }] },
  );
});

test("recording rejects a returned control owned by another app", async () => {
  await recordingFixture(
    [application, sidebar],
    async ({ record, commands, inputs }) => {
      await assert.rejects(record(), /could not inspect/iu);
      assert.equal(commands.filter((command) => command.command === "querySelector").length, 1);
      assert.equal(commands.filter((command) => command.command === "tap").length, 0);
      assert.equal(inputs(), 0);
    },
    { queryNodes: [{ ...sidebar, bundleId: "com.example.other" }] },
  );
});

test("nonlogical control bounds retain current Application geometry", async () => {
  await recordingFixture(
    [application, sidebar],
    async ({ record, commands, inputs }) => {
      await record();
      assert.equal(
        commands.filter((command) => command.command === "snapshot" && command.depth === 0).length,
        1,
      );
      assert.equal(inputs(), 1);
    },
    { queryNodes: [{ ...sidebar, logicalCoordinates: false }] },
  );
});

test("unproven bounds without a current Application root block input", async () => {
  await recordingFixture(
    [application, sidebar],
    async ({ record, commands, inputs }) => {
      await assert.rejects(record(), /could not inspect/iu);
      assert.equal(
        commands.filter((command) => command.command === "snapshot" && command.depth === 0).length,
        1,
      );
      assert.equal(commands.filter((command) => command.command === "tap").length, 0);
      assert.equal(inputs(), 0);
    },
    { queryNodes: [{ ...sidebar, logicalCoordinates: false }], application: null },
  );
});

test("fallback Application geometry owned by another app blocks input", async () => {
  await recordingFixture(
    [application, sidebar],
    async ({ record, commands, inputs }) => {
      await assert.rejects(record(), /could not inspect/iu);
      assert.equal(
        commands.filter((command) => command.command === "snapshot" && command.depth === 0).length,
        1,
      );
      assert.equal(commands.filter((command) => command.command === "tap").length, 0);
      assert.equal(inputs(), 0);
    },
    {
      queryNodes: [{ ...sidebar, logicalCoordinates: false }],
      application: { ...application, bundleId: "com.example.other" },
    },
  );
});

test("nonfinite fallback Application geometry blocks input", async () => {
  await recordingFixture(
    [application, sidebar],
    async ({ record, commands, inputs }) => {
      await assert.rejects(record(), /could not inspect/iu);
      assert.equal(commands.filter((command) => command.command === "tap").length, 0);
      assert.equal(inputs(), 0);
    },
    {
      queryNodes: [{ ...sidebar, logicalCoordinates: false }],
      application: { ...application, rect: { x: 0, y: 0, width: Infinity, height: 834 } },
    },
  );
});

test("raw point recording keeps its live geometry reads and exact coordinates", async () => {
  await recordingFixture(
    [application, sidebar],
    async ({ record, commands, inputs }) => {
      await record();
      assert.ok(commands.some((command) => command.command === "snapshot" && command.depth === 0));
      const taps = commands.filter((command) => command.command === "tap");
      assert.equal(taps.length, 1);
      assert.equal(taps[0]!.selectorKey, undefined);
      assert.equal(taps[0]!.x, 500);
      assert.equal(taps[0]!.y, 600);
      assert.equal(inputs(), 1);
    },
    { interaction: { kind: "tap", target: { point: { x: 500, y: 600 } } } },
  );
});

test("a proven selector miss reacquires current bounds before coordinate fallback", async () => {
  await recordingFixture(
    [application, sidebar],
    async ({ record, commands, inputs }) => {
      await record();
      const taps = commands.filter((command) => command.command === "tap");
      assert.equal(taps.length, 2);
      assert.equal(taps[0]!.selectorKey, "id");
      assert.equal(taps[1]!.selectorKey, undefined);
      assert.equal(taps[1]!.x, 222);
      assert.equal(taps[1]!.y, 42);
      const rejected = commands.indexOf(taps[0]!);
      const fallback = commands.indexOf(taps[1]!);
      const fresh = commands.slice(rejected + 1, fallback);
      assert.deepEqual(
        fresh.map((command) => command.command),
        ["snapshot"],
      );
      assert.equal(fresh[0]!.depth, undefined);
      assert.equal(fresh[0]!.interactiveOnly, false);
      assert.equal(inputs(), 1);
    },
    { semanticFailure: "miss" },
  );
});

test("an unknown native outcome issues no retry or coordinate fallback", async () => {
  await recordingFixture(
    [application, sidebar],
    async ({ record, commands }) => {
      await assert.rejects(record(), /unknown|timed out/iu);
      assert.equal(commands.filter((command) => command.command === "querySelector").length, 1);
      assert.equal(commands.filter((command) => command.command === "snapshot").length, 0);
      assert.equal(commands.filter((command) => command.command === "tap").length, 1);
    },
    { semanticFailure: "unknown" },
  );
});

test("a custom selector miss reacquires the complete current tree beside built-in chrome", async () => {
  const custom = {
    ...sidebar,
    identifier: "custom.dismiss.button",
    label: "Dismiss panel",
    rect: { x: 400, y: 20, width: 44, height: 44 },
  };
  await recordingFixture(
    [application, sidebar, custom],
    async ({ record, commands, inputs }) => {
      await record();
      const taps = commands.filter((command) => command.command === "tap");
      assert.equal(taps.length, 2);
      assert.equal(taps[0]!.selectorValue, custom.identifier);
      assert.equal(taps[1]!.selectorKey, undefined);
      assert.equal(taps[1]!.x, 222);
      assert.equal(taps[1]!.y, 42);
      const fresh = commands.slice(commands.indexOf(taps[0]!) + 1, commands.indexOf(taps[1]!));
      assert.deepEqual(
        fresh.map((command) => command.command),
        ["snapshot"],
      );
      assert.equal(fresh[0]!.depth, undefined);
      assert.equal(fresh[0]!.interactiveOnly, false);
      assert.equal(inputs(), 1);
    },
    {
      control: custom,
      semanticFailure: "miss",
      interaction: { kind: "tap", target: { point: { x: 422, y: 42 } } },
    },
  );
});

test("two current custom selector locations refuse coordinate fallback", async () => {
  const custom = {
    ...sidebar,
    identifier: "custom.dismiss.button",
    label: "Dismiss panel",
    rect: { x: 400, y: 20, width: 44, height: 44 },
  };
  await recordingFixture(
    [application, sidebar, custom],
    async ({ record, commands, inputs }) => {
      await assert.rejects(record(), /did not match|unique|ambiguous/iu);
      assert.equal(commands.filter((command) => command.command === "tap").length, 1);
      assert.equal(inputs(), 0);
    },
    {
      control: custom,
      semanticFailure: "miss",
      interaction: { kind: "tap", target: { point: { x: 422, y: 42 } } },
      fallbackNodes: [
        application,
        sidebar,
        { ...custom, rect: { x: 200, y: 20, width: 44, height: 44 } },
        custom,
      ],
    },
  );
});

for (const truncated of [true, null] as const) {
  test(`a ${truncated === true ? "truncated" : "legacy unproven"} current tree cannot authorize recording coordinate fallback`, async () => {
    await recordingFixture(
      [application, sidebar],
      async ({ record, commands, inputs }) => {
        await assert.rejects(record(), /complete current accessibility tree/iu);
        assert.equal(commands.filter((command) => command.command === "tap").length, 1);
        assert.equal(inputs(), 0);
      },
      { semanticFailure: "miss", fallbackTruncated: truncated },
    );
  });
}

test("recording coordinate fallback refuses a current tree without Application geometry", async () => {
  await recordingFixture(
    [application, sidebar],
    async ({ record, commands, inputs }) => {
      await assert.rejects(record(), /current application geometry/iu);
      assert.equal(commands.filter((command) => command.command === "tap").length, 1);
      assert.equal(inputs(), 0);
    },
    { semanticFailure: "miss", fallbackNodes: [sidebar] },
  );
});

test("recording coordinate fallback rejects a newly foreign current control", async () => {
  await recordingFixture(
    [application, sidebar],
    async ({ record, commands, inputs }) => {
      await assert.rejects(record(), /another application/iu);
      assert.equal(commands.filter((command) => command.command === "tap").length, 1);
      assert.equal(inputs(), 0);
    },
    {
      semanticFailure: "miss",
      fallbackNodes: [application, { ...sidebar, bundleId: "com.example.other" }],
    },
  );
});

test("recording coordinate fallback rejects a changed app owner before another observation", async () => {
  await recordingFixture(
    [application, sidebar],
    async ({ record, commands, inputs }) => {
      await assert.rejects(record(), /recording application/iu);
      assert.equal(commands.filter((command) => command.command === "snapshot").length, 0);
      assert.equal(commands.filter((command) => command.command === "tap").length, 1);
      assert.equal(inputs(), 0);
    },
    { semanticFailure: "miss", fallbackRememberedApplication: "com.example.other" },
  );
});

test("recording coordinate fallback rejects an observed foreign system surface without node bundle IDs", async () => {
  await recordingFixture(
    [application, sidebar],
    async ({ record, commands, inputs }) => {
      await assert.rejects(record(), /another application/iu);
      assert.equal(commands.filter((command) => command.command === "tap").length, 1);
      assert.equal(inputs(), 0);
    },
    { semanticFailure: "miss", fallbackSurfaceBundleId: "com.apple.springboard" },
  );
});

test("legacy unproven recording origins retain the established root read", async () => {
  await recordingFixture(
    [application, sidebar],
    async ({ record, commands }) => {
      await record();
      assert.equal(
        commands.filter((command) => command.command === "snapshot" && command.depth === 0).length,
        1,
      );
    },
    { originApplication: "Unknown app" },
  );
});

test("a duplicate beyond the 256-node retained entrance cap still blocks native input", async () => {
  const nodes = [
    application,
    sidebar,
    ...Array.from({ length: 254 }, (_, index) => ({ index: index + 2, type: "Other" })),
    { ...sidebar, index: 256, rect: { x: 200, y: 20, width: 44, height: 44 } },
  ];
  await recordingFixture(nodes, async ({ record, commands, inputs, capturedNodes }) => {
    await assert.rejects(record(), /No unique control|selector|outcome.*unknown/iu);
    assert.equal(capturedNodes().length, 256);
    assert.equal(
      capturedNodes().some((node) => node.index === 256),
      false,
    );
    assert.equal(inputs(), 0);
    assert.equal(commands.filter((command) => command.command === "querySelector").length, 1);
    assert.equal(commands.filter((command) => command.command === "tap").length, 1);
    assert.ok(commands.some((command) => command.command === "snapshot" && command.depth !== 0));
  });
});
