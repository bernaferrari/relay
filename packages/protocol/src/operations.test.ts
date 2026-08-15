import assert from "node:assert/strict";
import test from "node:test";
import {
  operationDefinition,
  operationDefinitions,
  operationManifest,
  projectRoleAllows,
  validateOperationDefinitions,
  type OperationDefinition,
  type OperationInput,
} from "./operations.js";

test("operation descriptors have unique IDs, transports, and complete safety metadata", () => {
  assert.doesNotThrow(() => validateOperationDefinitions());
  assert.equal(
    new Set(operationDefinitions.map((item) => item.id)).size,
    operationDefinitions.length,
  );
});

test("App Map descriptors keep their canonical contiguous order", () => {
  assert.deepEqual(
    operationDefinitions.filter(({ id }) => id.startsWith("app-map.")).map(({ id }) => id),
    [
      "app-map.list",
      "app-map.get",
      "app-map.remove",
      "app-map.create",
      "app-map.duplicate",
      "app-map.export",
      "app-map.import",
      "app-map.update",
      "app-map.commit",
      "app-map.screen.add",
      "app-map.screen.capture",
      "app-map.teach",
      "app-map.screen.update",
      "app-map.screen.remove",
      "app-map.connection.create",
      "app-map.connection.update",
      "app-map.connection.remove",
      "app-map.group.save",
      "app-map.group.remove",
      "app-map.flow.save",
      "app-map.flow.run",
      "app-map.connection.run",
      "app-map.flow.remove",
      "app-map.case-stack.save",
      "app-map.case-stack.attach",
      "app-map.case-stack.remove",
      "app-map.variable.save",
      "app-map.variable.remove",
      "app-map.test.save",
      "app-map.test.remove",
      "app-map.test.edit",
      "app-map.test.propose",
      "app-map.test.compile",
      "app-map.test.run",
      "app-map.combine.preflight",
      "app-map.combine.save",
      "app-map.combine.remove",
      "app-map.routine.save",
      "app-map.routine.remove",
      "app-map.proposal.submit",
      "app-map.observations.propose",
      "app-map.proposal.approve",
      "app-map.proposal.reject",
    ],
  );
});

test("project roles form one explicit least-privilege hierarchy", () => {
  assert.equal(projectRoleAllows("viewer", "viewer"), true);
  assert.equal(projectRoleAllows("viewer", "author"), false);
  assert.equal(projectRoleAllows("author", "viewer"), true);
  assert.equal(projectRoleAllows("author", "runner"), false);
  assert.equal(projectRoleAllows("runner", "author"), true);
  assert.equal(projectRoleAllows("runner", "admin"), false);
  assert.equal(projectRoleAllows("admin", "viewer"), true);
  assert.equal(projectRoleAllows("admin", "admin"), true);
});

test("operation roles keep viewing, authoring, execution, and administration distinct", () => {
  assert.equal(operationDefinition("system.health.get").minimumRole, "viewer");
  assert.equal(operationDefinition("app-map.update").minimumRole, "author");
  assert.equal(operationDefinition("corpus.create").minimumRole, "author");
  assert.equal(operationDefinition("job.start").minimumRole, "runner");
  assert.equal(operationDefinition("corpus.start").minimumRole, "runner");
  assert.equal(operationDefinition("authoring.session.interact").minimumRole, "runner");
  assert.equal(operationDefinition("authoring.take.replay").minimumRole, "runner");
  assert.equal(operationDefinition("target.video.start").minimumRole, "runner");
  assert.equal(operationDefinition("workspace.privacy.update").minimumRole, "admin");
  assert.equal(operationDefinition("activity.list").minimumRole, "admin");
  assert.equal(operationDefinition("activity.export").minimumRole, "admin");
  assert.equal(operationDefinition("run.share.list").minimumRole, "admin");
  assert.equal(operationDefinition("run.share.create").minimumRole, "admin");
  assert.equal(operationDefinition("run.share.revoke").minimumRole, "admin");
  assert.equal(operationDefinition("target.delete").minimumRole, "admin");
});

test("map teach accepts a point tap without expectedRevision", () => {
  const parsed = operationDefinition("app-map.teach").input.parse({
    appMapId: "android-settings-now",
    leaseId: "lease-1",
    target: { kind: "device", platform: "android", targetId: "RQCY104BG8X" },
    fromScreenId: "settings",
    title: "Connections",
    interaction: { kind: "point", x: "540", y: "1275" },
  });
  assert.equal(parsed.appMapId, "android-settings-now");
  assert.equal(parsed.fromScreenId, "settings");
});

test("map teach accepts a swipe as a replayable scroll gesture", () => {
  const parsed = operationDefinition("app-map.teach").input.parse({
    appMapId: "android-settings-now",
    leaseId: "lease-1",
    target: { kind: "device", platform: "android", targetId: "RQCY104BG8X" },
    fromScreenId: "settings-top",
    title: "Settings · Middle",
    label: "Scroll settings",
    interaction: {
      kind: "swipe",
      from: { x: 540, y: 1720 },
      to: { x: 540, y: 620 },
      durationMs: 280,
    },
  });
  assert.deepEqual(parsed.interaction, {
    kind: "swipe",
    from: { x: 540, y: 1720 },
    to: { x: 540, y: 620 },
    durationMs: 280,
  });
});

