import assert from "node:assert/strict";
import test from "node:test";
import { operationDefinitions } from "@relay/protocol";
import {
  cliOperationDescriptors,
  cliResourceDescriptors,
  mappedCommandDescriptors,
  resolveCommand,
  resolveResourceCommand,
} from "./commands.js";
import { renderHelp } from "./help.js";

test("every registry operation is mapped or excluded exactly once", () => {
  const coverage = new Map<string, number>();
  for (const descriptor of cliOperationDescriptors) {
    coverage.set(descriptor.operationId, (coverage.get(descriptor.operationId) ?? 0) + 1);
    if ("exclusion" in descriptor) assert.ok(descriptor.reason.trim());
    else assert.ok(descriptor.paths.length > 0);
  }

  assert.deepEqual([...coverage.keys()].sort(), operationDefinitions.map(({ id }) => id).sort());
  assert.deepEqual(
    [...coverage.entries()].filter(([, count]) => count !== 1),
    [],
  );
});

test("friendly command paths are unique", () => {
  const paths = mappedCommandDescriptors.flatMap((descriptor) =>
    descriptor.paths.map((candidate) => candidate.command),
  );
  paths.push(...cliResourceDescriptors.map((descriptor) => descriptor.path.command));
  assert.equal(new Set(paths).size, paths.length);
});

test("every friendly path resolves with its declared arguments", () => {
  for (const descriptor of mappedCommandDescriptors) {
    for (const candidate of descriptor.paths) {
      const arguments_ = (candidate.arguments ?? []).map((key) => `${key}-value`);
      const resolved = resolveCommand([...candidate.command.split(" "), ...arguments_]);
      assert.equal(resolved.operationId, descriptor.operationId, candidate.command);
      assert.equal(resolved.commandPath, candidate.command);
    }
  }
});

test("all plan-035 authoring operations have friendly command paths", () => {
  const authoringOperationIds = [
    "authoring.session.list",
    "authoring.session.get",
    "authoring.session.create",
    "authoring.session.observe",
    "authoring.session.capture",
    "authoring.session.start",
    "authoring.session.interact",
    "authoring.session.stop",
    "authoring.take.trim",
    "authoring.take.reorder",
    "authoring.take.replace",
    "authoring.take.replay",
    "authoring.session.commit",
    "authoring.session.discard",
    "authoring.session.cancel",
    "authoring.session.cleanup",
  ] as const;
  const mappedOperationIds = new Set(
    mappedCommandDescriptors.map(({ operationId }) => operationId),
  );

  assert.deepEqual(
    authoringOperationIds.filter((operationId) => !mappedOperationIds.has(operationId)),
    [],
  );
});

test("path arguments merge into full operation input without hiding revision metadata", () => {
  assert.deepEqual(
    resolveCommand(["screen", "update", "checkout", "home"], {
      expectedRevision: 7,
      patch: { title: "Home" },
    }),
    {
      operationId: "app-map.screen.update",
      commandPath: "screen update",
      input: {
        appMapId: "checkout",
        screenId: "home",
        expectedRevision: 7,
        patch: { title: "Home" },
      },
    },
  );
});

test("screen and connection commands use granular App Map operations", () => {
  assert.deepEqual(resolveCommand(["map", "duplicate", "map-1", "map-2"]), {
    operationId: "app-map.duplicate",
    commandPath: "map duplicate",
    input: { sourceAppMapId: "map-1", appMapId: "map-2" },
  });
  assert.equal(resolveCommand(["screen", "list", "map-1"]).operationId, "app-map.get");
  assert.equal(
    resolveCommand(["connection", "update", "map-1", "connection-1"], {
      expectedRevision: 3,
      patch: { label: "Continue" },
    }).operationId,
    "app-map.connection.update",
  );
});

