import { describe, expect, it } from "vitest";
import type { ProductBrowserSpace } from "./browser-spaces-product-service";
import type { ProductDevice } from "./device-product-service";
import {
  deviceMatchesCatalogSearch,
  groupBrowserDestinations,
  isLoopbackBrowserUrl,
  mergeDeviceCatalog,
} from "./device-catalog-presentation";

function browser(id: string, name = id, browserUrl?: string): ProductDevice {
  return {
    id,
    serial: id,
    name,
    platform: "browser",
    kind: "Managed browser",
    status: "virtual",
    runnable: false,
    ...(browserUrl ? { browserUrl } : {}),
    device: { id, serial: id, name, platform: "browser", kind: "Managed browser", booted: true },
  };
}

function site(id: string, startUrl: string, name = id): ProductBrowserSpace {
  return {
    id,
    name,
    startUrl,
    createdAt: 1,
    updatedAt: 1,
    profileRetention: "retain",
    persistent: true,
    source: { kind: "managed-browser-target", id },
  };
}

describe("browser catalog presentation", () => {
  it("projects canonical browser registry identity without claiming live readiness", () => {
    const newer = { ...site("newer", "https://shop.example/", "shop.example"), createdAt: 2 };
    const older = site("older", "https://shop.example/", "shop.example");
    const rows = mergeDeviceCatalog(undefined, [newer, older]);

    expect(rows.map((row) => ({ id: row.id, serial: row.serial, name: row.name }))).toEqual([
      { id: "newer", serial: "newer", name: "shop.example · Browser 2" },
      { id: "older", serial: "older", name: "shop.example · Browser 1" },
    ]);
    for (const row of rows) {
      expect(row.browserUrl).toBe("https://shop.example/");
      expect(row.status).toBe("virtual");
      expect(row.runnable).toBe(false);
      expect(row.device.booted).toBeNull();
    }
  });

  it("merges known hardware with authoritative registry rows and falls back only to observed inventory", () => {
    const physical: ProductDevice = {
      ...browser("phone"),
      platform: "android",
      kind: "Physical device",
      status: "needs-attention",
      device: {
        id: "phone",
        serial: "phone",
        name: "Phone",
        platform: "android",
        kind: "Physical device",
        booted: true,
      },
    };
    const inventory = [physical, browser("removed-from-registry")];

    const merged = mergeDeviceCatalog(inventory, [site("current", "https://shop.example/")]);
    expect(merged.map((row) => row.id)).toEqual(["phone", "current"]);
    expect(merged[0]).toBe(physical);
    expect(mergeDeviceCatalog(inventory, [])).toEqual([physical]);
    expect(mergeDeviceCatalog(inventory, undefined)).toBe(inventory);
    expect(mergeDeviceCatalog(undefined, undefined)).toEqual([]);
  });

  it("recognizes explicit loopback URLs without inferring local or test provenance from names", () => {
    for (const url of [
      "http://localhost:8793/",
      "https://team.localhost/",
      "http://127.0.0.1:8793/",
      "http://127.1.2.3/",
      "http://[::1]:8793/",
    ])
      expect(isLoopbackBrowserUrl(url)).toBe(true);
    for (const url of [
      undefined,
      "invalid",
      "file:///localhost",
      "https://localhost.example/",
      "https://test.example/",
      "http://192.168.0.2/",
    ])
      expect(isLoopbackBrowserUrl(url)).toBe(false);
  });

  it("keeps named profiles prominent beside grouped address-named browsers", () => {
    const devices = [browser("auto-one"), browser("member", "Member account"), browser("auto-two")];
    const sites = new Map(
      devices.map((device) => [
        device.id,
        site(
          device.id,
          "https://shop.example/",
          device.id === "member" ? "Member account" : "shop.example",
        ),
      ]),
    );

    const groups = groupBrowserDestinations(devices, sites, { keepNamedSeparate: true });

    expect(groups[0]?.devices).toEqual([devices[1]]);
    expect(groups[1]?.devices).toEqual([devices[0], devices[2]]);
    expect(new Set(groups.flatMap((group) => group.devices.map((device) => device.id)))).toEqual(
      new Set(devices.map((device) => device.id)),
    );
  });

  it("groups repeated addresses while preserving each browser identity and order", () => {
    const devices = [browser("first"), browser("member", "Member account"), browser("last")];
    const sites = new Map(
      devices.map((device) => [device.id, site(device.id, "http://localhost:8793/")]),
    );

    const groups = groupBrowserDestinations(devices, sites);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe("localhost:8793");
    expect(groups[0]?.devices).toEqual(devices);
    expect(groups[0]?.devices[1]).toBe(devices[1]);
  });

  it("keeps distinct local apps, paths, queries and protocols as separate destinations", () => {
    const urls = [
      "http://localhost:8793/",
      "http://localhost:8794/",
      "http://localhost:8793/settings",
      "http://localhost:8793/?workspace=two",
      "https://localhost:8793/",
    ];
    const devices = urls.map((_, index) => browser(`browser-${index}`));
    const sites = new Map(
      devices.map((device, index) => [device.id, site(device.id, urls[index]!)]),
    );

    expect(groupBrowserDestinations(devices, sites).map((group) => group.devices)).toEqual(
      devices.map((device) => [device]),
    );
  });

  it("keeps missing and invalid addresses visible and uses catalog URLs if space metadata fails", () => {
    const devices = [
      browser("missing"),
      browser("invalid", "Invalid address", "not-a-url"),
      browser("fallback-one", "First", "https://shop.example/"),
      browser("fallback-two", "Second", "https://shop.example/"),
    ];
    const groups = groupBrowserDestinations(devices, new Map());

    expect(groups).toHaveLength(3);
    expect(groups.flatMap((group) => group.devices)).toEqual(devices);
    expect(groups[2]?.devices.map((device) => device.id)).toEqual(["fallback-one", "fallback-two"]);
  });

  it("searches retained browser identities, original names and full destination addresses", () => {
    const device = browser("historical-browser-id", "127.0.0.1:8793 · Browser 19");
    const sites = new Map([
      [device.id, site(device.id, "http://127.0.0.1:8793/settings", "Admin account")],
    ]);

    for (const query of ["historical-browser-id", "Browser 19", "ADMIN ACCOUNT", "8793/settings"])
      expect(deviceMatchesCatalogSearch(device, query, sites)).toBe(true);
    expect(deviceMatchesCatalogSearch(device, "8794", sites)).toBe(false);
    expect(deviceMatchesCatalogSearch(device, "", sites)).toBe(true);
  });
});