test("map teach accepts only an exact reversible handoff declaration", () => {
  const input = {
    appMapId: "grok",
    leaseId: "lease-1",
    target: { kind: "device" as const, platform: "android" as const, targetId: "phone-1" },
    fromScreenId: "widget",
    title: "Add to home screen",
    interaction: { kind: "label" as const, label: "Add widget" },
    handoff: { expectedApp: "bitpit.launcher", returnAction: "back" as const },
  };
  assert.deepEqual(operationDefinition("app-map.teach").input.parse(input), input);
  assert.throws(
    () =>
      operationDefinition("app-map.teach").input.parse({
        ...input,
        handoff: { expectedApp: "bitpit.launcher", returnAction: "none" },
      }),
    /returnAction/u,
  );
});

test("App Map flow runs accept an explicit replay boundary", () => {
  const input = {
    appMapId: "map-1",
    flowId: "main",
    throughConnectionId: "open-settings",
    serial: "phone-1",
    targetKind: "device" as const,
    platform: "android" as const,
  };
  assert.deepEqual(operationDefinition("app-map.flow.run").input.parse(input), input);
  assert.throws(
    () =>
      operationDefinition("app-map.flow.run").input.parse({
        ...input,
        throughConnectionId: 42,
      }),
    /throughConnectionId/u,
  );
});

test("graph Test runs require an exact revision and explicit target", () => {
  const input = {
    appMapId: "map-1",
    testId: "checkout",
    expectedRevision: 7,
    target: { kind: "device" as const, platform: "android" as const, targetId: "phone-1" },
  };
  assert.deepEqual(operationDefinition("app-map.test.run").input.parse(input), input);
  assert.throws(
    () =>
      operationDefinition("app-map.test.run").input.parse({
        ...input,
        target: { kind: "browser", platform: "android", targetId: "browser-1" },
      }),
    /kind and platform/u,
  );
  assert.throws(
    () =>
      operationDefinition("app-map.test.run").input.parse({
        appMapId: "map-1",
        testId: "checkout",
        target: input.target,
      }),
    /expectedRevision/u,
  );
});

test("graph Test proposals accept only bounded semantic edit batches", () => {
  const input = {
    appMapId: "map-1",
    testId: "checkout",
    expectedRevision: 7,
    proposalId: "proposal-checkout",
    title: "Clarify checkout",
    edits: [
      {
        kind: "step.patch",
        stepId: "submit-order",
        patch: { intent: "Submit the reviewed order" },
      },
    ],
  };
  assert.deepEqual(operationDefinition("app-map.test.propose").input.parse(input), input);
  assert.throws(
    () => operationDefinition("app-map.test.propose").input.parse({ ...input, edits: [] }),
    /between 1 and 100 semantic edits/u,
  );
  assert.throws(
    () =>
      operationDefinition("app-map.test.propose").input.parse({
        ...input,
        edits: [{ kind: "replace-source", source: "generated code" }],
      }),
    /kind.*unsupported/u,
  );
});

test("screenshot preview coordinates accept query-string numbers", () => {
  assert.deepEqual(
    operationDefinition("target.screenshot.capture").input.parse({
      serial: "RQCY104BG8X",
      previewX: "540",
      previewY: "1275",
    }),
    { serial: "RQCY104BG8X", previewX: "540", previewY: "1275" },
  );
  assert.doesNotThrow(() =>
    operationDefinition("target.screenshot.capture").input.parse({
      serial: "RQCY104BG8X",
      previewX: 540,
      previewY: 1275,
    }),
  );
  assert.throws(
    () =>
      operationDefinition("target.screenshot.capture").input.parse({
        serial: "RQCY104BG8X",
        previewX: "left",
      }),
    /previewX/,
  );
});

test("scroll survey has one strict target-operation contract", () => {
  const definition = operationDefinition("target.scroll-survey.capture");
  assert.equal(definition.transport.method, "POST");
  assert.equal(definition.transport.path, "/capture/scroll-survey");
  assert.equal(definition.category, "target");
  assert.equal(definition.lease, "exclusive");
  assert.deepEqual(definition.targetCapabilities, ["scroll", "snapshot", "screenshot"]);
  assert.equal(definition.progress, false);
  assert.equal(definition.cancellable, false);

  assert.deepEqual(definition.input.parse({ serial: "ipad-1", maxScrolls: 4 }), {
    serial: "ipad-1",
    maxScrolls: 4,
  });
  for (const input of [
    { serial: "" },
    { serial: "   " },
    { serial: "ipad-1", maxScrolls: 0 },
    { serial: "ipad-1", maxScrolls: 7 },
    { serial: "ipad-1", maxScrolls: 1.5 },
    { serial: "ipad-1", maxScrolls: "4" },
  ]) {
    assert.throws(() => definition.input.parse(input), /scroll survey/u);
  }

  const validOutput = {
    status: "stopped",
    reason: "inspection-unavailable",
    frames: [
      {
        index: 0,
        offsetY: 0,
        screenshot: { base64: "png", width: 834, height: 1112, capturedAt: 1 },
        snapshot: {
          serial: "ipad-1",
          capturedAt: 2,
          nodes: [],
          interactive: [],
          inspectable: false,
          source: "pixels-only",
          screenIdentity: {},
        },
        appendedHeight: 0,
      },
    ],
    mergedNodes: [],
    restoredStartViewport: true,
    message: "Accessibility is unavailable; no scroll survey was started.",
  };
  assert.deepEqual(definition.output.parse(validOutput), validOutput);
  assert.throws(
    () => definition.output.parse({ ...validOutput, reason: "unknown" }),
    /scroll survey reason/u,
  );
});

