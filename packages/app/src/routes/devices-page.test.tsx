/** @jsxImportSource react */
import { createMemoryHistory } from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RelayApp } from "../app";
import type {
  BrowserSpacesProductService,
  ProductBrowserSpace,
} from "../data/browser-spaces-product-service";
import type { DeviceProductService, ProductDevice } from "../data/device-product-service";
import type { RecordingProductService } from "../data/recording-product-service";
import { newTestSetupContinuation } from "../data/setup-continuation";
import type { Platform } from "../platform/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
const returnTo = newTestSetupContinuation("checkout-app");

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline catalog fixture")));
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function device(
  id: string,
  name: string,
  platform: ProductDevice["platform"] = "browser",
): ProductDevice {
  return {
    id,
    serial: id,
    name,
    platform,
    kind: platform === "browser" ? "Managed browser" : "Physical device",
    status: platform === "browser" ? "virtual" : "needs-attention",
    runnable: false,
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

const browsers = [
  device("historical-first", "localhost:8793 · Browser 1"),
  device("historical-admin", "Admin account"),
  device("historical-last", "localhost:8793 · Browser 3"),
  device("local-app-two", "localhost:8794"),
  device("unknown-address", "Saved checkout browser"),
  device("grok-daily", "Grok daily"),
  device("grok-auto-one", "grok.com · Browser 1"),
  device("grok-auto-two", "grok.com · Browser 2"),
];
const devices = [device("samsung", "Samsung phone", "android"), ...browsers];
const spaces: readonly ProductBrowserSpace[] = browsers
  .filter((browser) => browser.id !== "unknown-address")
  .map((browser, index) => ({
    id: browser.id,
    name: browser.id.startsWith("grok-auto") ? "grok.com" : browser.name,
    startUrl:
      index < 3
        ? "http://localhost:8793/checkout"
        : index === 3
          ? "http://localhost:8794/"
          : "https://grok.com/",
    createdAt: index,
    updatedAt: index,
    profileRetention: "retain",
    persistent: true,
    source: { kind: "managed-browser-target", id: browser.id },
  }));

async function render(path: string) {
  const history = createMemoryHistory({ initialEntries: [path] });
  const values = new Map<string, string>();
  const platform: Platform = {
    platform: "web",
    getServerUrl: () => "http://127.0.0.1:8787",
    storage: {
      get: (key) => values.get(key) ?? null,
      set: (key, value) => void values.set(key, value),
      remove: (key) => void values.delete(key),
    },
  };
  const deviceService: DeviceProductService = {
    list: async () => devices,
    get: async (id) => devices.find((device) => device.id === id),
    actions: async () => [],
    recover: async () => {
      throw new Error("Catalog must not recover a device");
    },
  };
  const browserSpacesService = {
    listSpaces: async () => spaces,
  } as BrowserSpacesProductService;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <RelayApp
        history={history}
        platform={platform}
        deviceService={deviceService}
        browserSpacesService={browserSpacesService}
        productService={{} as RecordingProductService}
      />,
    );
  });
  await settle();
  return history;
}

async function settle() {
  for (let index = 0; index < 5; index++)
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
}

describe("Devices catalog", () => {
  it("prioritizes named websites and discloses local browsers without removing any selection", async () => {
    await render(`/devices?returnTo=${encodeURIComponent(returnTo)}`);

    const localTrigger = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.startsWith("Local browsers"),
    );
    expect(localTrigger?.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector('a[data-slot="device-row"][href*="grok-daily"]')).not.toBeNull();
    expect(document.querySelector('a[data-slot="device-row"][href*="local-app-two"]')).toBeNull();
    expect(
      document.querySelector('a[data-slot="device-row"][href*="unknown-address"]'),
    ).not.toBeNull();
    if (!(localTrigger instanceof HTMLButtonElement))
      throw new Error("Local browser disclosure not found");
    await act(async () => localTrigger.click());
    await settle();

    const group = [...document.querySelectorAll('[data-slot="browser-destination-group"]')].find(
      (group) => group.textContent?.includes("localhost:8793/checkout"),
    );
    const trigger = group?.querySelector("button");
    expect(trigger?.textContent).toContain("localhost:8793/checkout");
    expect(trigger?.textContent).toContain("3 browsers");
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(
      document.querySelector('a[data-slot="device-row"][href*="historical-first"]'),
    ).toBeNull();
    expect(
      document.querySelector('a[data-slot="device-row"][href*="local-app-two"]'),
    ).not.toBeNull();

    if (!(trigger instanceof HTMLButtonElement))
      throw new Error("Destination disclosure not found");
    await act(async () => trigger.click());
    await settle();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    for (const browser of browsers.slice(0, 3)) {
      const link = group?.querySelector<HTMLAnchorElement>(
        `a[data-slot="device-row"][href*="${browser.id}"]`,
      );
      expect(link?.textContent).toContain(browser.name);
      expect(link?.getAttribute("href")).toContain(`/environments/${browser.id}`);
      expect(new URL(link!.href).searchParams.get("returnTo")).toBe(returnTo);
    }
  });

  it("reveals matching saved browsers by address and supports exact historical identity search", async () => {
    await render("/devices?q=8793%2Fcheckout");

    expect(
      document
        .querySelector('[data-slot="browser-destination-group"] button')
        ?.getAttribute("aria-expanded"),
    ).toBe("true");
    expect(
      document.querySelectorAll('a[data-slot="device-row"][href*="historical-"]'),
    ).toHaveLength(3);
    expect(document.querySelector('a[data-slot="device-row"][href*="local-app-two"]')).toBeNull();
  });

  it("links directly to an exact historical search match without substituting another browser", async () => {
    await render(`/devices?q=historical-first&returnTo=${encodeURIComponent(returnTo)}`);

    const link = document.querySelector<HTMLAnchorElement>('a[data-slot="device-row"]');
    expect(link?.textContent).toContain("Browser 1");
    expect(link?.getAttribute("href")).toContain("/environments/historical-first");
    expect(new URL(link!.href).searchParams.get("returnTo")).toBe(returnTo);
    expect(document.querySelectorAll('a[data-slot="device-row"]')).toHaveLength(1);
  });

  it("removes repeated browser status labels without implying live readiness", async () => {
    await render("/devices?q=grok");

    const browser = document.querySelector(
      'a[data-slot="device-row"][href="/environments/grok-daily"]',
    );
    expect(browser?.querySelector('[data-slot="library-row-status"]')).toBeNull();
    expect(browser?.textContent).not.toContain("Saved browser");
    expect(browser?.textContent).not.toContain("Ready");
    expect(document.body.textContent).not.toContain("saved browsers");
  });

  it("identifies Android visually and with text without inventing device readiness", async () => {
    await render("/devices");

    const android = document.querySelector('a[data-slot="device-row"][href="/devices/samsung"]');
    expect(android?.querySelector('[data-slot="android-device-icon"]')).not.toBeNull();
    expect(android?.textContent).toContain("Android · Physical device");
    expect(android?.textContent).toContain("Needs attention");
    expect(android?.textContent).not.toContain("Ready");
  });
});
