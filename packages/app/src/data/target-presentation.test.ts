import type { AuthoringTarget, DeviceSummary, TargetDefinition } from "@relay/protocol";
import { describe, expect, it } from "vitest";
import { presentReadyTargets } from "./target-presentation";

const targets: AuthoringTarget[] = [
  { kind: "browser", platform: "browser", targetId: "browser-one" },
  { kind: "browser", platform: "browser", targetId: "browser-two" },
  { kind: "device", platform: "android", targetId: "emulator-5554" },
];

describe("target presentation", () => {
  it("keeps browser presentation independent of hardware inventory", async () => {
    const calls: { id: string; input: unknown }[] = [];
    await presentReadyTargets(
      {
        async invoke(id, input) {
          calls.push({ id, input });
          return { devices: [], targets: [] };
        },
      },
      [targets[0]!],
    );
    expect(calls).toEqual([
      { id: "target.devices.list", input: { targetKind: "browser", targetId: "browser-one" } },
      { id: "target.list", input: {} },
    ]);
  });

  it("keeps the same browser name when review presents only one of several destinations", async () => {
    const browsers: TargetDefinition[] = ["browser-one", "browser-two"].map((id, index) => ({
      id,
      name: "127.0.0.1",
      kind: "browser",
      createdAt: index,
      updatedAt: index,
      browser: { startUrl: "http://127.0.0.1:8793/" },
    }));
    const options = await presentReadyTargets(client([], browsers), [targets[1]!]);
    expect(options).toEqual([
      { ...targets[1], name: "127.0.0.1:8793 · Browser 2", detail: "Managed browser" },
    ]);
  });

  it("joins human catalog names onto only the canonical ready targets", async () => {
    const devices: DeviceSummary[] = [
      device("browser-one", "Checkout browser", "browser"),
      device("browser-two", "Support browser", "browser"),
      device("emulator-5554", "Pixel 9 Pro", "android", "15"),
      device("not-ready", "Do not show me", "android"),
    ];
    const options = await presentReadyTargets(client(devices), targets);

    expect(options.map(({ name }) => name)).toEqual([
      "Checkout browser",
      "Support browser",
      "Pixel 9 Pro",
    ]);
    expect(options[2]?.detail).toBe("Android 15 · Emulator");
    expect(options[0]?.detail).toBe("Managed browser");
    expect(options.some(({ targetId }) => targetId === "not-ready")).toBe(false);
  });

  it("never exposes machine identifiers and disambiguates missing names", async () => {
    const devices: DeviceSummary[] = [
      device("browser-one", "browser-one", "browser"),
      device("browser-two", "browser-two", "browser"),
      device("emulator-5554", "emulator-5554", "android"),
    ];
    const options = await presentReadyTargets(client(devices), targets);

    expect(options.map(({ name }) => name)).toEqual([
      "Managed browser 1",
      "Managed browser 2",
      "Android emulator",
    ]);
    expect(options.map(({ name }) => name).join("")).not.toMatch(/browser-one|emulator-5554/u);
  });
});

function client(devices: DeviceSummary[], catalog: TargetDefinition[] = []) {
  return {
    async invoke() {
      return { devices, targets: catalog };
    },
  };
}

function device(
  id: string,
  name: string,
  platform: DeviceSummary["platform"],
  osVersion?: string,
): DeviceSummary {
  return {
    id,
    serial: id,
    name,
    kind: platform === "browser" ? "Managed browser" : "Emulator",
    booted: true,
    platform,
    ...(osVersion ? { osVersion } : {}),
  };
}
