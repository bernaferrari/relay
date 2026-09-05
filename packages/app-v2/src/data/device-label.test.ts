import { describe, expect, it } from "vitest";
import { devicePlatformLabel, deviceSummaryLine } from "./device-label";

describe("device labels", () => {
  it("says Android 16 instead of a bare 16", () => {
    expect(devicePlatformLabel({ platform: "android", osVersion: "16" })).toBe("Android 16");
    expect(deviceSummaryLine({ platform: "android", osVersion: "16", kind: "emulator" })).toBe(
      "Android 16 · emulator",
    );
  });

  it("says iOS 18.5 and does not double the platform name", () => {
    expect(devicePlatformLabel({ platform: "ios", osVersion: "18.5" })).toBe("iOS 18.5");
    expect(devicePlatformLabel({ platform: "android", osVersion: "Android 16" })).toBe(
      "Android 16",
    );
    expect(devicePlatformLabel({ platform: "ios" })).toBe("Apple device");
    expect(devicePlatformLabel({ platform: "browser", osVersion: "Chromium" })).toBe(
      "Managed browser",
    );
  });
});
