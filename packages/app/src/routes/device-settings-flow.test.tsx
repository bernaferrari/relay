/** @jsxImportSource react */
import type { EvidenceCollectionPolicy, RedactionPolicy } from "@relay/protocol";
import { createMemoryHistory } from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RelayApp } from "../app";
import type { BrowserSpacesProductService } from "../data/browser-spaces-product-service";
import type {
  DeviceProductService,
  ProductDevice,
  ProductLaunchedApp,
} from "../data/device-product-service";
import type { LiveTargetSession, LiveTargetSnapshot } from "../data/live-target-session";
import type { RecordingProductService } from "../data/recording-product-service";
import type { SettingsProductService } from "../data/settings-product-service";
import type { Platform } from "../platform/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline test fixture")));
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
  delete document.documentElement.dataset.colorScheme;
  delete document.documentElement.dataset.colorSchemePreference;
  vi.unstubAllGlobals();
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
    browserSpacesService?: BrowserSpacesProductService;
    deviceService?: DeviceProductService;
    productService?: RecordingProductService;
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
      <RelayApp
        platform={options.platform ?? testPlatform()}
        history={history}
        productService={options.productService ?? ({} as RecordingProductService)}
        browserSpacesService={options.browserSpacesService}
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

async function fillInput(element: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}

function button(label: string): HTMLButtonElement {
  const result = [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!(result instanceof HTMLButtonElement)) throw new Error(`Button not found: ${label}`);
  return result;
}

function input(label: string): HTMLElement {
  const element =
    document.querySelector(`[aria-label="${label}"]`) ??
    [...document.querySelectorAll("label")]
      .find((item) => item.textContent?.includes(label))
      ?.querySelector("input, [role=radio]");
  if (!(element instanceof HTMLElement)) throw new Error(`Input not found: ${label}`);
  return element;
}

function liveIpadPreview() {
  const target = { kind: "device", platform: "ios", targetId: "ipad" } as const;
  const previews: Array<{
    closed: boolean;
    publish?: (snapshot: LiveTargetSnapshot) => void;
  }> = [];
  const service = {
    connect: async () => ({ targets: [target] }),
    presentTargets: async () => [{ ...target, name: "Design iPad", detail: "Apple device" }],
    previewTarget: async (): Promise<LiveTargetSession> => {
      const preview: (typeof previews)[number] = { closed: false };
      const status = previews.length === 0 ? "streaming" : "connecting";
      previews.push(preview);
      return {
        snapshot: () => ({ target, status }),
        subscribe(listener) {
          preview.publish = listener;
          listener({ target, status });
          return () => {
            preview.publish = undefined;
          };
        },
        mount: () => () => undefined,
        input: async () => undefined,
        close: () => {
          preview.closed = true;
        },
      };
    },
  } as unknown as RecordingProductService;
  return {
    service,
    previews,
    ready: () => previews.at(-1)?.publish?.({ target, status: "streaming", frameSequence: 1 }),
  };
}

