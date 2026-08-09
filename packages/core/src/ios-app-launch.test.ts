import assert from "node:assert/strict";
import test from "node:test";
import {
  IOS_COREDEVICE_PROBE_TIMEOUT_MS,
  launchIosAppOutsideXctest,
  launchIosAppViaDevicectl,
  probeIosCoreDevice,
  resolveIosLaunchBundleId,
  type CommandResult,
  type CommandRunner,
} from "./ios-app-launch.js";

function runner(
  script: (file: string, args: readonly string[]) => CommandResult | Error,
): CommandRunner {
  return async (file, args) => {
    const result = script(file, args);
    if (result instanceof Error) throw result;
    return result;
  };
}

test("friendly iOS names become bundle ids", () => {
  assert.equal(resolveIosLaunchBundleId("Grok"), "ai.x.GrokApp");
  assert.equal(resolveIosLaunchBundleId("Settings"), "com.apple.Preferences");
  assert.equal(resolveIosLaunchBundleId("com.apple.Preferences"), "com.apple.Preferences");
  assert.throws(() => resolveIosLaunchBundleId("Notepad"), /bundle id/i);
});

test("devicectl launch is a short xcrun process launch, not XCTest", async () => {
  const calls: string[][] = [];
  const launched = await launchIosAppViaDevicectl("udid-1", "Settings", {
    run: runner((file, args) => {
      calls.push([file, ...args]);
      return { exitCode: 0, stdout: "ok", stderr: "" };
    }),
  });
  assert.equal(launched.method, "devicectl");
  assert.equal(launched.bundleId, "com.apple.Preferences");
  assert.deepEqual(calls[0]?.slice(0, 6), [
    "xcrun",
    "devicectl",
    "device",
    "process",
    "launch",
    "--device",
  ]);
  assert.ok(calls[0]?.includes("com.apple.Preferences"));
  assert.ok(calls[0]?.includes("--terminate-existing"));
});

test("when devicectl times out, launch falls through to go-ios", async () => {
  const launched = await launchIosAppOutsideXctest("udid-1", "Grok", {
    run: runner((file, args) => {
      if (file === "xcrun") throw new Error("xcrun timed out after 10000ms");
      if (args[0] === "tunnel") return { exitCode: 0, stdout: '{"udid":"udid-1"}', stderr: "" };
      if (args[0] === "launch") return { exitCode: 0, stdout: "launched", stderr: "" };
      return { exitCode: 1, stdout: "", stderr: "unexpected" };
    }),
  });
  assert.equal(launched.method, "go-ios");
  assert.equal(launched.bundleId, "ai.x.GrokApp");
});

test("DDI remount is go-ios image unmount then image auto", async () => {
  const { remountIosDeveloperDiskImage } = await import("./ios-app-launch.js");
  const calls: string[] = [];
  const ok = await remountIosDeveloperDiskImage("udid-1", {
    bin: "ios",
    run: async (_file, args) => {
      calls.push(args.join(" "));
      if (args[0] === "image" && args[1] === "unmount") {
        return { exitCode: 0, stdout: "", stderr: '{"msg":"success unmounting image"}' };
      }
      if (args[0] === "image" && args[1] === "auto") {
        return { exitCode: 0, stdout: "", stderr: '{"msg":"success mounting image"}' };
      }
      return { exitCode: 1, stdout: "", stderr: "unexpected" };
    },
  });
  assert.equal(ok, true);
  assert.ok(calls[0]?.includes("image unmount"));
  assert.ok(calls[1]?.includes("image auto"));
  assert.ok(!calls.some((call) => call.includes("xcrun") || call.includes("devicectl")));
});

test("go-ios commands pick up RELAY_GO_IOS_TUNNEL_INFO_PORT", async () => {
  const { resetGoIosTunnelInfoPortForTests, remountIosDeveloperDiskImage } =
    await import("./ios-app-launch.js");
  const previous = process.env.RELAY_GO_IOS_TUNNEL_INFO_PORT;
  process.env.RELAY_GO_IOS_TUNNEL_INFO_PORT = "60105";
  resetGoIosTunnelInfoPortForTests();
  try {
    const calls: string[] = [];
    await remountIosDeveloperDiskImage("udid-1", {
      bin: "ios",
      run: async (_file, args) => {
        calls.push(args.join(" "));
        return { exitCode: 0, stdout: "", stderr: '{"msg":"success mounting image"}' };
      },
    });
    assert.ok(calls.every((call) => call.includes("--tunnel-info-port 60105")));
  } finally {
    if (previous === undefined) delete process.env.RELAY_GO_IOS_TUNNEL_INFO_PORT;
    else process.env.RELAY_GO_IOS_TUNNEL_INFO_PORT = previous;
    resetGoIosTunnelInfoPortForTests();
  }
});

