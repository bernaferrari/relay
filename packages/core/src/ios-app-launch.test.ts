import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  IOS_COREDEVICE_PROBE_TIMEOUT_MS,
  iosVisualVerificationDiagnostic,
  launchIosAppOutsideXctest,
  launchIosAppViaDevicectl,
  probeIosCoreDevice,
  resolveIosLaunchBundleId,
  type CommandResult,
  type CommandRunner,
  verifyIosScreenChanged,
} from "./ios-app-launch.js";
import { readAuthoringEvidence } from "./authoring-evidence.js";

function runner(
  script: (file: string, args: readonly string[]) => CommandResult | Error,
): CommandRunner {
  return async (file, args) => {
    const result = script(file, args);
    if (result instanceof Error) throw result;
    return result;
  };
}

function screenshotRunner(images: Uint8Array[], failAt?: number): CommandRunner {
  let captures = 0;
  return async (_file, args) => {
    const output = args.find((arg) => arg.startsWith("--output="))?.slice("--output=".length);
    if (!output) return { exitCode: 1, stdout: "", stderr: "missing screenshot output" };
    const index = captures++;
    if (index === failAt) return { exitCode: 1, stdout: "", stderr: "capture failed" };
    await writeFile(output, images[index] ?? images.at(-1) ?? new Uint8Array());
    return { exitCode: 0, stdout: "captured", stderr: "" };
  };
}

async function relayTapFiles(directory: string): Promise<string[]> {
  return (await readdir(directory)).filter((name) => name.startsWith("relay-tap-"));
}