describe("Devices", () => {
  it("hands an acknowledged iOS launch to Test setup once and retains its replay origin without an inventory request or second launch", async () => {
    const service = fakeDeviceService();
    service.launchApp = vi.fn(async (serial: string, app: string): Promise<ProductLaunchedApp> => ({
      serial,
      app,
      platform: "ios",
      launchedAt: Date.now(),
      observed: { app: "Grok", matched: true },
    }));
    service.listInstalledApps = vi.fn(async () => {
      throw new Error("iOS inventory unsupported");
    });
    const preview = liveIpadPreview();
    preview.service.listApps = async () => [{ id: "grok-ios", name: "Grok iOS", platform: "ios" }];
    // End this route test at the canonical begin boundary, without simulating
    // native recording or treating the launch acknowledgement as foreground proof.
    preview.service.begin = vi.fn(async () => {
      throw new Error("Fixture reached begin");
    });
    await renderPath("/devices/ipad", { deviceService: service, productService: preview.service });
    await click(button("Open app"));
    await fillInput(document.querySelector<HTMLInputElement>("#device-app-identifier")!, "Grok");
    await click(button("Launch app"));
    await act(async () => preview.ready());
    const record = [...document.querySelectorAll<HTMLAnchorElement>("a")].find(
      (link) => link.textContent?.trim() === "Record a Test",
    )!;
    await click(record);
    expect(document.querySelector<HTMLInputElement>("#device-app-identifier")?.value).toBe("Grok");
    expect(button("Start recording").disabled).toBe(true);
    await act(async () => preview.ready());
    await settle();
    expect(button("Start recording").disabled).toBe(false);
    expect(service.listInstalledApps).not.toHaveBeenCalled();
    expect(service.launchApp).toHaveBeenCalledOnce();
    await click(button("Start recording"));
    expect(preview.service.begin).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        appMapId: "grok-ios",
        targetId: "ipad",
        targetKind: "device",
        originApplication: "Grok",
      }),
    );
  });

  it("keeps direct originApplication URLs unacknowledged on iOS without unsupported installed-app calls", async () => {
    const service = fakeDeviceService();
    service.listInstalledApps = vi.fn(async () => {
      throw new Error("iOS inventory unsupported");
    });
    const preview = liveIpadPreview();
    preview.service.listApps = async () => [{ id: "grok-ios", name: "Grok iOS", platform: "ios" }];
    await renderPath(
      "/tests/new?app=grok-ios&target=ipad&targetKind=device&originApplication=Grok",
      { deviceService: service, productService: preview.service },
    );
    expect(document.querySelector<HTMLInputElement>("#device-app-identifier")?.value).toBe("Grok");
    expect(button("Start recording").disabled).toBe(true);
    expect(document.body.textContent).toContain("Open the selected app first");
    expect(document.body.textContent).not.toContain("Installed apps could not be loaded");
    expect(service.listInstalledApps).not.toHaveBeenCalled();
  });

  it("reopens a browser without invoking phone recovery", async () => {
    const devices = fakeDeviceService();
    const opened: string[] = [];
    await renderPath("/devices/browser", {
      deviceService: devices,
      productService: {
        connect: async () => ({ targets: [] }),
        presentTargets: async () => [],
      } as unknown as RecordingProductService,
      browserSpacesService: {
        openSpace: async (id: string) => {
          opened.push(id);
          return { targetId: id, name: "Browser", url: "https://example.com" };
        },
      } as BrowserSpacesProductService,
    });
    expect(document.body.textContent).toContain("Live browser");
    await click(button("Reconnect"));
    expect(opened).toEqual(["browser"]);
    expect(devices.recoveryCalls).toEqual([]);
    expect(document.body.textContent).not.toContain("Device still needs attention");
  });

  it("opens a known browser without scanning unrelated devices", async () => {
    const selected = { kind: "browser", platform: "browser", targetId: "browser" } as const;
    let previews = 0;
    await renderPath("/devices/browser", {
      productService: {
        connect: async () => {
          throw new Error("Must not scan physical devices");
        },
        presentTargets: async () => {
          throw new Error("Must not rediscover known browser");
        },
        previewTarget: async (target: typeof selected): Promise<LiveTargetSession> => {
          expect(target.targetId).toBe("browser");
          previews++;
          return {
            snapshot: () => ({ status: "streaming", target: selected }),
            subscribe: (listener) => {
              listener({ status: "streaming", target: selected });
              return () => undefined;
            },
            mount: () => () => undefined,
            input: async () => undefined,
            close: () => undefined,
          };
        },
      } as unknown as RecordingProductService,
    });
    expect(previews).toBe(1);
    expect(document.body.textContent).not.toContain("Opening the live device");
  });

  it("rediscovers the live target when reconnecting an unavailable preview", async () => {
    let connections = 0;
    const productService = {
      connect: async () => {
        connections++;
        return { targets: [] };
      },
      presentTargets: async () => [],
    } as unknown as RecordingProductService;
    await renderPath("/devices/ipad", { productService });
    expect(connections).toBe(1);
    expect(document.body.textContent).toContain("Live view is not connected");
    await click(button("Reconnect"));
    expect(connections).toBe(2);
  });

  it.each(["empty", "failed"] as const)(
    "opens the live stream after reconnect recovers %s discovery",
    async (initialDiscovery) => {
      let connections = 0;
      let mounted = 0;
      let discoveryAvailable = false;
      const discovered = { kind: "device", platform: "ios", targetId: "ipad" } as const;
      const productService = {
        connect: async () => {
          connections += 1;
          if (!discoveryAvailable && initialDiscovery === "failed")
            throw new Error("Device discovery failed");
          return { targets: discoveryAvailable ? [discovered] : [] };
        },
        presentTargets: async (targets: readonly (typeof discovered)[]) =>
          targets.map((target) => ({
            ...target,
            name: "Design iPad",
            detail: "Apple device · Ready",
          })),
        previewTarget: async (): Promise<LiveTargetSession> => ({
          snapshot: () => ({ status: "streaming", target: discovered }),
          subscribe: (listener) => {
            listener({ status: "streaming", target: discovered });
            return () => undefined;
          },
          mount: () => {
            mounted += 1;
            return () => undefined;
          },
          input: async () => undefined,
          close: () => undefined,
        }),
      } as unknown as RecordingProductService;

      await renderPath("/devices/ipad", { productService });
      if (initialDiscovery === "failed") {
        await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 1_100))));
        await settle();
      }
      const initialConnections = connections;
      expect(initialConnections).toBeGreaterThanOrEqual(1);
      expect(mounted).toBe(0);
      expect(document.body.textContent).toContain("Live view is not connected");

      discoveryAvailable = true;
      await click(button("Reconnect"));

      expect(connections).toBe(initialConnections + 1);
      expect(mounted).toBe(1);
      expect(
        document.querySelector<HTMLCanvasElement>('[data-slot="capture-live-target"]')?.tabIndex,
      ).toBe(0);
      expect(document.body.textContent).toContain("Live");
    },
  );

  it("presents each device as one compact, cohesive navigation target", async () => {
    const history = await renderPath("/devices");

    const row = document.querySelector<HTMLAnchorElement>(
      'a[data-slot="device-row"][href="/devices/ipad"]',
    );
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain("Design iPad");
    expect(row?.textContent).toContain("Apple device · Physical device");
    expect(row?.querySelector('[data-slot="library-row-status"]')?.textContent).toContain("Ready");
    expect(row?.querySelector('[data-slot="device-row-chevron"]')).toBeNull();

    await click(row!);
    expect(history.location.pathname).toBe("/devices/ipad");
  });

  it("shows the device once without a lecture or oversized crumbs", async () => {
    await renderPath("/devices/ipad");

    const crumbs = document.querySelector('[data-slot="breadcrumbs"]');
    expect(crumbs?.className).toContain("text-xs");
    expect(crumbs?.className).not.toContain("mb-3");
    expect(crumbs?.querySelector("a")?.className).not.toContain("min-h-11");
    expect(document.querySelector("h1")?.textContent).toBe("Design iPad");
    expect(document.body.textContent).toContain("Apple device");
    expect(document.body.textContent).not.toContain("Available for Tests");
    expect(document.body.textContent).not.toContain("Device details");
    expect(document.body.textContent).not.toContain("Connection is checked again");
    expect(document.body.textContent).not.toContain("Explore your app here");
  });

  it("keeps devices visible after a failed refresh without claiming they are ready", async () => {
    const service = fakeDeviceService();
    await renderPath("/devices", { deviceService: service });
    expect(document.querySelector('[data-slot="device-row"]')?.textContent).toContain(
      "Design iPad",
    );
    const list = service.list;
    service.list = async () => {
      throw new TypeError("Failed to fetch");
    };
    await click(button("Check again"));
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 1_100))));
    await settle();
    const row = [...document.querySelectorAll('[data-slot="device-row"]')].find((item) =>
      item.textContent?.includes("Design iPad"),
    );
    expect(row).toBeDefined();
    expect(row?.textContent).toContain("Status unavailable");
    expect(document.body.textContent).toContain("Couldn’t refresh devices");
    expect(document.querySelector('[data-slot="recovery-centered"]')).toBeNull();
    service.list = list;
    await click(button("Refresh"));
    expect(document.body.textContent).not.toContain("Couldn’t refresh devices");
    expect(row?.textContent).toContain("Ready");
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

    const recovery = document.querySelector('[data-slot="recovery-centered"]');
    expect(recovery).not.toBeNull();
    expect(recovery?.getAttribute("role")).toBe("alert");
    expect(recovery?.textContent).toContain("Relay is not connected");
    expect(recovery?.textContent).toContain("Your work on this screen is safe");
    expect(button("Try again")).not.toBeNull();
    expect(
      [...document.querySelectorAll("button")].some(
        (candidate) => candidate.textContent?.trim() === "Check again",
      ),
    ).toBe(false);
  });

  it("shows every device regardless of old status URLs and exposes only search", async () => {
    await renderPath("/devices?status=needs-attention");
    expect(document.body.textContent).toContain("QA phone");
    expect(document.body.textContent).toContain("Design iPad");
    expect(document.body.textContent).toContain("Checkout browser");
    expect(document.querySelector('[aria-label="Filter devices"]')).toBeNull();
    expect(input("Search Devices and Browsers")).not.toBeNull();
  });

  it("clears search from the empty state while preserving setup return context", async () => {
    const history = await renderPath("/devices?returnTo=%2Ftests%2Fnew");

    const searchInput = input("Search Devices and Browsers");
    if (!(searchInput instanceof HTMLInputElement)) throw new Error("Search input not found");
    await fillInput(searchInput, "does-not-exist");

    expect(document.body.textContent).toContain("No devices match your search");
    await click(button("Show all devices"));

    expect(document.body.textContent).toContain("Design iPad");
    expect(document.body.textContent).toContain("QA phone");
    expect(document.body.textContent).toContain("Checkout browser");
    const search = new URLSearchParams(history.location.search);
    expect(search.get("returnTo")).toBe("/tests/new");
    expect(search.get("q")).toBeNull();
    expect(search.get("type")).toBeNull();
    expect(search.get("status")).toBeNull();
  });

  it("gives a device needing attention one dominant recovery action", async () => {
    const service = fakeDeviceService();
    await renderPath("/devices/phone", { deviceService: service });

    expect(
      [...document.querySelectorAll("button")].filter(
        (candidate) => candidate.textContent?.trim() === "Reconnect device",
      ),
    ).toHaveLength(1);
    expect(document.body.textContent).toContain("One step before this device is ready");
    await click(button("Reconnect device"));
    expect(service.recoveryCalls).toEqual(["phone"]);
    expect(document.body.textContent).toContain("Device is ready");
    expect(document.body.textContent).not.toContain("Relay reconnected and checked this device.");
  });

  it("launches an app on a ready attached device with an explicit relaunch choice", async () => {
    const service = fakeDeviceService();
    const launchCalls: Array<{ deviceId: string; app: string; relaunch?: boolean }> = [];
    service.launchApp = async (deviceId, app, relaunch) => {
      launchCalls.push({ deviceId, app, relaunch });
      return { serial: deviceId, app, platform: "ios", launchedAt: 10 };
    };
    await renderPath("/devices/ipad", {
      deviceService: service,
      productService: {
        connect: async () => ({ targets: [] }),
        presentTargets: async () => [],
      } as unknown as RecordingProductService,
    });

    expect(document.querySelector('aside[aria-label="Device controls"]')).toBeNull();
    await click(button("Open app"));

    const identifier = document.querySelector<HTMLInputElement>("#device-app-identifier");
    if (!identifier) throw new Error("App identifier input not found");
    expect(document.querySelector('input[type="checkbox"]')).not.toBeNull();
    await fillInput(identifier, " com.example.shop");
    await click(document.querySelector('input[type="checkbox"]')!);
    await click(button("Launch app"));

    expect(launchCalls).toEqual([{ deviceId: "ipad", app: "com.example.shop", relaunch: true }]);
    expect(button("Reconnect").disabled).toBe(false);
    await click(button("Open app"));
    expect(document.body.textContent).toContain("Launch requested");
    expect(document.body.textContent).toContain(
      "Launch requested for com.example.shop on Design iPad.",
    );
  });

  it("hides app launch on managed browsers", async () => {
    await renderPath("/devices/browser");

    expect(document.querySelector('[data-slot="device-launch-form"]')).toBeNull();
    expect(document.querySelector("#device-launch-title")).toBeNull();
    expect(document.body.textContent).not.toContain("Launch an app");
    expect(document.body.textContent).not.toContain("cannot launch");
  });

  it("keeps launch failures visible without hiding the device context", async () => {
    const service = fakeDeviceService();
    service.launchApp = async () => {
      throw new Error("target disconnected");
    };
    await renderPath("/devices/ipad", { deviceService: service });
    await click(button("Open app"));
    const identifier = document.querySelector<HTMLInputElement>("#device-app-identifier");
    if (!identifier) throw new Error("App identifier input not found");
    await fillInput(identifier, "com.example.shop");
    await click(button("Launch app"));

    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Keep the device connected and try again",
    );
    expect(document.body.textContent).toContain("Design iPad");
  });

  it("disables app launch until an identifier is entered", async () => {
    const service = fakeDeviceService();
    const launchCalls: string[] = [];
    service.launchApp = async (deviceId) => {
      launchCalls.push(deviceId);
      return { serial: deviceId, app: "", platform: "ios", launchedAt: 10 };
    };
    await renderPath("/devices/ipad", { deviceService: service });
    await click(button("Open app"));
    expect(button("Launch app").disabled).toBe(true);
    await click(button("Launch app"));
    expect(launchCalls).toEqual([]);
  });

  it.each([true, false, undefined])(
    "refreshes the preview after iOS launch and carries only a verified app (%s)",
    async (matched) => {
      const service = fakeDeviceService();
      service.launchApp = async (serial, app) => ({
        serial,
        app,
        platform: "ios",
        launchedAt: 10,
        ...(matched === undefined ? {} : { observed: { app: "Shop", matched } }),
      });
      const preview = liveIpadPreview();
      await renderPath("/devices/ipad", {
        deviceService: service,
        productService: preview.service,
      });
      expect(preview.previews).toHaveLength(1);
      await click(button("Open app"));
      await fillInput(
        document.querySelector<HTMLInputElement>("#device-app-identifier")!,
        "com.example.shop",
      );
      await click(button("Launch app"));

      expect(preview.previews).toHaveLength(2);
      expect(preview.previews[0].closed).toBe(true);
      expect(document.querySelector('aside[aria-label="Device controls"]')).toBeNull();
      const record = [...document.querySelectorAll<HTMLAnchorElement>("a")].find(
        (candidate) => candidate.textContent?.trim() === "Record a Test",
      )!;
      expect(new URL(record.href).searchParams.get("originApplication")).toBe(
        matched ? "com.example.shop" : null,
      );
      expect(button("Reconnecting…").disabled).toBe(true);
      expect(
        document.querySelector<HTMLCanvasElement>('canvas[data-slot="capture-live-target"]')
          ?.tabIndex,
      ).toBe(-1);
      await act(async () => preview.ready());
      await settle();
      expect(button("Reconnect").disabled).toBe(false);
      expect(
        document.querySelector<HTMLCanvasElement>('canvas[data-slot="capture-live-target"]')
          ?.tabIndex,
      ).toBe(0);
    },
  );

  it("keeps a pending launch and its draft across closing the app panel", async () => {
    const service = fakeDeviceService();
    let finish!: (result: ProductLaunchedApp) => void;
    let launches = 0;
    service.launchApp = async () => {
      launches += 1;
      return new Promise<ProductLaunchedApp>((resolve) => {
        finish = resolve;
      });
    };
    await renderPath("/devices/ipad", { deviceService: service });
    await click(button("Open app"));
    await fillInput(
      document.querySelector<HTMLInputElement>("#device-app-identifier")!,
      "com.example.shop",
    );
    await click(button("Launch app"));
    expect(button("Launching…").disabled).toBe(true);
    await click(document.querySelector<HTMLButtonElement>('[data-slot="sheet-close"]')!);
    await click(button("Open app"));
    expect(document.querySelector<HTMLInputElement>("#device-app-identifier")?.value).toBe(
      "com.example.shop",
    );
    expect(button("Launching…").disabled).toBe(true);
    await click(button("Launching…"));
    expect(launches).toBe(1);
    await act(async () =>
      finish({ serial: "ipad", app: "com.example.shop", platform: "ios", launchedAt: 10 }),
    );
    await settle();
  });

  it("closes app controls with Escape and preserves the draft when reopened", async () => {
    const service = fakeDeviceService();
    service.launchApp = async (serial, app) => ({ serial, app, platform: "ios", launchedAt: 10 });
    await renderPath("/devices/ipad", { deviceService: service });
    const trigger = button("Open app");
    await click(trigger);
    const identifier = document.querySelector<HTMLInputElement>("#device-app-identifier")!;
    await fillInput(identifier, "com.example.shop");
    await act(async () => {
      identifier.focus();
      identifier.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await settle();
    expect(document.querySelector('aside[aria-label="Device controls"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await click(trigger);
    expect(document.querySelector<HTMLInputElement>("#device-app-identifier")?.value).toBe(
      "com.example.shop",
    );
  });

  it("shows reconnecting through recovery and replacement preview connection", async () => {
    const service = fakeDeviceService();
    const recovered = await service.recover("ipad");
    let finish!: (result: typeof recovered) => void;
    service.recover = async () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const preview = liveIpadPreview();
    await renderPath("/devices/ipad", { deviceService: service, productService: preview.service });
    await click(button("Reconnect"));
    expect(button("Reconnecting…").disabled).toBe(true);
    expect(preview.previews).toHaveLength(1);
    expect(
      document.querySelector<HTMLCanvasElement>('canvas[data-slot="capture-live-target"]')
        ?.tabIndex,
    ).toBe(-1);
    await act(async () => finish(recovered));
    await settle();
    expect(preview.previews).toHaveLength(2);
    expect(button("Reconnecting…").disabled).toBe(true);
    await act(async () => preview.ready());
    await settle();
    expect(button("Reconnect").disabled).toBe(false);
  });
});

describe("Device app controls", () => {
  it("opens the selected native device without waiting for unrelated target discovery", async () => {
    const service = fakeDeviceService();
    service.get = async () => productDevice("phone", "QA phone", "ready", "android");
    const selected = { kind: "device", platform: "android", targetId: "phone" } as const;
    let previews = 0;
    const scope = { targetKind: "device", targetId: "phone", phase: "android" };
    await renderPath("/devices/phone", {
      deviceService: service,
      productService: {
        connect: async (input: Parameters<RecordingProductService["connect"]>[0]) => {
          if (JSON.stringify(input) !== JSON.stringify(scope)) {
            throw new Error("Unrelated browser preflight would block this native device");
          }
          return { targets: [selected] };
        },
        presentTargets: async (
          targets: Parameters<RecordingProductService["presentTargets"]>[0],
          input: Parameters<RecordingProductService["presentTargets"]>[1],
        ) => {
          expect(input).toEqual(scope);
          return targets.map((target) => ({
            ...target,
            name: "QA phone",
            detail: "Android device",
          }));
        },
        previewTarget: async (target: typeof selected): Promise<LiveTargetSession> => {
          expect(target.targetId).toBe("phone");
          previews += 1;
          return {
            snapshot: () => ({ status: "streaming", target: selected }),
            subscribe: (listener) => {
              listener({ status: "streaming", target: selected });
              return () => undefined;
            },
            mount: () => () => undefined,
            input: async () => undefined,
            close: () => undefined,
          };
        },
      } as unknown as RecordingProductService,
    });
    expect(previews).toBe(1);
    expect(document.querySelector('[data-slot="capture-live-target"]')).not.toBeNull();
  });

  it("offers named apps without a language panel when the host cannot change language", async () => {
    const service = fakeDeviceService();
    service.get = async () => productDevice("phone", "QA phone", "ready", "android");
    service.listInstalledApps = async () => [{ package: "com.android.settings", name: "Settings" }];
    const launches: string[] = [];
    service.launchApp = async (_serial, app) => {
      launches.push(app);
      return { serial: "phone", app, platform: "android", launchedAt: 1 };
    };
    service.listAppLocales = async () => {
      throw new Error("Locale lookup must not run without language control");
    };
    await renderPath("/devices/phone", { deviceService: service });
    expect(document.body.textContent).not.toContain("App and language");
    expect(document.querySelector('aside[aria-label="Device controls"]')).toBeNull();
    await click(button("Open app"));
    const picker = document.querySelector<HTMLButtonElement>('[aria-label="App"]')!;
    await click(picker);
    const settings = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (item) => item.textContent === "Settings",
    )!;
    await click(settings);
    expect(picker.textContent).toBe("Settings");
    expect(document.body.textContent).not.toContain("com.android.settings");
    expect(document.body.textContent).not.toContain("Loading supported languages");
    expect(document.querySelector('[aria-label="Language"]')).toBeNull();
    const launch = [...document.querySelectorAll<HTMLButtonElement>("aside button")].find(
      (candidate) => candidate.textContent?.trim() === "Open app",
    );
    if (!launch) throw new Error("App launch button not found");
    await click(launch);
    expect(launches).toEqual(["com.android.settings"]);
    expect(
      document.querySelector<HTMLAnchorElement>('a[href*="originApplication"]')?.href,
    ).toContain("com.android.settings");
  });

  it("gives the live device the available space when the host has no app controls", async () => {
    const service = fakeDeviceService();
    service.get = async () => productDevice("phone", "QA phone", "ready", "android");
    await renderPath("/devices/phone", { deviceService: service });
    expect(document.querySelector('aside[aria-label="Device controls"]')).toBeNull();
    expect(document.body.textContent).not.toContain("App and language");
    expect(document.body.textContent).not.toContain("App controls are unavailable");
    expect(document.body.textContent).toContain("Record a Test");
  });

  it("shows the observed device language without changing it", async () => {
    const service = fakeDeviceService();
    service.get = async () => productDevice("phone", "QA phone", "ready", "android");
    service.listInstalledApps = async () => [{ package: "com.android.settings", name: "Settings" }];
    service.launchApp = async () => ({
      serial: "phone",
      app: "com.android.settings",
      platform: "android",
      launchedAt: 1,
    });
    service.listAppLocales = async () => ({
      packageName: "com.android.settings",
      locales: ["en", "ko"],
      currentLocale: "ko-KR",
      source: "android-device-locale",
    });
    let changes = 0;
    service.setAppLocale = async () => {
      changes++;
      return { packageName: "com.android.settings", locale: "en" };
    };
    await renderPath("/devices/phone", { deviceService: service });
    await click(button("Open app"));
    await click(document.querySelector<HTMLButtonElement>('[aria-label="App"]')!);
    const settings = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (item) => item.textContent === "Settings",
    )!;
    await click(settings);
    expect(document.querySelector('[aria-label="Language"]')?.textContent).toContain("Korean");
    expect(changes).toBe(0);
  });
});

