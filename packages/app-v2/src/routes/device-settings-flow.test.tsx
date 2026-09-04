/** @jsxImportSource react */
import type { EvidenceCollectionPolicy, RedactionPolicy } from "@relay/protocol";
import { createMemoryHistory } from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { RelayV2App } from "../app";
import type { DeviceProductService, ProductDevice } from "../data/device-product-service";
import type { RecordingProductService } from "../data/recording-product-service";
import type { SettingsProductService } from "../data/settings-product-service";
import type { Platform } from "../platform/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
  delete document.documentElement.dataset.colorScheme;
  delete document.documentElement.dataset.colorSchemePreference;
});

function productDevice(
  id: string,
  name: string,
  status: ProductDevice["status"],
  platform: ProductDevice["platform"],
  recovery?: string,
): ProductDevice {
  return {
    id,
    name,
    serial: id,
    status,
    platform,
    kind: platform === "browser" ? "Managed browser" : "Physical device",
    runnable: status === "ready",
    ...(recovery ? { recovery } : {}),
    device: {
      id,
      serial: id,
      name,
      platform,
      kind: platform === "browser" ? "Managed browser" : "Physical device",
      booted: true,
    },
  };
}

function fakeDeviceService(): DeviceProductService & { recoveryCalls: string[] } {
  const devices = [
    productDevice("ipad", "Design iPad", "ready", "ios"),
    productDevice(
      "phone",
      "QA phone",
      "needs-attention",
      "android",
      "Wake or reconnect the device, then check again.",
    ),
    productDevice("browser", "Checkout browser", "virtual", "browser"),
  ];
  const recoveryCalls: string[] = [];
  return {
    recoveryCalls,
    async list() {
      return devices;
    },
    async get(deviceId) {
      return devices.find((device) => device.id === deviceId);
    },
    async actions() {
      return [];
    },
    async recover(serial) {
      recoveryCalls.push(serial);
      return {
        serial,
        recovered: true,
        ready: true,
        summary: "Relay reconnected and checked this device.",
        actions: [],
        session: { status: "ready", detail: "Ready" },
      };
    },
  };
}

function fakeSettingsService(): SettingsProductService & {
  privacyCalls: boolean[];
  evidenceCalls: Array<{ channel: string; enabled: boolean }>;
} {
  let privacy: RedactionPolicy = { enabled: true, source: "workspace", locked: false };
  let evidence: EvidenceCollectionPolicy = { schemaVersion: 1, sensitive: {} };
  const privacyCalls: boolean[] = [];
  const evidenceCalls: Array<{ channel: string; enabled: boolean }> = [];
  return {
    privacyCalls,
    evidenceCalls,
    async privacy() {
      return privacy;
    },
    async setPrivacy(enabled) {
      privacyCalls.push(enabled);
      privacy = { ...privacy, enabled };
      return privacy;
    },
    async evidence() {
      return evidence;
    },
    async setEvidence(input) {
      evidenceCalls.push(input);
      evidence = {
        ...evidence,
        sensitive: {
          ...evidence.sensitive,
          ...(input.enabled
            ? {
                [input.channel]: {
                  grantedAt: 1,
                  grantedBy: "human:test",
                  reason: input.reason ?? "Test",
                },
              }
            : { [input.channel]: undefined }),
        },
      };
      return evidence;
    },
    async appleSetup() {
      return {
        checks: [{ id: "relay", label: "Relay runner", status: "ready", detail: "Ready" }],
      };
    },
    async androidSetup() {
      return {
        checks: [
          {
            id: "adb",
            label: "Android Platform Tools",
            status: "needs-attention",
            detail: "Install Platform Tools, then reopen Relay.",
          },
        ],
      };
    },
  };
}

function testPlatform(
  initial: Record<string, string> = {},
): Platform & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial));
  return {
    values,
    platform: "web",
    getServerUrl: () => "http://127.0.0.1:8787",
    getServerConnection: () => ({
      url: "http://127.0.0.1:8787",
      auth: { type: "none" },
      organizationId: "local",
      projectId: "default",
      actorId: "human:test",
      actorKind: "human",
    }),
    setServerUrl: (url) => void values.set("serverUrl", url),
    storage: {
      get: (key) => values.get(key) ?? null,
      set: (key, value) => void values.set(key, value),
      remove: (key) => void values.delete(key),
    },
  };
}