test("matrix authoring vocabulary exposes modifiers, tests, and saved matrices", () => {
  for (const command of ["state-set list", "variable list", "test list", "run-matrix list"]) {
    const resolved = resolveCommand([...command.split(" "), "grok-android"]);
    assert.equal(resolved.operationId, "app-map.get", command);
    assert.deepEqual(resolved.input, { appMapId: "grok-android" }, command);
  }
  assert.deepEqual(resolveCommand(["run-matrix", "preflight", "grok-android", "locale-x-tour"]), {
    operationId: "app-map.combine.preflight",
    commandPath: "run-matrix preflight",
    input: { appMapId: "grok-android", combineId: "locale-x-tour" },
  });
  assert.deepEqual(
    resolveCommand(["run-matrix", "dry-run", "grok-android", "locale-x-tour"], {
      serial: "pixel-9",
    }),
    {
      operationId: "app-map.combine.preflight",
      commandPath: "run-matrix dry-run",
      input: { appMapId: "grok-android", combineId: "locale-x-tour", serial: "pixel-9" },
    },
  );
});

test("Test help exposes graph creation, semantic edits, and the required run target", () => {
  const help = renderHelp("test");
  assert.match(help, /intentSchemaVersion 1/);
  assert.match(help, /test\.patch, step\.add/);
  assert.match(help, /expectedRevision \(number, required\)/);
  assert.match(help, /target \(object, required\)/);
  assert.match(help, /"kind":"browser","platform":"browser"/);
  assert.match(help, /revision and target are mandatory/);
  assert.match(help, /eventId/);
  assert.match(help, /relay test save checkout smoke/);
  assert.match(help, /relay test run checkout smoke/);
});

test("session replay is an alias of take replay", () => {
  assert.deepEqual(resolveCommand(["session", "replay", "authoring-1"]), {
    operationId: "authoring.take.replay",
    commandPath: "session replay",
    input: { sessionId: "authoring-1" },
  });
});

test("device survey exposes the canonical scroll-survey operation and bounded input help", () => {
  assert.deepEqual(resolveCommand(["device", "survey", "ipad-1"], { maxScrolls: 6 }), {
    operationId: "target.scroll-survey.capture",
    commandPath: "device survey",
    input: { serial: "ipad-1", maxScrolls: 6 },
  });
  const descriptor = mappedCommandDescriptors.find(
    (candidate) => candidate.operationId === "target.scroll-survey.capture",
  );
  assert.ok(descriptor && !("exclusion" in descriptor));
  const help = descriptor.paths.find((candidate) => candidate.command === "device survey");
  assert.equal(help?.inputHelp?.[0]?.name, "maxScrolls");
  assert.match(help?.inputHelp?.[0]?.type ?? "", /1-6/u);
  assert.match(help?.note ?? "", /exclusive lease/u);
});

test("screen capture-scroll targets one durable Screen Variant", () => {
  assert.deepEqual(
    resolveCommand(["screen", "capture-scroll", "map-1", "settings", "settings-ja"], {
      expectedRevision: 12,
      target: { kind: "device", platform: "ios", targetId: "ipad-1" },
      leaseId: "lease-1",
      maxScrolls: 6,
    }),
    {
      operationId: "app-map.scroll-surface.capture",
      commandPath: "screen capture-scroll",
      input: {
        appMapId: "map-1",
        screenId: "settings",
        variantId: "settings-ja",
        expectedRevision: 12,
        target: { kind: "device", platform: "ios", targetId: "ipad-1" },
        leaseId: "lease-1",
        maxScrolls: 6,
      },
    },
  );
  const descriptor = mappedCommandDescriptors.find(
    (candidate) => candidate.operationId === "app-map.scroll-surface.capture",
  );
  const help = descriptor?.paths.find((candidate) => candidate.command === "screen capture-scroll");
  assert.match(help?.note ?? "", /Explicitly opts/u);
  assert.match(help?.note ?? "", /should remain viewport-only/u);
});

test("screen regenerate-scroll rebuilds derived views without device input", () => {
  assert.deepEqual(
    resolveCommand(
      ["screen", "regenerate-scroll", "map-1", "settings", "settings-ja", "capture-1"],
      { expectedRevision: 13 },
    ),
    {
      operationId: "app-map.scroll-surface.regenerate",
      commandPath: "screen regenerate-scroll",
      input: {
        appMapId: "map-1",
        screenId: "settings",
        variantId: "settings-ja",
        captureId: "capture-1",
        expectedRevision: 13,
      },
    },
  );
});

