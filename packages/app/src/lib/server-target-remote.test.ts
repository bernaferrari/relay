import assert from "node:assert/strict";
import test from "node:test";
import { listDevices, listTargets, preflightTarget, selectDevice } from "./server-target-remote";

test("keeps target operations behind typed endpoints", async () => {
  const calls: string[] = [];
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    calls.push(`${init?.method ?? "GET"} ${path}`);
    if (path === "/devices") return { devices: [{ serial: "pixel-1" }] } as T;
    if (path === "/targets") return { targets: [] } as T;
    return { preflight: { id: "browser", ok: true, checks: [] } } as T;
  };
  assert.equal((await listDevices(request))[0]?.serial, "pixel-1");
  await listTargets(request);
  await selectDevice(request, "pixel-1");
  await preflightTarget(request, "browser");
  assert.deepEqual(calls, [
    "GET /devices",
    "GET /targets",
    "POST /device/select",
    "POST /targets/browser/preflight",
  ]);
});
