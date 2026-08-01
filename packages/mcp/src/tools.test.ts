import { operationDefinitions } from "@relay/protocol";
import assert from "node:assert/strict";
import test from "node:test";
import {
  assertRelayMcpToolParity,
  relayMcpExclusions,
  relayMcpTools,
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
  assert.deepEqual(relayMcpExclusions, [
    {
      operationId: "event.stream",
      reason: "Relay event streams are resource-only and are not exposed as MCP tools.",
    },
  ]);
  assert.equal(
    relayMcpTools.some(({ name }) => name === "relay_event_stream"),
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
});

test("maps screenshot capture to its stable Relay tool descriptor", () => {
  assert.deepEqual(tool("target.screenshot.capture"), {
    name: "relay_target_screenshot_capture",
    operationId: "target.screenshot.capture",
    title: "Capture target screenshot",
    description: "Capture target screenshot. Input: target operation.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    requiresConfirmation: false,
  });
});