describe("Settings", () => {
  it("keeps stable route navigation and saves evidence choices through the product service", async () => {
    const service = fakeSettingsService();
    const history = await renderPath("/settings/evidence?section=sensitive", {
      settingsService: service,
    });

    expect(document.querySelectorAll('[aria-label="Settings sections"] a')).toHaveLength(6);
    expect(
      [...document.querySelectorAll('[aria-label="Settings sections"] a')].map((item) =>
        item.textContent?.trim(),
      ),
    ).toContain("Privacy");
    expect(document.body.textContent).toContain("Evidence");
    expect(document.body.textContent).not.toContain("Protect evidence before it is saved");
    expect(document.body.textContent).toContain("HTTP bodies");
    expect(document.body.textContent).toContain("Packet captures");
    expect(document.body.textContent).not.toContain(
      "Android emulator packet metadata is captured temporarily either way.",
    );
    expect(document.querySelector('[aria-live="polite"]:not(.sr-only)')).toBeNull();
    expect(document.body.textContent).not.toMatch(/\b(?:lease|runtime profile|inventory)\b/i);

    await click(input("Redact sensitive evidence"));
    expect(service.privacyCalls).toEqual([false]);
    expect(document.body.textContent).toContain(
      "Masks credentials, cookies, secrets, clipboard, and URL queries.",
    );
    expect(document.body.textContent).toContain("Saved");

    await click(input("Crashes"));
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
    expect(history.location.search).toBe("");
  });

  it("applies and persists appearance without waiting for a reload", async () => {
    const platform = testPlatform({ "appearance.colorScheme": "dark" });
    await renderPath("/settings/appearance", { platform });

    expect(document.documentElement.dataset.colorScheme).toBe("dark");
    expect(input("Light").getAttribute("aria-checked")).toBe("false");
    await click(input("Light"));
    expect(document.documentElement.dataset.colorScheme).toBe("light");
    expect(platform.values.get("appearance.colorScheme")).toBe("light");
    expect(window.localStorage.getItem("relay-color-scheme")).toBe("light");
    expect(document.body.textContent).toContain("Saved");
  });

  it("saves accessibility names as a live-view setting", async () => {
    const platform = testPlatform({ "live.accessibilityLabels": "off" });
    await renderPath("/settings/appearance", { platform });

    expect(document.body.textContent).toContain("Show the accessibility name");
    expect(document.body.textContent).toContain("TalkBack and VoiceOver stay off");
    expect(input("Off").getAttribute("aria-checked")).toBe("true");
    await click(input("Always show"));
    expect(platform.values.get("live.accessibilityLabels")).toBe("always");
    expect(input("Always show").getAttribute("aria-checked")).toBe("true");
    await click(input("On hover"));
    expect(platform.values.get("live.accessibilityLabels")).toBe("hover");
    expect(document.body.textContent).toContain("Saved");
  });

  it("turns setup resources into concise human recovery in Advanced", async () => {
    await renderPath("/settings/advanced");

    expect(document.body.textContent).toContain("Apple devices");
    expect(document.body.textContent).toContain("Signed desktop build");
    expect(document.body.textContent).toContain("Lab Mac server");
    expect(document.body.textContent).toContain("dev.relay.lab-server is not loaded");
    expect(document.body.textContent).toContain("Apple Development is not enough");
    expect(document.body.textContent).toContain("Visual and semantic judges");
    expect(document.body.textContent).toContain("OPENROUTER_API_KEY");
    expect(document.body.textContent).toContain("Android devices");
    expect(document.body.textContent).toContain("Install Platform Tools, then reopen Relay.");
    expect(document.body.textContent).not.toContain("Relay has the local support it needs.");
    expect(document.body.textContent).not.toContain("adb");
    expect(document.body.textContent).not.toContain("teamId");
    expect(document.querySelector('[data-slot="item"]')).toBeNull();
  });

  it("does not treat Apple Development as a signed operator build", async () => {
    const service: SettingsProductService = {
      ...fakeSettingsService(),
      async appleSetup() {
        return {
          checks: [{ id: "relay", label: "Relay runner", status: "ready", detail: "Ready" }],
          operatorBuild: {
            status: "needs-attention",
            detail:
              "A Developer ID Application identity is required to ship a signed operator build. Apple Development is not enough. Morning review stays on the Vite UI and local server until that identity exists.",
          },
        };
      },
    };
    await renderPath("/settings/advanced", { settingsService: service });
    const row = [...document.querySelectorAll("h3")]
      .find((heading) => heading.textContent === "Signed desktop build")
      ?.closest("div");
    expect(row?.textContent).toContain("Needs attention");
    expect(row?.textContent).toContain("Apple Development is not enough");
    expect(row?.textContent).not.toContain("Ready");
  });

  it("does not treat a missing lab-server launchd job as ready", async () => {
    await renderPath("/settings/advanced");
    const row = [...document.querySelectorAll("h3")]
      .find((heading) => heading.textContent === "Lab Mac server")
      ?.closest("div");
    expect(row?.textContent).toContain("Needs attention");
    expect(row?.textContent).toContain("dev.relay.lab-server is not loaded");
    expect(row?.textContent).toContain("restart :8787");
    expect(row?.textContent).not.toContain("is running");
  });

  it("does not treat a missing OpenRouter key as ready", async () => {
    await renderPath("/settings/advanced");
    const row = [...document.querySelectorAll("h3")]
      .find((heading) => heading.textContent === "Visual and semantic judges")
      ?.closest("div");
    expect(row?.textContent).toContain("Needs attention");
    expect(row?.textContent).toContain("OPENROUTER_API_KEY");
    expect(row?.textContent).toContain("never a silent pass");
    expect(row?.textContent).not.toContain("is set");
  });

  it("lists the workspace as a flush settings row", async () => {
    await renderPath("/settings/integrations");

    expect(document.body.textContent).toContain("Relay workspace");
    expect(document.body.textContent).not.toContain("Connected services");
    expect(document.body.textContent).not.toContain("Managed by your workspace");
    expect(document.querySelector('[data-slot="item"]')).toBeNull();
    const row = [...document.querySelectorAll("h3")].find(
      (heading) => heading.textContent === "Relay workspace",
    );
    expect(row?.closest("div")?.className).not.toContain("mt-4");
    expect(row?.closest("section")?.firstElementChild?.className).not.toContain("mt-");
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
    const controls = document.querySelector("form");
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
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(0);
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

  it("keeps update read and check failures visible in About", async () => {
    const platform = testPlatform();
    let checks = 0;
    platform.updates = {
      async getState() {
        if (checks === 0) throw new Error("update state unavailable");
        return { phase: "idle" };
      },
      async check() {
        checks += 1;
        throw new Error("update service offline");
      },
      async install() {
        throw new Error("installer unavailable");
      },
      subscribe() {
        return () => undefined;
      },
    };

    await renderPath("/settings/about", { platform });
    expect(document.body.textContent).toContain("update state unavailable");
    await click(button("Check now"));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "update service offline",
    );
  });

  it("keeps an install failure visible instead of leaving an unhandled rejection", async () => {
    const platform = testPlatform();
    platform.updates = {
      async getState() {
        return { phase: "downloaded", version: "2.0.0" };
      },
      async check() {},
      async install() {
        throw new Error("installer unavailable");
      },
      subscribe() {
        return () => undefined;
      },
    };

    await renderPath("/settings/about", { platform });
    await click(button("Install update"));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "installer unavailable",
    );
  });

  it("applies appearance immediately and offers a retry after storage rejects", async () => {
    const platform = testPlatform();
    let writes = 0;
    platform.storage = {
      get: () => null,
      set: () => {
        writes += 1;
        if (writes === 1) return Promise.reject(new Error("storage is locked"));
        return Promise.resolve();
      },
      remove: () => undefined,
    };

    await renderPath("/settings/appearance", { platform });
    await click(input("Dark"));
    expect(document.documentElement.dataset.colorScheme).toBe("dark");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "could not be saved for next time",
    );
    await click(button("Retry saving"));
    expect(writes).toBe(2);
    expect(document.body.textContent).toContain("Saved");
  });

  it("does not let a late saved appearance overwrite a choice made while loading", async () => {
    let resolveStored!: (value: string | null) => void;
    const stored = new Promise<string | null>((resolve) => {
      resolveStored = resolve;
    });
    const platform = testPlatform();
    platform.storage = {
      get: () => stored,
      set: () => undefined,
      remove: () => undefined,
    };

    await renderPath("/settings/appearance", { platform });
    await click(input("Dark"));
    expect(document.documentElement.dataset.colorScheme).toBe("dark");
    resolveStored("light");
    await settle();
    expect(document.documentElement.dataset.colorScheme).toBe("dark");
    expect(input("Dark").getAttribute("aria-checked")).toBe("true");
  });

  it("labels a configured General address without claiming a live connection", async () => {
    const platform = testPlatform();
    platform.getServerConnection = () => ({
      url: "http://127.0.0.1:9876",
      auth: { type: "none" },
      organizationId: "local",
      projectId: "default",
      actorId: "human:test",
      actorKind: "human",
    });

    await renderPath("/settings/general", { platform });
    expect(document.body.textContent).toContain("Relay is using 127.0.0.1:9876.");
    expect(document.body.textContent).not.toContain("Change address");
    expect(document.body.textContent).not.toContain("Configured");
    expect(document.body.textContent).not.toContain("Connected");
  });

  it("retains the typed Advanced address after a failed save", async () => {
    const platform = testPlatform();
    platform.setServerUrl = () => Promise.reject(new Error("workspace unavailable"));
    await renderPath("/settings/advanced", { platform });

    const url = document.querySelector<HTMLInputElement>("#relay-server-url");
    if (!url) throw new Error("Server URL input not found");
    await fillInput(url, "http://new-workspace.example.test:8787");
    await click(button("Save address"));

    expect(url.value).toBe("http://new-workspace.example.test:8787");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Your entered address is preserved",
    );
  });
});
