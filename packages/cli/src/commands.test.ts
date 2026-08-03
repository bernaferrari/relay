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
    [
      ["device", "launch", "ipad-1", "Settings"],
      "target.app.launch",
      { serial: "ipad-1", app: "Settings" },
    ],
    [["proposal", "record", "proposal-1"], "authoring.session.start", { sessionId: "proposal-1" }],
    [["proposal", "accept", "proposal-1"], "authoring.session.commit", { sessionId: "proposal-1" }],
    [["run", "watch", "job-1"], "job.get", { jobId: "job-1" }],
    [["activity", "follow"], "event.stream", {}],
  ] as const;

  for (const [argv, operationId, input] of cases) {
    const resolved = resolveCommand(argv);
    assert.equal(resolved.operationId, operationId, argv.join(" "));
    assert.deepEqual(resolved.input, input, argv.join(" "));
  }
  assert.equal(resolveCommand(["device", "screenshot", "pixel-9"]).behavior, "screenshot");
  assert.equal(resolveCommand(["run", "watch", "job-1"]).behavior, "job-watch");
  assert.equal(resolveCommand(["activity", "follow"]).behavior, "event-stream");
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
