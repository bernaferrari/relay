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
const verifyOnIos = (...args: Parameters<typeof openAppAndVerifyForeground>): Promise<void> =>
  runWithTargetContext({ kind: "device", platform: "ios", serial: "foreground-app-test" }, () =>
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

  it("continues on iOS when no tree can say which app owns the screen", async () => {
    // A live iPad answers a snapshot with labelled nodes and no bundle id, so
    // "unavailable" there is missing evidence rather than a failed launch.
    const logs: string[] = [];
    let launches = 0;
    await verifyOnIos(device, "ai.x.GrokApp", undefined, logs.push.bind(logs), {
      open: async () => {
        launches += 1;
      },
      observe: async () => ({ status: "unavailable" }),
    });

    assert.equal(launches, 2);
    assert.match(logs.at(-1)!, /cannot say which app owns the screen/);
  });

  it("still fails on iOS when another app owns the screen", async () => {
    await assert.rejects(
      verifyOnIos(device, "ai.x.GrokApp", undefined, () => {}, {
        open: async () => {},
        observe: async () => ({ status: "mismatch", app: "com.apple.Preferences" }),
      }),
      /expected ai\.x\.GrokApp in foreground after 2 attempts; observed com\.apple\.Preferences/,
    );
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

it("verifies a browser URL once and does not replay a redirected navigation", async () => {
  let launches = 0;
  const browser = {
    command: {
      appState: async () => ({
        platform: "android",
        package: "managed-browser",
        activity: "https://example.com/plans",
      }),
    },
  } as unknown as Device;
  await runWithTargetContext(
    { kind: "browser", platform: "browser", targetId: "web" },
    async () => {
      await openAppAndVerifyForeground(browser, "https://example.com/plans", undefined, () => {}, {
        open: async () => {
          launches++;
        },
      });
      assert.equal(launches, 1);
      await assert.rejects(
        openAppAndVerifyForeground(browser, "https://example.com/other", undefined, () => {}, {
          open: async () => {
            launches++;
          },
        }),
        /after 1 attempts/,
      );
      assert.equal(launches, 2);
    },
  );
});
