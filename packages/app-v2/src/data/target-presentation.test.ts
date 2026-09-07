import type { AuthoringTarget, DeviceSummary } from "@relay/protocol";
import { describe, expect, it } from "vitest";
import { presentReadyTargets } from "./target-presentation";

const targets: AuthoringTarget[] = [
  { kind: "browser", platform: "browser", targetId: "browser-one" },
  { kind: "browser", platform: "browser", targetId: "browser-two" },
  { kind: "device", platform: "android", targetId: "emulator-5554" },
];

describe("target presentation", () => {
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
    expect(options[2]?.detail).toBe("Android emulator · Android 15 · Ready");
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
    expect(options.map(({ name }) => name).join(" ")).not.toMatch(/browser-one|emulator-5554/u);
  });
});

function client(devices: DeviceSummary[]) {
  return {
    async invoke() {
      return { devices };
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