test("persisted run replay has one friendly watched command", () => {
  assert.deepEqual(resolveCommand(["run", "replay", "run-1"]), {
    operationId: "run.replay",
    commandPath: "run replay",
    input: { runId: "run-1" },
    behavior: "job-start-watch",
  });
});

test("unknown session verbs point at family help instead of four arbitrary commands", () => {
  assert.throws(
    () => resolveCommand(["session", "reploy", "authoring-1"]),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      return (
        /relay session --help/.test(message) &&
        /session begin/.test(message) &&
        /session tap/.test(message) &&
        /session replay/.test(message) &&
        /session commit/.test(message)
      );
    },
  );
});

test("authoring interaction aliases construct explicit session inputs", () => {
  assert.deepEqual(resolveCommand(["session", "back", "session-1"]), {
    operationId: "authoring.session.interact",
    commandPath: "session back",
    input: { sessionId: "session-1", interaction: { kind: "key", key: "back" } },
  });
  assert.deepEqual(
    resolveCommand(["session", "tap", "session-1"], {
      interaction: { kind: "swipe", target: { x: 0.25, y: 0.75 } },
    }).input,
    { sessionId: "session-1", interaction: { kind: "tap", target: { x: 0.25, y: 0.75 } } },
  );
  assert.deepEqual(
    resolveCommand(["proposal", "batch", "proposal-1"], {
      interaction: {
        steps: [
          { kind: "tap", target: { identifier: "send" } },
          { kind: "sleep", ms: 1_000 },
          { kind: "tap", target: { identifier: "stop" } },
        ],
        label: "Interrupt response",
      },
    }).input,
    {
      sessionId: "proposal-1",
      interaction: {
        kind: "steps",
        steps: [
          { kind: "tap", target: { identifier: "send" } },
          { kind: "sleep", ms: 1_000 },
          { kind: "tap", target: { identifier: "stop" } },
        ],
        label: "Interrupt response",
      },
    },
  );
});

test("locale-matrix help leads with map and flow, not a library recipe", () => {
  const start = mappedCommandDescriptors.find(
    (descriptor) => descriptor.operationId === "job.locale-matrix.start",
  );
  const infer = mappedCommandDescriptors.find(
    (descriptor) => descriptor.operationId === "job.locale-matrix.infer",
  );
  assert.ok(start && !("exclusion" in start));
  assert.ok(infer && !("exclusion" in infer));
  const startHelp = start.paths[0];
  const inferHelp = infer.paths[0];
  assert.match(startHelp?.examples?.[0] ?? "", /appMapId/);
  assert.match(startHelp?.examples?.[0] ?? "", /flowId/);
  assert.equal(/recipe/.test(startHelp?.examples?.[0] ?? ""), false);
  assert.match(startHelp?.summary ?? "", /map path|locale/i);
  assert.match(inferHelp?.examples?.[0] ?? "", /appMapId/);
  const optionStart = mappedCommandDescriptors.find(
    (descriptor) => descriptor.operationId === "job.combine.start",
  );
  assert.ok(optionStart && !("exclusion" in optionStart));
  assert.match(optionStart.paths[0]?.examples?.[0] ?? "", /run-matrix run|variableIds|combineId/);
});

