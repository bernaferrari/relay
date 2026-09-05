import type { SettingsProductService } from "../data/settings-product-service";

export const fixtureSettingsService: SettingsProductService = {
  privacy: async () => ({ enabled: true, source: "workspace", locked: false }),
  setPrivacy: async (enabled) => ({ enabled, source: "workspace", locked: false }),
  evidence: async () => ({ schemaVersion: 1, sensitive: {} }),
  setEvidence: async () => ({ schemaVersion: 1, sensitive: {} }),
  appleSetup: async () => ({
    checks: [
      { id: "xcode", label: "Xcode", status: "ready", detail: "Xcode is installed." },
      {
        id: "runner",
        label: "Device runner",
        status: "needs-attention",
        detail: "Open Xcode to finish preparing the device runner.",
      },
    ],
  }),
  androidSetup: async () => ({
    checks: [
      {
        id: "adb",
        label: "Android Platform Tools",
        status: "ready",
        detail: "Platform Tools are ready.",
      },
    ],
  }),
};
