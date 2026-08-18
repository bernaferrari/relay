import { operationDefinitions } from "@relay/protocol";
import assert from "node:assert/strict";
import test from "node:test";
import {
  assertRelayMcpToolParity,
  defaultRelayMcpProfile,
  relayMcpExclusions,
  relayMcpOperationCatalog,
  relayMcpProfiles,
  relayMcpTools,
  relayMcpToolsForProfile,
  relayToolName,
} from "./tools.js";

const eligibleOperations = operationDefinitions.filter(
  ({ id }) => !relayMcpExclusions.some(({ operationId }) => operationId === id),
);

function tool(operationId: (typeof operationDefinitions)[number]["id"]) {
  const descriptor = relayMcpTools.find((candidate) => candidate.operationId === operationId);
  assert.ok(descriptor, `missing MCP tool for ${operationId}`);
  return descriptor;
}

test("maps every tool-eligible operation exactly once", () => {
  assert.doesNotThrow(() => assertRelayMcpToolParity());
  assert.deepEqual(
    relayMcpTools.map(({ operationId }) => operationId),
    eligibleOperations.map(({ id }) => id),
  );
  assert.equal(
    new Set(relayMcpTools.map(({ operationId }) => operationId)).size,
    relayMcpTools.length,
  );
  assert.deepEqual(
    relayMcpExclusions.map(({ operationId }) => operationId),
    [
      "event.stream",
      "target.stream.open",
      "activity.export",
      "recipe.list",
      "recipe.get",
      "recipe.create",
      "recipe.update",
      "recipe.delete",
      "recipe.yaml.get",
      "recipe.import",
      "recipe.evidence.create",
      "recipe.history.list",
      "recipe.history.restore",
      "recipe.stability.get",
      "discovery.promote",
    ],
  );
  assert.ok(relayMcpExclusions.every(({ reason }) => reason.trim().length > 0));
  assert.equal(
    relayMcpTools.some(({ name }) => name === "relay_event_stream"),
    false,
  );
  assert.equal(
    relayMcpTools.some(({ name }) => name === "relay_activity_export"),
    false,
  );
});

test("uses unique deterministic names in operation registry order", () => {
  const names = relayMcpTools.map(({ name }) => name);
  assert.deepEqual(
    names,
    eligibleOperations.map(({ id }) => `relay_${id.replace(/[.-]/g, "_")}`),
  );
  assert.equal(new Set(names).size, names.length);
  assert.equal(relayToolName("device-pool.list"), "relay_device_pool_list");
});

