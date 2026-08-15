import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Device } from "./device.js";
import { openAppAndVerifyForeground, type ForegroundAppObservation } from "./recipe-runner-app.js";
import { runWithTargetContext } from "./target-context.js";

const device = {} as Device;
const verify = (...args: Parameters<typeof openAppAndVerifyForeground>): Promise<void> =>
  runWithTargetContext({ kind: "device", platform: "android", serial: "foreground-app-test" }, () =>
    openAppAndVerifyForeground(...args),
  );

describe("openAppAndVerifyForeground", () => {
  it("continues after the requested app is verified", async () => {
    let launches = 0;
    await verify(device, "com.example.app", { relaunch: false }, () => {}, {
      open: async (_device, app, options) => {
        launches += 1;
        assert.equal(app, "com.example.app");
        assert.deepEqual(options, { relaunch: false });
      },
      observe: async () => ({ status: "matched", app: "com.example.app" }),
    });
    assert.equal(launches, 1);
  });

  it("retries a launch intercepted by an unrelated foreground app", async () => {
    const observations: ForegroundAppObservation[] = [
      { status: "mismatch", app: "com.example.unrelated" },
      { status: "matched", app: "com.example.app" },
    ];
    const logs: string[] = [];
    let launches = 0;
    await verify(device, "com.example.app", undefined, logs.push.bind(logs), {
      open: async () => {
        launches += 1;
      },
      observe: async () => observations.shift()!,
    });

    assert.equal(launches, 2);
    assert.match(logs[0]!, /com\.example\.unrelated.*retrying launch/);
    assert.match(logs[1]!, /foreground verified after retry/);
  });

  it("fails closed after two unavailable foreground observations", async () => {
    let launches = 0;
    await assert.rejects(
      verify(device, "com.example.app", undefined, () => {}, {
        open: async () => {
          launches += 1;
        },
        observe: async () => ({ status: "unavailable" }),
      }),
      /expected com\.example\.app in foreground after 2 attempts; observed unavailable/,
    );
    assert.equal(launches, 2);
  });

  it("reports the final unrelated foreground app", async () => {
    const observed = ["com.example.first", "com.example.second"];
    await assert.rejects(
      verify(device, "com.example.app", undefined, () => {}, {
        open: async () => {},
        observe: async () => ({ status: "mismatch", app: observed.shift()! }),
      }),
      /expected com\.example\.app in foreground after 2 attempts; observed com\.example\.second/,
    );
  });
});
