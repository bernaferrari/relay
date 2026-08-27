import assert from "node:assert/strict";
import test from "node:test";
import { createRelayOutcomeJobs } from "./index.js";
import { createScriptedRelayClient } from "./testing.js";

const pixel = {
  id: "pixel-9",
  serial: "pixel-9",
  name: "Pixel 9",
  kind: "emulator",
  booted: true,
  platform: "android",
  createdAt: 1,
  updatedAt: 1,
};

test("connect selects the sole ready device without exposing leases or profiles", async () => {
  const scripted = createScriptedRelayClient([
    { id: "target.devices.list", output: { devices: [pixel] } },
  ]);
  const jobs = createRelayOutcomeJobs(scripted.client, { actorId: "agent:test" });

  assert.deepEqual(await jobs.connect(), {
    targets: [{ kind: "device", platform: "android", targetId: "pixel-9" }],
    current: { kind: "device", platform: "android", targetId: "pixel-9" },
  });
  assert.deepEqual(scripted.invocations, [{ id: "target.devices.list", input: {} }]);
});

test("connect leaves multiple devices explicit instead of guessing", async () => {
  const scripted = createScriptedRelayClient([
    {
      id: "target.devices.list",
      output: {
        devices: [pixel, { ...pixel, id: "ipad", serial: "ipad", platform: "ios" }],
      },
    },
  ]);
  const jobs = createRelayOutcomeJobs(scripted.client, { actorId: "agent:test" });

  const result = await jobs.connect();
  assert.equal(result.current, undefined);
  assert.equal(result.targets.length, 2);
});
