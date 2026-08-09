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
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    calls.push(`${init?.method ?? "GET"} ${path}`);
    if (path === "/devices") return { devices: [{ serial: "pixel-1" }] } as T;
    if (path === "/devices?phase=android") {
      return { devices: [{ serial: "pixel-fast" }] } as T;
    }
    if (path === "/targets") return { targets: [] } as T;
    if (path.endsWith("/open")) {
      return { session: { targetId: "browser", name: "Web", url: "https://example.test" } } as T;
    }
    return { preflight: { id: "browser", ok: true, checks: [] } } as T;
  };
  assert.equal((await listDevices(request))[0]?.serial, "pixel-1");
  assert.equal((await listAndroidDevicesFast(request))[0]?.serial, "pixel-fast");
  await listTargets(request);
  await authorizeDevice(request, "pixel-1");
  await preflightTarget(request, "browser");
  await openBrowserTarget(request, "browser");
  assert.deepEqual(calls, [
    "GET /devices",
    "GET /devices?phase=android",
    "GET /targets",
    "POST /device/authorize",
    "POST /targets/browser/preflight",
    "POST /targets/browser/open",
  ]);
});