async function withEvidenceState<T>(run: (stateDirectory: string) => Promise<T>): Promise<T> {
  const stateDirectory = await mkdtemp(join(tmpdir(), "relay-ios-visual-evidence-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = stateDirectory;
  try {
    return await run(stateDirectory);
  } finally {
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(stateDirectory, { recursive: true, force: true });
  }
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
    bin: "ios",
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

test("ordinary iOS visual verification removes both temporary rasters after a changed screen", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-ios-tap-cleanup-"));
  try {
    let actions = 0;
    const result = await verifyIosScreenChanged(
      "udid-1",
      async () => {
        actions += 1;
      },
      {
        bin: "ios",
        run: screenshotRunner([Buffer.from("before"), Buffer.from("after")]),
        settleMs: 0,
        temporaryDirectory: directory,
      },
    );
    assert.equal(actions, 1, "visual proof never retries the requested action");
    assert.equal(result.outcome, "changed");
    assert.deepEqual(await relayTapFiles(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("unchanged iOS verification promotes an immutable repair package and removes temporary rasters", async () => {
  await withEvidenceState(async () => {
    const directory = await mkdtemp(join(tmpdir(), "relay-ios-tap-unchanged-"));
    try {
      let failure: unknown;
      await assert.rejects(
        verifyIosScreenChanged("udid-1", async () => undefined, {
          bin: "ios",
          run: screenshotRunner([Buffer.from("same"), Buffer.from("same")]),
          settleMs: 0,
          temporaryDirectory: directory,
          repair: {
            interaction: {
              id: "interact-settings",
              label: "Label “Settings”",
              input: { kind: "label", label: "Settings" },
            },
          },
        }),
        (error) => {
          failure = error;
          return true;
        },
      );
      const diagnostic = iosVisualVerificationDiagnostic(failure);
      assert.equal(diagnostic?.outcome, "unchanged");
      assert.equal(diagnostic?.failure?.stage, "fingerprint");
      const repair = diagnostic?.repair;
      assert.ok(repair, "failure carries a durable repair package");
      assert.equal(repair.interaction.id, "interact-settings");
      assert.deepEqual(repair.interaction.input, { kind: "label", label: "Settings" });
      assert.ok(repair.timing.beforeCapturedAt);
      assert.ok(repair.timing.actionStartedAt);
      assert.ok(repair.timing.afterCapturedAt);
      assert.deepEqual(
        diagnostic?.timing,
        repair.timing,
        "the live diagnostic and durable manifest describe the same proof interval",
      );
      assert.equal(
        (await readAuthoringEvidence(repair.before?.evidence?.sha256 ?? ""))?.toString(),
        "same",
      );
      assert.equal(
        (await readAuthoringEvidence(repair.after?.evidence?.sha256 ?? ""))?.toString(),
        "same",
      );
      const manifest = JSON.parse(
        (
          await readFile(
            join(process.env.RELAY_STATE_DIR!, "authoring-evidence", repair.manifest.sha256!),
          )
        ).toString(),
      ) as Record<string, unknown>;
      assert.deepEqual(manifest.interaction, repair.interaction);
      assert.deepEqual(manifest.timing, repair.timing);
      assert.deepEqual(await relayTapFiles(directory), []);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

test("iOS action failure stays the original error while its before and after pixels become repair evidence", async () => {
  await withEvidenceState(async () => {
    const directory = await mkdtemp(join(tmpdir(), "relay-ios-tap-action-failure-"));
    try {
      const actionError = new Error("XCTest press rejected the target");
      let actions = 0;
      let failure: unknown;
      await assert.rejects(
        verifyIosScreenChanged(
          "udid-1",
          async () => {
            actions += 1;
            throw actionError;
          },
          {
            bin: "ios",
            run: screenshotRunner([Buffer.from("before"), Buffer.from("after")]),
            settleMs: 0,
            temporaryDirectory: directory,
            repair: {
              interaction: {
                label: "Tap (320, 640)",
                input: { kind: "point", x: 320, y: 640 },
              },
            },
          },
        ),
        (error) => {
          failure = error;
          return error === actionError;
        },
      );
      assert.equal(actions, 1);
      const diagnostic = iosVisualVerificationDiagnostic(failure);
      assert.equal(diagnostic?.failure?.stage, "action");
      assert.equal(diagnostic?.failure?.message, actionError.message);
      assert.ok(diagnostic?.repair?.before?.evidence);
      assert.ok(diagnostic?.repair?.after?.evidence);
      assert.deepEqual(await relayTapFiles(directory), []);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

test("failed initial iOS capture never dispatches the action and still cleans its temporary paths", async () => {
  await withEvidenceState(async () => {
    const directory = await mkdtemp(join(tmpdir(), "relay-ios-tap-capture-failure-"));
    try {
      let actions = 0;
      let failure: unknown;
      await assert.rejects(
        verifyIosScreenChanged(
          "udid-1",
          async () => {
            actions += 1;
          },
          {
            bin: "ios",
            run: screenshotRunner([], 0),
            settleMs: 0,
            temporaryDirectory: directory,
            repair: {
              interaction: {
                label: "Label “Privacy”",
                input: { kind: "label", label: "Privacy" },
              },
            },
          },
        ),
        (error) => {
          failure = error;
          return true;
        },
      );
      assert.equal(actions, 0, "an unproven baseline must not mutate the device");
      const diagnostic = iosVisualVerificationDiagnostic(failure);
      assert.equal(diagnostic?.failure?.stage, "before-capture");
      assert.ok(diagnostic?.repair?.manifest, "the failed capture still has repair provenance");
      assert.equal(diagnostic?.repair?.before, undefined);
      assert.equal(diagnostic?.repair?.after, undefined);
      assert.deepEqual(await relayTapFiles(directory), []);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

test("iOS temporary cleanup failures remain diagnostic and never replace the primary capture error", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-ios-tap-cleanup-failure-"));
  try {
    let actions = 0;
    let failure: unknown;
    await assert.rejects(
      verifyIosScreenChanged(
        "udid-1",
        async () => {
          actions += 1;
        },
        {
          bin: "ios",
          temporaryDirectory: directory,
          settleMs: 0,
          run: async (_file, args) => {
            const output = args
              .find((arg) => arg.startsWith("--output="))
              ?.slice("--output=".length);
            if (!output) return { exitCode: 1, stdout: "", stderr: "missing output" };
            await mkdir(output);
            return { exitCode: 0, stdout: "captured", stderr: "" };
          },
        },
      ),
      (error) => {
        failure = error;
        return true;
      },
    );
    assert.equal(actions, 0);
    const diagnostic = iosVisualVerificationDiagnostic(failure);
    assert.equal(diagnostic?.failure?.stage, "before-capture");
    assert.ok(diagnostic?.cleanupErrors?.some((message) => /relay-tap-before/u.test(message)));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a reviewer can retain a changed iOS transition without keeping its temporary rasters", async () => {
  await withEvidenceState(async () => {
    const directory = await mkdtemp(join(tmpdir(), "relay-ios-tap-retain-"));
    try {
      const result = await verifyIosScreenChanged("udid-1", async () => undefined, {
        bin: "ios",
        run: screenshotRunner([Buffer.from("before"), Buffer.from("after")]),
        settleMs: 0,
        temporaryDirectory: directory,
        repair: {
          retain: "always",
          interaction: {
            label: "Identifier “settings”",
            input: { kind: "identifier", identifier: "settings" },
          },
        },
      });
      assert.equal(result.outcome, "changed");
      assert.ok(result.repair?.before?.evidence);
      assert.ok(result.repair?.after?.evidence);
      assert.equal(
        (await readAuthoringEvidence(result.repair?.manifest.sha256 ?? ""))?.byteLength,
        result.repair?.manifest.bytes,
      );
      assert.deepEqual(await relayTapFiles(directory), []);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
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
