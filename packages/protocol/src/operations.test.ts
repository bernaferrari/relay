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

test("runtime parsers reject malformed input and output", () => {
  assert.throws(
    () => operationDefinition("job.start").input.parse({ serial: "device" }),
    /job recipe/,
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