test("runtime parsers reject malformed input and output", () => {
  assert.throws(
    () => operationDefinition("job.start").input.parse({ serial: "device" }),
    /job recipe/,
  );
  assert.deepEqual(
    operationDefinition("run.share.create").input.parse({
      runId: "run-1",
      expiresInHours: "24",
      includeBatch: true,
    }),
    { runId: "run-1", expiresInHours: 24, includeBatch: true },
  );
  assert.throws(
    () =>
      operationDefinition("run.share.create").input.parse({
        runId: "run-1",
        expiresInHours: 900,
      }),
    /30 days/u,
  );
  assert.throws(
    () => operationDefinition("target.screenshot.capture").output.parse({ path: "shot.png" }),
    /screenshot bytes/,
  );
  assert.throws(
    () => operationDefinition("system.health.get").output.parse({ ok: true }),
    /health/,
  );
  assert.throws(
    () =>
      operationDefinition("lease.takeover").input.parse({
        leaseId: "lease-one",
        expiresAt: Date.now() + 60_000,
        reason: "User delegated control",
        confirm: false,
      }),
    /confirm/u,
  );
  assert.deepEqual(
    operationDefinition("lease.takeover").input.parse({
      leaseId: "lease-one",
      reason: "User approved the handoff",
      confirm: true,
    }),
    { leaseId: "lease-one", reason: "User approved the handoff", confirm: true },
  );
  assert.deepEqual(
    operationDefinition("lease.create").input.parse({
      poolId: "local",
      deviceSerial: "ipad-1",
    }),
    { poolId: "local", deviceSerial: "ipad-1" },
  );
  assert.throws(
    () =>
      operationDefinition("lease.create").input.parse({
        poolId: "local",
        deviceSerial: "ipad-1",
        expiresAt: -1,
      }),
    /expiresAt/u,
  );
});

test("authoring interactions expose system controls without opaque custom steps", () => {
  const parse = operationDefinition("authoring.session.interact").input.parse;
  assert.deepEqual(
    parse({
      sessionId: "session-a",
      interaction: {
        kind: "clipboard",
        action: "paste",
        text: "hello\nworld",
        target: { identifier: "chat_text_input" },
      },
    }),
    {
      sessionId: "session-a",
      interaction: {
        kind: "clipboard",
        action: "paste",
        text: "hello\nworld",
        target: { identifier: "chat_text_input" },
      },
    },
  );
  assert.deepEqual(
    parse({ sessionId: "session-a", interaction: { kind: "app", action: "switcher" } }),
    { sessionId: "session-a", interaction: { kind: "app", action: "switcher" } },
  );
  assert.deepEqual(
    parse({
      sessionId: "session-a",
      interaction: { kind: "device", action: "keyboard-enter" },
    }),
    { sessionId: "session-a", interaction: { kind: "device", action: "keyboard-enter" } },
  );
  assert.throws(
    () => parse({ sessionId: "session-a", interaction: { kind: "device", action: "volume-up" } }),
    /device action/u,
  );
});

test("capability manifest is serializable and contains no parser functions", () => {
  const manifest = operationManifest();
  const roundTrip = JSON.parse(JSON.stringify(manifest)) as typeof manifest;
  assert.equal(roundTrip.length, operationDefinitions.length);
  assert.equal(roundTrip[0]?.id, "system.health.get");
  assert.equal(typeof roundTrip[0]?.input, "string");
});

test("descriptor invariants catch duplicates and unsafe cancellation metadata", () => {
  const first = operationDefinitions[0]!;
  assert.throws(
    () => validateOperationDefinitions([first, { ...first }] as OperationDefinition[]),
    /Duplicate operation id/,
  );
  assert.throws(
    () =>
      validateOperationDefinitions([
        {
          ...first,
          id: "invalid.cancel",
          transport: { method: "POST", path: "/invalid/cancel" },
          mode: "command",
          cancellable: true,
          progress: false,
        },
      ]),
    /does not report progress/,
  );
  assert.throws(
    () =>
      validateOperationDefinitions([
        { ...first, minimumRole: "superuser" as OperationDefinition["minimumRole"] },
      ]),
    /unsupported minimum role/,
  );
});

// Compile-time contract: known operation inputs are inferred from the registry map.
const validInput: OperationInput<"job.start"> = { recipe: "smoke" };
assert.equal(validInput.recipe, "smoke");
