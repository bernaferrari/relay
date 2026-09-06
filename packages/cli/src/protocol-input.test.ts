import assert from "node:assert/strict";
import test from "node:test";
import { protocolOperationInput } from "./protocol-input.js";

test("strips CLI-only keys that are absent from the protocol schema", () => {
  assert.deepEqual(
    protocolOperationInput("app-map.get", {
      appMapId: "checkout",
      connectionId: "continue",
      list: "variables",
    }),
    { appMapId: "checkout", list: "variables" },
  );
  assert.deepEqual(
    protocolOperationInput("target.scroll-survey.capture", {
      serial: "pixel-9",
      maxScrolls: 6,
      dir: "/tmp/frames",
      force: true,
      restore: false,
    }),
    { serial: "pixel-9", maxScrolls: 6, dir: "/tmp/frames", force: true, restore: false },
  );
});

test("keeps protocol keys and catchall extras", () => {
  const update = {
    appMapId: "checkout",
    connectionId: "continue",
    expectedRevision: 4,
    patch: { label: "Continue" },
  };
  assert.equal(protocolOperationInput("app-map.connection.update", update), update);
  const matrix = { action: "run", matrixId: "compat", extra: true };
  assert.equal(protocolOperationInput("job.matrix.start", matrix), matrix);
});
