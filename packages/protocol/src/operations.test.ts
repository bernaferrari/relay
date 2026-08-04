import assert from "node:assert/strict";
import test from "node:test";
import {
  operationDefinition,
  operationDefinitions,
  operationManifest,
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
});

// Compile-time contract: known operation inputs are inferred from the registry map.
const validInput: OperationInput<"job.start"> = { recipe: "smoke" };
assert.equal(validInput.recipe, "smoke");
