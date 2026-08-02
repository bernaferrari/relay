import { operationDefinitions } from "@relay/protocol";
import assert from "node:assert/strict";
import test from "node:test";
import {
  assertRelayMcpToolParity,
  defaultRelayMcpProfile,
  relayMcpExclusions,
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
        "Capture target screenshot. Pass operation fields directly. Target capabilities: screenshot. Lease: shared.",
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
  assert.deepEqual(screenshot.inputSchema.parse({ input: { serial: "device-1" } }), {
    serial: "device-1",
  });
});

test("defines deterministic role profiles with a compact authoring default", () => {
  assert.deepEqual(relayMcpProfiles, ["observe", "author", "execute", "review", "admin", "full"]);
  assert.equal(defaultRelayMcpProfile, "author");
  assert.deepEqual(relayMcpToolsForProfile("full"), relayMcpTools);
  assert.equal(
    relayMcpToolsForProfile("observe").every(({ annotations }) => annotations.readOnlyHint),
    true,
  );
  assert.ok(
    relayMcpToolsForProfile("author").some(
      ({ operationId }) => operationId === "app-map.connection.create",
    ),
  );
  assert.ok(
    relayMcpToolsForProfile("execute").some(({ operationId }) => operationId === "job.start"),
  );
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
  }
});
