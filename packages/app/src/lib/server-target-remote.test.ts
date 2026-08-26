import assert from "node:assert/strict";
import test from "node:test";
import {
  authorizeDevice,
  listAndroidDevicesFast,
  listDevices,
  listTargets,
  openBrowserTarget,
  preflightTarget,
} from "./server-target-remote";

test("keeps target operations behind typed endpoints", async () => {
  const calls: string[] = [];
  const client = {
    invoke: async <T>(id: string, input: Record<string, unknown>): Promise<T> => {
      calls.push(`${id} ${JSON.stringify(input)}`);
      if (id === "target.devices.list") {
        return {
          devices: [
            {
              id: input.phase === "android" ? "pixel-fast" : "pixel-1",
              serial: input.phase === "android" ? "pixel-fast" : "pixel-1",
              name: "Pixel",
              kind: "Physical device",
              booted: true,
              platform: "android",
            },
          ],
        } as T;
      }
      if (id === "target.list") return { targets: [] } as T;
      if (id === "target.open") {
        return { session: { targetId: "browser", name: "Web", url: "https://example.test" } } as T;
      }
      return { preflight: { id: "browser", ok: true, checks: [] } } as T;
    },
  };
  assert.equal((await listDevices(client as never))[0]?.serial, "pixel-1");
  assert.equal((await listAndroidDevicesFast(client as never))[0]?.serial, "pixel-fast");
  await listTargets(client as never);
  await authorizeDevice(client as never, { serial: "pixel-1" });
  await preflightTarget(client as never, "browser");
  await openBrowserTarget(client as never, "browser");
  assert.deepEqual(calls, [
    "target.devices.list {}",
    'target.devices.list {"phase":"android"}',
    "target.list {}",
    'target.authorize {"serial":"pixel-1"}',
    'target.preflight {"targetId":"browser"}',
    'target.open {"targetId":"browser"}',
  ]);
});