test("tunnel info port discovery prefers 28100 then 60105", async () => {
  const { rememberGoIosTunnelInfoPort, resetGoIosTunnelInfoPortForTests } =
    await import("./ios-app-launch.js");
  const previous = process.env.RELAY_GO_IOS_TUNNEL_INFO_PORT;
  delete process.env.RELAY_GO_IOS_TUNNEL_INFO_PORT;
  resetGoIosTunnelInfoPortForTests();
  try {
    const probed: string[] = [];
    const port = await rememberGoIosTunnelInfoPort({
      probe: async (candidate) => {
        probed.push(candidate);
        return candidate === "60105";
      },
    });
    assert.equal(port, "60105");
    assert.deepEqual(probed, ["28100", "60105"]);
  } finally {
    if (previous === undefined) delete process.env.RELAY_GO_IOS_TUNNEL_INFO_PORT;
    else process.env.RELAY_GO_IOS_TUNNEL_INFO_PORT = previous;
    resetGoIosTunnelInfoPortForTests();
  }
});

test("stale XCTest host processes are killed through go-ios, not xcrun", async () => {
  const { killStaleIosTestRunners } = await import("./ios-app-launch.js");
  const calls: string[] = [];
  const killed = await killStaleIosTestRunners("udid-1", {
    bin: "ios",
    run: async (_file, args) => {
      calls.push(args.join(" "));
      if (args.includes("AgentDeviceRunner")) {
        return {
          exitCode: 0,
          stdout: "",
          stderr: '{"msg":"killed","process":"AgentDeviceRunner"}',
        };
      }
      return { exitCode: 1, stdout: "", stderr: '{"msg":"process not found"}' };
    },
  });
  assert.deepEqual(killed, ["AgentDeviceRunner"]);
  assert.ok(calls.some((call) => call.includes("kill") && call.includes("AgentDeviceRunner")));
  assert.ok(calls.some((call) => call.includes("kill") && call.includes("testmanagerd")));
  assert.ok(!calls.some((call) => call.includes("xcrun") || call.includes("devicectl")));
});

test("pixel fingerprints change when the PNG bytes change", async () => {
  const { pixelEvidenceFingerprint } = await import("./ios-app-launch.js");
  const a = pixelEvidenceFingerprint(new Uint8Array([1, 2, 3, 4, 5]));
  const b = pixelEvidenceFingerprint(new Uint8Array([1, 2, 3, 4, 6]));
  assert.notEqual(a, b);
});

test("session prime fails fast instead of waiting on XCTest forever", async () => {
  const { primeIosAgentSession } = await import("./ios-app-launch.js");
  const started = Date.now();
  await assert.rejects(
    primeIosAgentSession(() => new Promise(() => undefined), 30),
    /session prime timed out/,
  );
  assert.ok(Date.now() - started < 500);
});

test("go-ios screenshot is a pixel capture without XCTest", async () => {
  const { captureIosPngViaGoIos } = await import("./ios-app-launch.js");
  let output = "";
  await captureIosPngViaGoIos("udid-1", "/tmp/shot.png", {
    bin: "ios",
    run: async (_file, args) => {
      output = args.join(" ");
      return { exitCode: 0, stdout: "ok", stderr: "" };
    },
  });
  assert.match(output, /screenshot/);
  assert.match(output, /--udid udid-1|--udid=udid-1/);
  assert.match(output, /\/tmp\/shot\.png/);
});

test("CoreDevice probe fails immediately when xcrun is stuck", async () => {
  await assert.rejects(
    probeIosCoreDevice("udid-1", {
      run: async () => {
        throw new Error(`xcrun timed out after ${IOS_COREDEVICE_PROBE_TIMEOUT_MS}ms`);
      },
    }),
    new RegExp(`timed out after ${IOS_COREDEVICE_PROBE_TIMEOUT_MS}ms`),
  );
});