test("marks every query as read-only and inherently idempotent", () => {
  for (const definition of eligibleOperations.filter(({ mode }) => mode === "query")) {
    assert.deepEqual(tool(definition.id).annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    assert.equal(tool(definition.id).requiresConfirmation, false);
  }
});

test("marks delete and dangerous operations as destructive and confirmation-required", () => {
  const deleted = tool("target.delete");
  assert.equal(deleted.annotations.readOnlyHint, false);
  assert.equal(deleted.annotations.destructiveHint, true);
  assert.equal(deleted.annotations.idempotentHint, true);
  assert.equal(deleted.requiresConfirmation, true);

  const dangerous = tool("run.retention.apply");
  assert.equal(dangerous.annotations.readOnlyHint, false);
  assert.equal(dangerous.annotations.destructiveHint, true);
  assert.equal(dangerous.annotations.idempotentHint, false);
  assert.equal(dangerous.requiresConfirmation, true);

  const confirmationOnly = tool("workspace.evidence.update");
  assert.equal(confirmationOnly.annotations.destructiveHint, false);
  assert.equal(confirmationOnly.requiresConfirmation, true);
  assert.match(confirmationOnly.description, /Requires confirm: true\.$/);
  assert.doesNotMatch(tool("target.list").description, /confirm: true/);
});

test("maps screenshot capture to its stable Relay tool descriptor", () => {
  const screenshot = tool("target.screenshot.capture");
  assert.deepEqual(
    {
      name: screenshot.name,
      operationId: screenshot.operationId,
      title: screenshot.title,
      description: screenshot.description,
      annotations: screenshot.annotations,
      requiresConfirmation: screenshot.requiresConfirmation,
    },
    {
      name: "relay_target_screenshot_capture",
      operationId: "target.screenshot.capture",
      title: "Capture target screenshot",
      description:
        "Capture target screenshot. Pass operation fields directly. Project role: viewer. Target capabilities: screenshot. Lease: shared. Step 1 of a tap: capture pixels, then call interact. Do not retry snapshot in a loop if the tree is missing.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      requiresConfirmation: false,
    },
  );
  assert.deepEqual(screenshot.inputSchema.parse({ serial: "device-1" }), {
    serial: "device-1",
  });
  assert.throws(() => screenshot.inputSchema.parse({ input: { serial: "device-1" } }));
});

test("lets agents tap by accessibility identifier", () => {
  const interact = tool("target.interact");
  assert.match(interact.description, /Prefer identifier/);
  assert.match(interact.description, /Step 2 of a tap/);
  assert.deepEqual(
    interact.inputSchema.parse({
      serial: "ipad-1",
      kind: "identifier",
      identifier: "settings.gear",
    }),
    { serial: "ipad-1", kind: "identifier", identifier: "settings.gear" },
  );
  assert.deepEqual(
    interact.inputSchema.parse({
      serial: "ipad-1",
      kind: "swipe",
      from: { x: 10, y: 20 },
      to: { x: 10, y: 400 },
      preview: true,
    }),
    {
      serial: "ipad-1",
      kind: "swipe",
      from: { x: 10, y: 20 },
      to: { x: 10, y: 400 },
      preview: true,
    },
  );
});

test("advertises serial on recover and list tools in the control profile", () => {
  assert.deepEqual(tool("target.recover").inputSchema.parse({ serial: "ipad-1" }), {
    serial: "ipad-1",
  });
  assert.deepEqual(tool("target.devices.list").inputSchema.parse({}), {});
  assert.deepEqual(tool("target.list").inputSchema.parse({}), {});
  assert.deepEqual(tool("system.doctor.get").inputSchema.parse({}), {});
  assert.deepEqual(tool("lease.list").inputSchema.parse({ status: "active" }), {
    status: "active",
  });
  assert.match(tool("lease.create").description, /poolId "local"/);
});

test("exposes app launch as one high-intent leased target tool", () => {
  const launch = tool("target.app.launch");
  assert.equal(launch.name, "relay_target_app_launch");
  assert.match(launch.description, /Project role: runner/);
  assert.match(launch.description, /Target capabilities: launch/);
  assert.match(launch.description, /Lease: exclusive/);
  assert.deepEqual(launch.inputSchema.parse({ serial: "ipad-1", app: "Settings" }), {
    serial: "ipad-1",
    app: "Settings",
  });
});

test("gives agents exact schemas for App Map metadata and Case Stacks", () => {
  assert.deepEqual(
    tool("app-map.update").inputSchema.parse({
      appMapId: "checkout",
      expectedRevision: 3,
      patch: { description: "Checkout coverage" },
    }),
    {
      appMapId: "checkout",
      expectedRevision: 3,
      patch: { description: "Checkout coverage" },
    },
  );
  assert.deepEqual(
    tool("app-map.case-stack.attach").inputSchema.parse({
      appMapId: "checkout",
      connectionId: "choose-model",
      caseStackId: "thinking-levels",
      expectedRevision: 4,
    }),
    {
      appMapId: "checkout",
      connectionId: "choose-model",
      caseStackId: "thinking-levels",
      expectedRevision: 4,
    },
  );
  assert.throws(() =>
    tool("app-map.update").inputSchema.parse({
      appMapId: "checkout",
      expectedRevision: 3,
      patch: { unknownSecretField: true },
    }),
  );
});

test("gives run agents one revision-pinned graph Test operation", () => {
  const input = {
    appMapId: "checkout",
    testId: "smoke",
    expectedRevision: 7,
    target: { kind: "browser" as const, platform: "browser" as const, targetId: "chrome" },
  };
  assert.deepEqual(tool("app-map.test.run").inputSchema.parse(input), input);
  assert.ok(
    relayMcpToolsForProfile("run").some(({ operationId }) => operationId === "app-map.test.run"),
  );
  assert.throws(() =>
    tool("app-map.test.run").inputSchema.parse({
      appMapId: "checkout",
      testId: "smoke",
      target: input.target,
    }),
  );
  assert.throws(() =>
    tool("app-map.test.run").inputSchema.parse({
      appMapId: "checkout",
      testId: "smoke",
      expectedRevision: 7,
      target: { kind: "browser", platform: "android", targetId: "chrome" },
    }),
  );
});

test("defines deterministic task profiles with a compact authoring default", () => {
  assert.deepEqual(relayMcpProfiles, [
    "control",
    "map",
    "observe",
    "author",
    "test",
    "run",
    "execute",
    "review",
    "admin",
    "full",
  ]);
  assert.equal(defaultRelayMcpProfile, "control");
  assert.deepEqual(relayMcpToolsForProfile("full"), relayMcpTools);
  assert.equal(
    relayMcpToolsForProfile("observe").every(({ annotations }) => annotations.readOnlyHint),
    true,
  );
  assert.ok(
    relayMcpToolsForProfile("control").some(({ operationId }) => operationId === "target.interact"),
  );
  assert.ok(
    relayMcpToolsForProfile("control").some(({ operationId }) => operationId === "target.recover"),
  );
  assert.equal(
    relayMcpToolsForProfile("control").some(({ operationId }) =>
      operationId.startsWith("app-map."),
    ),
    false,
  );
  assert.ok(
    relayMcpToolsForProfile("author").some(
      ({ operationId }) => operationId === "app-map.proposal.submit",
    ),
  );
  const observed = new Set(
    relayMcpToolsForProfile("observe").map(({ operationId }) => operationId),
  );
  assert.ok(
    relayMcpToolsForProfile("author").some(({ operationId }) => operationId === "discovery.start"),
  );
  assert.ok(
    relayMcpToolsForProfile("map").some(({ operationId }) => operationId === "discovery.cancel"),
  );
  assert.ok(
    relayMcpToolsForProfile("author").some(
      ({ operationId }) => operationId === "authoring.session.create",
    ),
  );
  assert.equal(
    relayMcpToolsForProfile("author").some(({ operationId }) => operationId === "run.get"),
    false,
  );
  assert.ok(observed.has("run.get"));
  assert.deepEqual(
    relayMcpToolsForProfile("test")
      .map(({ operationId }) => operationId)
      .filter((operationId) =>
        [
          "app-map.test.save",
          "app-map.test.edit",
          "app-map.test.propose",
          "app-map.test.compile",
          "app-map.test.run",
          "job.get",
          "job.cancel",
          "run.get",
          "run.evidence.get",
        ].includes(operationId),
      ),
    [
      "app-map.test.save",
      "app-map.test.edit",
      "app-map.test.propose",
      "app-map.test.compile",
      "app-map.test.run",
      "job.get",
      "job.cancel",
      "run.get",
      "run.evidence.get",
    ],
  );
  assert.ok(
    relayMcpToolsForProfile("author").some(
      ({ operationId }) => operationId === "workspace.variables.update",
    ),
  );
  assert.ok(
    relayMcpToolsForProfile("author").some(
      ({ operationId }) => operationId === "authoring.session.observe",
    ),
  );
  assert.ok(
    relayMcpToolsForProfile("author").some(({ operationId }) =>
      operationId.startsWith("discovery."),
    ),
  );
  assert.equal(
    relayMcpToolsForProfile("author").some(
      ({ operationId }) => operationId === "app-map.proposal.approve",
    ),
    false,
  );
  assert.equal(
    relayMcpToolsForProfile("author").some(
      ({ operationId }) => operationId === "app-map.connection.create",
    ),
    false,
  );
  assert.ok(
    relayMcpToolsForProfile("execute").some(({ operationId }) => operationId === "job.start"),
  );
  assert.deepEqual(relayMcpToolsForProfile("execute"), relayMcpToolsForProfile("run"));
  assert.ok(
    relayMcpToolsForProfile("review").some(
      ({ operationId }) => operationId === "app-map.proposal.approve",
    ),
  );
  assert.ok(
    relayMcpToolsForProfile("admin").some(
      ({ operationId }) => operationId === "workspace.privacy.update",
    ),
  );
  for (const profile of relayMcpProfiles) {
    const selected = relayMcpToolsForProfile(profile);
    assert.equal(new Set(selected.map(({ operationId }) => operationId)).size, selected.length);
    if (profile !== "full") assert.ok(selected.length < 35, `${profile}: ${selected.length}`);
  }
});

test("publishes compact discovery metadata for every eligible operation", () => {
  const catalog = relayMcpOperationCatalog();
  assert.deepEqual(
    catalog.map(({ operationId }) => operationId),
    relayMcpTools.map(({ operationId }) => operationId),
  );
  const screenshot = catalog.find(({ operationId }) => operationId === "target.screenshot.capture");
  assert.deepEqual(screenshot, {
    operationId: "target.screenshot.capture",
    task: "evidence",
    role: "viewer",
    confirmation: "none",
    capabilities: ["screenshot"],
    profiles: ["control", "map", "observe", "author", "test", "run", "execute", "review"],
  });
});

test("publishes exact graph Test and one-pass run schemas", () => {
  const save = tool("app-map.test.save").inputSchema.parse({
    appMapId: "checkout",
    testId: "smoke",
    expectedRevision: 7,
    test: {
      name: "Checkout smoke",
      kind: "scenario",
      intentSchemaVersion: 1,
      capture: { mode: "failures-only" },
      steps: [
        {
          id: "submit-order",
          kind: "instruction",
          intent: "Submit the order",
          binding: {
            status: "resolved",
            kind: "connections",
            connectionIds: ["submit"],
          },
        },
        {
          id: "branch-on-total",
          kind: "decision",
          intent: "Choose the expected total",
          binding: {
            status: "resolved",
            kind: "condition",
            input: "total",
            operator: "exists",
          },
          thenSteps: [],
        },
        {
          id: "validate-success",
          kind: "validation",
          intent: "Success is visible",
          binding: {
            status: "resolved",
            kind: "assertion",
            assertion: { kind: "screen", screenId: "success" },
          },
        },
        {
          id: "extract-order-id",
          kind: "extraction",
          intent: "Remember the order id",
          binding: {
            status: "resolved",
            kind: "extract",
            as: "order_id",
            target: { identifier: "order-id" },
          },
        },
        {
          id: "confirm-payment",
          kind: "manual",
          intent: "Confirm the external payment",
          binding: {
            status: "resolved",
            kind: "pause",
            message: "Confirm payment, then continue",
            reason: "verification",
          },
        },
        {
          id: "sign-in",
          kind: "module",
          intent: "Sign in before checkout",
          binding: { status: "resolved", kind: "routine", routineId: "sign-in" },
        },
        {
          id: "retry-once",
          kind: "loop",
          intent: "Retry once",
          binding: { status: "resolved", kind: "repeat", count: 1 },
          steps: [],
        },
        {
          id: "calculate-total",
          kind: "script",
          intent: "Calculate the expected total",
          binding: { status: "resolved", kind: "script", source: "return true" },
        },
      ],
    },
  });
  assert.equal((save.test as { kind?: string }).kind, "scenario");
  for (const kind of ["path", "tour"] as const) {
    assert.throws(() =>
      tool("app-map.test.save").inputSchema.parse({
        appMapId: "checkout",
        testId: `old-${kind}`,
        expectedRevision: 7,
        test: { name: `Old ${kind}`, kind },
      }),
    );
  }
  assert.throws(() =>
    tool("app-map.test.save").inputSchema.parse({
      appMapId: "checkout",
      testId: "smoke",
      expectedRevision: 7,
      test: {
        name: "Bad",
        kind: "scenario",
        intentSchemaVersion: 1,
        steps: [{ id: "bad", kind: "instruction", intent: "Bad", binding: {} }],
      },
    }),
  );
  assert.throws(() =>
    tool("app-map.test.save").inputSchema.parse({
      appMapId: "checkout",
      testId: "smoke",
      expectedRevision: 7,
      test: {
        name: "Duplicate IDs",
        kind: "scenario",
        intentSchemaVersion: 1,
        steps: [
          {
            id: "same",
            kind: "script",
            intent: "First",
            binding: { status: "resolved", kind: "script", source: "return true" },
          },
          {
            id: "same",
            kind: "script",
            intent: "Second",
            binding: { status: "resolved", kind: "script", source: "return true" },
          },
        ],
      },
    }),
  );
  assert.throws(() =>
    tool("app-map.test.edit").inputSchema.parse({
      appMapId: "checkout",
      testId: "smoke",
      expectedRevision: 7,
      edits: [
        {
          kind: "step.reorder",
          orderedStepIds: ["submit-order"],
          placement: { parentStepId: "branch-on-total", branch: "root" },
        },
      ],
    }),
  );
  assert.deepEqual(
    tool("app-map.test.run").inputSchema.parse({
      appMapId: "checkout",
      testId: "smoke",
      expectedRevision: 7,
      target: { kind: "device", platform: "android", targetId: "pixel-9" },
    }),
    {
      appMapId: "checkout",
      testId: "smoke",
      expectedRevision: 7,
      target: { kind: "device", platform: "android", targetId: "pixel-9" },
    },
  );
  assert.throws(() =>
    tool("app-map.test.run").inputSchema.parse({
      appMapId: "checkout",
      testId: "smoke",
      expectedRevision: 7,
      target: { kind: "device", platform: "browser", targetId: "pixel-9" },
    }),
  );
});
