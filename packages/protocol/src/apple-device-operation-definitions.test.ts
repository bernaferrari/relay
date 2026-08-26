import assert from "node:assert/strict";
import test from "node:test";
import { operationDefinition } from "./operations.js";

test("Apple live-preview settings have exact input, output, and transport contracts", () => {
  const definition = operationDefinition("workspace.apple-live-preview.update");

  assert.deepEqual(definition.transport, {
    method: "PUT",
    path: "/settings/devices/apple/live-preview",
  });
  assert.deepEqual(definition.input.parse({ backend: "agent-device-png" }), {
    backend: "agent-device-png",
  });
  assert.throws(() => definition.input.parse({ backend: "legacy" }));
  assert.deepEqual(
    definition.output.parse({
      setup: {
        version: 1,
        iosLivePreview: { backend: "agent-device-png" },
      },
    }),
    {
      setup: {
        version: 1,
        iosLivePreview: { backend: "agent-device-png" },
      },
    },
  );
});
