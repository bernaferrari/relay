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
    operatorBuild: {
      status: "needs-attention",
      detail:
        "A Developer ID Application identity is required to ship a signed operator build. Apple Development is not enough. Morning review stays on the Vite UI and local server until that identity exists.",
    },
    labServer: {
      status: "needs-attention",
      loaded: false,
      detail:
        "Lab Mac launchd stays unloaded. Job dev.relay.lab-server is not loaded. Morning review stays on this Vite UI plus pnpm ensure:serve. Do not load that job while a Plan is live — it would restart :8787.",
    },
    judgeProvider: {
      status: "needs-attention",
      configured: false,
      detail:
        "Add an OpenRouter key (OPENROUTER_API_KEY) so Relay can judge screenshots and on-screen text. Until then, those checks say they couldn’t run — they never pass silently.",
    },
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