async function renderPath(
  path: string,
  options: {
    deviceService?: DeviceProductService;
    settingsService?: SettingsProductService;
    platform?: Platform;
  } = {},
) {
  const history = createMemoryHistory({ initialEntries: [path] });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <RelayV2App
        platform={options.platform ?? testPlatform()}
        history={history}
        productService={{} as RecordingProductService}
        deviceService={options.deviceService ?? fakeDeviceService()}
        settingsService={options.settingsService ?? fakeSettingsService()}
      />,
    );
  });
  await settle();
  return history;
}

async function settle() {
  for (let index = 0; index < 5; index++) {
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
  }
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
  await settle();
}

function button(label: string): HTMLButtonElement {
  const result = [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!(result instanceof HTMLButtonElement)) throw new Error(`Button not found: ${label}`);
  return result;
}

function input(label: string): HTMLInputElement {
  const element =
    document.querySelector(`[aria-label="${label}"]`) ??
    [...document.querySelectorAll("label")]
      .find((item) => item.textContent?.includes(label))
      ?.querySelector("input");
  if (!(element instanceof HTMLInputElement)) throw new Error(`Input not found: ${label}`);
  return element;
}

describe("Devices", () => {
  it("presents each device as one compact, cohesive navigation target", async () => {
    const history = await renderPath("/devices");

    const row = document.querySelector<HTMLAnchorElement>(
      'a.relay-device-row[href="/devices/ipad"]',
    );
    expect(row).not.toBeNull();
    expect(row?.querySelector(".relay-device-icon-tile")).not.toBeNull();
    expect(row?.querySelector(".relay-device-copy")?.textContent).toContain("Design iPad");
    expect(row?.querySelector(".relay-device-metadata")?.textContent).toBe(
      "Apple device · Physical device",
    );
    expect(row?.querySelector(".relay-device-status")?.textContent).toContain("Ready");
    expect(row?.querySelector(".relay-device-row-chevron")).not.toBeNull();

    await click(row!);
    expect(history.location.pathname).toBe("/devices/ipad");
  });

  it("centers a clear recovery state when the local service cannot check devices", async () => {
    const service: DeviceProductService = {
      ...fakeDeviceService(),
      async list() {
        throw new TypeError("Failed to fetch");
      },
    };
    await renderPath("/devices", { deviceService: service });
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 1_100))));
    await settle();

    const recovery = document.querySelector(".relay-devices-recovery");
    expect(recovery?.className).toContain("relay-recovery-state--centered");
    expect(recovery?.getAttribute("role")).toBe("alert");
    expect(recovery?.textContent).toContain("Relay could not check devices");
    expect(recovery?.textContent).toContain("saved Tests and device settings are safe");
    expect(button("Check connection")).not.toBeNull();
    expect(
      [...document.querySelectorAll("button")].some(
        (candidate) => candidate.textContent?.trim() === "Check again",
      ),
    ).toBe(false);
  });

  it("restores status from the URL without exposing a manual density control", async () => {
    const history = await renderPath("/devices?status=needs-attention");

    expect(document.body.textContent).toContain("QA phone");
    expect(document.body.textContent).not.toContain("Design iPad");
    expect(document.body.textContent).not.toContain("Checkout browser");
    expect(button("Needs attention").getAttribute("aria-pressed")).toBe("true");
    expect(document.body.textContent).not.toContain("Comfortable");
    expect(document.body.textContent).not.toContain("Compact");
    expect(document.body.textContent).not.toMatch(/\b(?:lease|profile|inventory)\b/i);
    expect(document.querySelectorAll('a[href^="/devices/phone"]')).toHaveLength(1);

    await click(button("All"));
    expect(history.location.search).toBe("");
    expect(document.body.textContent).toContain("Design iPad");
    const virtualDevices = document.querySelector<HTMLButtonElement>(
      ".relay-device-section--collapsible > button",
    );
    if (!virtualDevices) throw new Error("Virtual devices disclosure not found");
    await click(virtualDevices);
    expect(document.body.textContent).toContain("Checkout browser");
    expect(
      document
        .querySelector(".relay-device-section--collapsible > button")
        ?.getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("gives a device needing attention one dominant recovery action", async () => {
    const service = fakeDeviceService();
    await renderPath("/devices/phone", { deviceService: service });

    expect(document.querySelectorAll(".relay-button--primary")).toHaveLength(1);
    expect(document.body.textContent).toContain("One step before this device is ready");
    await click(button("Reconnect device"));
    expect(service.recoveryCalls).toEqual(["phone"]);
    expect(document.body.textContent).toContain("Device is ready");
    expect(document.body.textContent).toContain("Relay reconnected and checked this device.");
  });
});

describe("Settings", () => {
  it("keeps stable route navigation and saves evidence choices through the product service", async () => {
    const service = fakeSettingsService();
    const history = await renderPath("/settings/evidence?section=sensitive", {
      settingsService: service,
    });

    expect(document.querySelectorAll(".relay-settings-nav-link")).toHaveLength(6);
    expect(document.body.textContent).toContain("Evidence & privacy");
    expect(document.body.textContent).toContain("Request and response bodies");
    expect(document.body.textContent).toContain("Raw network captures");
    expect(document.body.textContent).toContain(
      "Android emulator packet metadata is captured temporarily either way.",
    );
    expect(document.querySelector(".relay-settings-save")).toBeNull();
    expect(document.body.textContent).not.toMatch(/\b(?:lease|runtime profile|inventory)\b/i);

    await click(input("Redact sensitive evidence"));
    expect(service.privacyCalls).toEqual([false]);
    expect(document.body.textContent).toContain("Raw values allowed");
    expect(document.body.textContent).toContain("Saved");

    await click(input("Crash details"));
    expect(service.evidenceCalls).toEqual([
      {
        channel: "crash",
        enabled: true,
        reason: "Enabled in Relay Evidence & privacy settings",
      },
    ]);

    const appearance = [...document.querySelectorAll("a")].find(
      (item) => item.textContent?.trim() === "Appearance",
    );
    if (!(appearance instanceof HTMLAnchorElement)) throw new Error("Appearance link not found");
    await click(appearance);
    expect(history.location.pathname).toBe("/settings/appearance");
    expect(history.location.search).toBe("?section=sensitive");
  });

  it("applies and persists appearance without waiting for a reload", async () => {
    const platform = testPlatform({ "appearance.colorScheme": "dark" });
    await renderPath("/settings/appearance", { platform });

    expect(document.documentElement.dataset.colorScheme).toBe("dark");
    expect(input("Light").checked).toBe(false);
    await click(input("Light"));
    expect(document.documentElement.dataset.colorScheme).toBe("light");
    expect(platform.values.get("appearance.colorScheme")).toBe("light");
    expect(document.body.textContent).toContain("Saved");
  });

  it("turns setup resources into concise human recovery in Advanced", async () => {
    await renderPath("/settings/advanced");

    expect(document.body.textContent).toContain("Apple devices");
    expect(document.body.textContent).toContain("Android devices");
    expect(document.body.textContent).toContain("Install Platform Tools, then reopen Relay.");
    expect(document.body.textContent).not.toContain("adb");
    expect(document.body.textContent).not.toContain("teamId");
  });

  it("keeps the Relay address shape stable after General cached the connection", async () => {
    const history = await renderPath("/settings/general");
    const advanced = [...document.querySelectorAll<HTMLAnchorElement>("a")].find(
      (item) => item.textContent?.trim() === "Advanced",
    );
    if (!advanced) throw new Error("Advanced settings link not found");
    await click(advanced);

    expect(history.location.pathname).toBe("/settings/advanced");
    expect(document.body.textContent).not.toContain("Something went wrong");
    expect(document.querySelector<HTMLInputElement>("#relay-server-url")?.value).toBe(
      "http://127.0.0.1:8787",
    );
    const controls = document.querySelector(".relay-settings-address-control");
    expect(controls?.querySelector("input")).not.toBeNull();
    expect(controls?.querySelector("button")?.textContent).toContain("Save address");
  });

  it("keeps partial support failure in the rows with one quiet retry", async () => {
    const service: SettingsProductService = {
      ...fakeSettingsService(),
      async androidSetup() {
        throw new TypeError("Failed to fetch");
      },
    };
    await renderPath("/settings/advanced", { settingsService: service });
    expect(document.body.textContent).not.toContain("Some device-support checks are unavailable");
    expect(document.querySelectorAll(".relay-settings-alert")).toHaveLength(0);
    expect(button("Check again")).not.toBeNull();
    expect(document.body.textContent).toContain("Android devices");
    expect(document.body.textContent).toContain("Needs attention");
  });

  it("keeps detailed support checks in a quiet keyboard-operable disclosure", async () => {
    const service: SettingsProductService = {
      ...fakeSettingsService(),
      async appleSetup() {
        return {
          checks: [
            { id: "xcode", label: "Xcode", status: "ready", detail: "Installed" },
            {
              id: "runner",
              label: "Relay runner",
              status: "needs-attention",
              detail: "Open Xcode once to finish setup.",
            },
          ],
        };
      },
    };
    await renderPath("/settings/advanced", { settingsService: service });

    const trigger = button("Diagnostic checks (2)");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    await click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.body.textContent).toContain("Open Xcode once to finish setup.");
  });
});