test("App Map vocabulary resolves to canonical granular operations", () => {
  const cases = [
    [["map", "list"], "app-map.list", {}],
    [["map", "get", "checkout"], "app-map.get", { appMapId: "checkout" }],
    [["map", "update", "checkout"], "app-map.update", { appMapId: "checkout" }],
    [
      ["connect", "update", "checkout", "continue"],
      "app-map.connection.update",
      { appMapId: "checkout", connectionId: "continue" },
    ],
    [
      ["connect", "run", "checkout", "continue"],
      "app-map.connection.run",
      { appMapId: "checkout", connectionId: "continue" },
    ],
    [
      ["flow", "run", "checkout", "main"],
      "app-map.flow.run",
      { appMapId: "checkout", flowId: "main" },
    ],
    [
      ["routine", "run", "login", "pixel-9"],
      "action.run",
      { actionId: "login", serial: "pixel-9" },
    ],
    [["device", "screenshot", "pixel-9"], "target.screenshot.capture", { serial: "pixel-9" }],
    [["device", "survey", "pixel-9"], "target.scroll-survey.capture", { serial: "pixel-9" }],
    [
      ["device", "launch", "ipad-1", "Settings"],
      "target.app.launch",
      { serial: "ipad-1", app: "Settings" },
    ],
    [["device", "recover", "ipad-1"], "target.recover", { serial: "ipad-1" }],
    [["proposal", "record", "proposal-1"], "authoring.session.start", { sessionId: "proposal-1" }],
    [["proposal", "accept", "proposal-1"], "authoring.session.commit", { sessionId: "proposal-1" }],
    [["run", "watch", "job-1"], "job.get", { jobId: "job-1" }],
    [["activity", "follow"], "event.stream", {}],
    [
      ["test", "run", "grok-ios", "settings-tour"],
      "app-map.test.run",
      { appMapId: "grok-ios", testId: "settings-tour" },
    ],
    [
      ["test", "edit", "grok-ios", "checkout"],
      "app-map.test.edit",
      { appMapId: "grok-ios", testId: "checkout" },
    ],
    [
      ["test", "compile", "grok-ios", "checkout"],
      "app-map.test.compile",
      { appMapId: "grok-ios", testId: "checkout" },
    ],
    [
      ["work", "run", "grok-ios", "settings-tour"],
      "app-map.test.run",
      { appMapId: "grok-ios", testId: "settings-tour" },
    ],
    [
      ["run-matrix", "run", "grok-ios", "language-x-settings"],
      "job.combine.start",
      { appMapId: "grok-ios", combineId: "language-x-settings" },
    ],
    [
      ["combine", "run", "grok-ios", "language-x-settings"],
      "job.combine.start",
      { appMapId: "grok-ios", combineId: "language-x-settings" },
    ],
    [
      ["combo", "run", "grok-ios", "language-x-settings"],
      "job.combine.start",
      { appMapId: "grok-ios", combineId: "language-x-settings" },
    ],
  ] as const;

  for (const [argv, operationId, input] of cases) {
    const resolved = resolveCommand(argv);
    assert.equal(resolved.operationId, operationId, argv.join(" "));
    assert.deepEqual(resolved.input, input, argv.join(" "));
  }
  assert.equal(resolveCommand(["device", "screenshot", "pixel-9"]).behavior, "screenshot");
  assert.equal(resolveCommand(["run", "watch", "job-1"]).behavior, "job-watch");
  assert.equal(resolveCommand(["activity", "follow"]).behavior, "event-stream");
  assert.equal(
    resolveCommand(["test", "run", "grok-ios", "settings-tour"]).behavior,
    "job-start-watch",
  );
  assert.equal(
    resolveCommand(["work", "run", "grok-ios", "settings-tour"]).behavior,
    "job-start-watch",
  );
  assert.equal(
    resolveCommand(["run-matrix", "run", "grok-ios", "language-x-settings"]).behavior,
    "job-start-watch",
  );
  assert.equal(
    resolveCommand(["combine", "run", "grok-ios", "language-x-settings"]).behavior,
    "job-start-watch",
  );
  assert.equal(
    resolveCommand(["combo", "run", "grok-ios", "language-x-settings"]).behavior,
    "job-start-watch",
  );
});

test("declared read-only resources build encoded paths", () => {
  assert.deepEqual(resolveResourceCommand(["run", "get", "run/a"]), {
    resourceId: "run.get",
    commandPath: "run get",
    resourcePath: "/runs/run%2Fa",
  });
  assert.deepEqual(
    resolveResourceCommand(["run", "evidence", "run/a"], {
      limit: 200,
      includeBodies: true,
    }),
    {
      resourceId: "run.evidence",
      commandPath: "run evidence",
      resourcePath: "/runs/run%2Fa/evidence?limit=200&includeBodies=true",
    },
  );
  assert.deepEqual(
    resolveResourceCommand(["activity", "list"], { limit: 20, cursor: "next/value" }),
    {
      resourceId: "activity.list",
      commandPath: "activity list",
      resourcePath: "/activity?limit=20&cursor=next%2Fvalue",
    },
  );
  assert.throws(
    () => resolveResourceCommand(["activity", "list"], { limit: 0 }),
    /positive integer/,
  );
});
