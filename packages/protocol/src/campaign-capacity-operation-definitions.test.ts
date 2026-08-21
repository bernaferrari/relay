import assert from "node:assert/strict";
import test from "node:test";
import { campaignCapacityOperationDefinitions } from "./campaign-capacity-operation-definitions.js";

function campaignCapacityDefinition() {
  const definitions = campaignCapacityOperationDefinitions;
  assert.equal(definitions.length, 1);
  return definitions[0]!;
}

const validInput = {
  targets: [
    { targetId: "pixel-1", platform: "android" },
    { targetId: "ipad-1", platform: "ios" },
  ],
  workItems: 40,
  workItemsByPlatform: { android: 20, ios: 20 },
  duration: {
    workItemDurationMs: 1_000,
    provenance: "observed-p95",
    observedAt: 1_700_000_000_000,
    sampleCount: 25,
    maxAgeMs: 60_000,
  },
  deadlineMs: 180_000,
  setupHeadroomMs: 10_000,
  recoveryHeadroomMs: 20_000,
};

test("campaign capacity preflight retains its public descriptor and transport", () => {
  const definition = campaignCapacityDefinition();
  assert.deepEqual(
    {
      id: definition.id,
      label: definition.label,
      category: definition.category,
      mode: definition.mode,
      idempotency: definition.idempotency,
      targetCapabilities: definition.targetCapabilities,
      lease: definition.lease,
      confirmation: definition.confirmation,
      minimumRole: definition.minimumRole,
      progress: definition.progress,
      cancellable: definition.cancellable,
      transport: definition.transport,
      input: definition.input.description,
      output: definition.output.description,
    },
    {
      id: "campaign.capacity.preflight",
      label: "Preflight local campaign capacity",
      category: "execution",
      mode: "command",
      idempotency: "inherent",
      targetCapabilities: [],
      lease: "none",
      confirmation: "none",
      minimumRole: "runner",
      progress: false,
      cancellable: false,
      transport: { method: "POST", path: "/campaign-capacity/preflight" },
      input: "campaign capacity preflight input",
      output: "campaign capacity preflight response",
    },
  );
});

test("campaign capacity preflight validates exact local target and duration evidence", () => {
  const definition = campaignCapacityDefinition();
  assert.deepEqual(definition.input.parse(validInput), validInput);
  assert.deepEqual(definition.output.parse({ preflight: { checkedAt: 1 } }), {
    preflight: { checkedAt: 1 },
  });

  assert.throws(
    () => definition.input.parse({ ...validInput, targets: [] }),
    /campaign capacity targets must be a non-empty array/,
  );
  assert.throws(
    () =>
      definition.input.parse({
        ...validInput,
        targets: [{ targetId: "browser-1", platform: "browser" }],
      }),
    /campaign capacity target 0 platform must be android or ios/,
  );
  assert.throws(
    () =>
      definition.input.parse({
        ...validInput,
        duration: { workItemDurationMs: 1_000, provenance: "observed-p50" },
      }),
    /campaign capacity duration observedAt must be a number/,
  );
  assert.throws(
    () => definition.output.parse({}),
    /campaign capacity preflight response preflight must be an object/,
  );
});
