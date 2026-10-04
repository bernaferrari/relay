/** @jsxImportSource react */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProductBrowserSpace } from "../data/browser-spaces-product-service";
import { browserCatalogQueryKey } from "../data/device-catalog-presentation";
import { deviceQueryKeys, type ProductDevice } from "../data/device-product-service";
import { DeviceDestinationButton } from "./device-destination";
import { WORKSPACE_DESTINATION_KEY, workspaceDestinationQueryKey } from "./destination-summary";

const route = vi.hoisted(() => ({ context: null as unknown, push: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ history: { push: route.push } }),
  useRouteContext: () => route.context,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const clients: QueryClient[] = [];

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  for (const client of clients.splice(0)) client.clear();
  document.body.replaceChildren();
  vi.clearAllMocks();
});

function device(id: string, name: string, browserUrl?: string): ProductDevice {
  const platform = browserUrl ? "browser" : "android";
  const kind = browserUrl ? "Managed browser" : "Physical device";
  return {
    id,
    serial: id,
    name,
    platform,
    kind,
    status: browserUrl ? "virtual" : "ready",
    runnable: !browserUrl,
    ...(browserUrl ? { browserUrl } : {}),
    device: { id, serial: id, name, platform, kind, booted: true },
  };
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

function browserSpace(id: string, name: string, startUrl: string): ProductBrowserSpace {
  return {
    id,
    name,
    startUrl,
    createdAt: 0,
    updatedAt: 0,
    profileRetention: "retain",
    persistent: true,
    source: { kind: "managed-browser-target", id },
  };
}

async function renderPicker(
  devices: readonly ProductDevice[],
  selectedTargetId?: string,
  options: {
    loadInventory?(): Promise<readonly ProductDevice[]>;
    spaces?: readonly ProductBrowserSpace[];
    seedInventory?: boolean;
    seedSpaces?: boolean;
  } = {},
) {
  const client = new QueryClient();
  clients.push(client);
  if (options.seedInventory !== false) client.setQueryData(deviceQueryKeys.devices, devices);
  const spaces =
    options.spaces ??
    devices
      .filter((device) => device.platform === "browser")
      .map((device) => browserSpace(device.id, device.name, device.browserUrl!));
  if (options.seedSpaces !== false) client.setQueryData(browserCatalogQueryKey, spaces);
  client.setQueryData(
    workspaceDestinationQueryKey,
    selectedTargetId ? { targetId: selectedTargetId } : null,
  );
  const set = vi.fn();
  const onSelect = vi.fn();
  const list = vi.fn(options.loadInventory ?? (async () => devices));
  const listSpaces = vi.fn(async () => spaces);
  route.context = {
    deviceService: { list },
    browserSpacesService: { listSpaces },
    queryClient: client,
    platform: { storage: { get: () => null, set } },
  };
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <DeviceDestinationButton onSelect={onSelect} />
      </QueryClientProvider>,
    );
  });
  await settle();
  return { client, set, onSelect, list, listSpaces };
}

function trigger() {
  return document.querySelector<HTMLButtonElement>('[aria-label^="Device or browser"]')!;
}

async function openPicker() {
  await act(async () => trigger().click());
  await settle();
}

async function searchFor(query: string) {
  const input = document.querySelector<HTMLInputElement>(
    'input[aria-label="Find a device or browser"]',
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, query);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

describe("device destination picker", () => {
  it("excludes goal scratch browsers while preserving exact local selection and catalog records", async () => {
    const local = device("local-checkout-exact", "Local checkout", "http://localhost:8793/");
    const scratch = device("goal-goal-abc123", "Scratch browser", "http://localhost:8793/");
    const repairScratch = {
      ...device("goal-inactive-abc123", "Inactive scratch browser", "http://localhost:3000/"),
      status: "needs-attention" as const,
    };
    const { client, onSelect } = await renderPicker([local, scratch, repairScratch], local.id);

    expect(trigger().textContent).toContain("Local checkout");
    await openPicker();
    expect(
      document.querySelector('[role="menuitem"][aria-label="Local checkout, selected"]'),
    ).not.toBeNull();
    expect(document.body.textContent).not.toContain("Scratch browser");
    expect(document.body.textContent).not.toContain("Inactive scratch browser");
    expect(document.querySelector('[data-slot="dropdown-menu-sub-trigger"]')).toBeNull();

    await searchFor(scratch.id);
    expect(document.querySelector('[role="menu"]')?.textContent).toContain(
      "No matching devices or browsers",
    );
    expect(document.querySelector('[role="menuitem"][aria-label="Scratch browser"]')).toBeNull();
    await searchFor(repairScratch.id);
    expect(document.querySelector('[role="menu"]')?.textContent).toContain(
      "No matching devices or browsers",
    );
    expect(onSelect).not.toHaveBeenCalled();

    await searchFor(local.id);
    const match = document.querySelector<HTMLElement>(
      '[role="menuitem"][aria-label="Local checkout, selected"]',
    )!;
    await act(async () => match.click());
    await settle();
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: local.id, runnable: false }),
    );
    expect(client.getQueryData(workspaceDestinationQueryKey)).toEqual({ targetId: local.id });
    expect(client.getQueryData(deviceQueryKeys.devices)).toEqual([local, scratch, repairScratch]);
    expect(client.getQueryData(browserCatalogQueryKey)).toEqual([
      browserSpace(local.id, local.name, local.browserUrl!),
      browserSpace(scratch.id, scratch.name, scratch.browserUrl!),
      browserSpace(repairScratch.id, repairScratch.name, repairScratch.browserUrl!),
    ]);
  });

  it("keeps connected devices and public browsers primary while local browsers remain selectable", async () => {
    const local = Array.from({ length: 40 }, (_, index) =>
      device(`local-${index}`, `Local browser ${index + 1}`, "http://127.0.0.1:8793/"),
    );
    const { client, set, onSelect } = await renderPicker([
      device("phone", "My phone"),
      device("grok", "Grok", "https://grok.com/"),
      ...local,
    ]);

    expect(trigger().textContent).toContain("Choose device");
    expect(trigger().textContent).not.toContain("browser");
    await openPicker();
    const mainMenu = document.querySelector('[role="menu"]')!;
    expect(mainMenu.textContent).toContain("My phone");
    expect(mainMenu.textContent).toContain("Grok");
    expect(mainMenu.textContent).not.toContain("Local browser 1");
    expect(mainMenu.querySelectorAll('[role="menuitem"]').length).toBeLessThan(8);

    const localSubmenu = mainMenu.querySelector<HTMLElement>(
      '[data-slot="dropdown-menu-sub-trigger"]',
    )!;
    expect(localSubmenu.textContent).toContain("Local browsers");
    expect(localSubmenu.textContent).toContain("40");
    await act(async () => localSubmenu.click());
    await settle();
    const option = document.querySelector<HTMLElement>(
      '[role="menuitem"][aria-label="Local browser 8"]',
    )!;
    expect(option).not.toBeNull();
    await act(async () => option.click());
    await settle();

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        id: local[7]!.id,
        browserUrl: local[7]!.browserUrl,
        runnable: false,
      }),
    );
    expect(client.getQueryData(workspaceDestinationQueryKey)).toEqual({ targetId: "local-7" });
    expect(set).toHaveBeenCalledWith(WORKSPACE_DESTINATION_KEY, '{"targetId":"local-7"}');
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(trigger().textContent).toContain("Local browser 8");
    await openPicker();
    expect(
      document.querySelector('[role="menuitem"][aria-label="Local browser 8, selected"]'),
    ).not.toBeNull();
  });

  it.each(["Hidden checkout", "localhost:8793/checkout", "local-checkout-identity"])(
    "finds local targets directly by %s",
    async (query) => {
      const target = device(
        "local-checkout-identity",
        "Hidden checkout",
        "http://localhost:8793/checkout",
      );
      const { onSelect } = await renderPicker([
        device("grok", "Grok", "https://grok.com/"),
        target,
      ]);
      await openPicker();
      await searchFor(query);

      expect(document.querySelector('[data-slot="dropdown-menu-sub-trigger"]')).toBeNull();
      expect(document.querySelector('[role="menuitem"][aria-label="Grok"]')).toBeNull();
      const match = document.querySelector<HTMLElement>(
        '[role="menuitem"][aria-label="Hidden checkout"]',
      )!;
      expect(match).not.toBeNull();
      await act(async () => match.click());
      await settle();
      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({ id: target.id, browserUrl: target.browserUrl, runnable: false }),
      );
      expect(trigger().textContent).toContain("Hidden checkout");
    },
  );

  it("keeps a previously selected local browser visible when the picker opens", async () => {
    await renderPicker(
      [
        device("grok", "Grok", "https://grok.com/"),
        device("local", "Local checkout", "http://[::1]:8793/"),
        device("other-local", "Other local browser", "http://localhost:3000/"),
      ],
      "local",
    );

    expect(trigger().textContent).toContain("Local checkout");
    await openPicker();
    const selected = document.querySelector(
      '[role="menuitem"][aria-label="Local checkout, selected"]',
    );
    expect(selected).not.toBeNull();
    expect(document.querySelector('[role="menu"]')?.textContent).toContain("Selected");
    expect(
      document.querySelector('[role="menuitem"][aria-label="Other local browser"]'),
    ).toBeNull();
  });

  it("retains browser configuration selection and hardware setup after an inventory refresh fails", async () => {
    const grok = device("grok", "Grok", "https://grok.com/");
    const docs = device("docs", "Relay docs", "https://relay.example/docs");
    const phone = device("phone", "My phone");
    const offlinePhone = {
      ...device("offline", "Offline phone"),
      status: "needs-attention" as const,
    };
    const items = [grok, docs, phone, offlinePhone];
    const { client, onSelect, list } = await renderPicker(items, "grok");
    await act(async () => client.refetchQueries({ queryKey: deviceQueryKeys.devices }));
    await settle();
    expect(list).toHaveBeenCalledOnce();
    expect(client.getQueryState(deviceQueryKeys.devices)?.status).toBe("success");
    await openPicker();
    expect(document.querySelector('[role="menuitem"][aria-label="My phone"]')).not.toBeNull();

    list.mockRejectedValueOnce(new Error("Hardware discovery unavailable"));
    await act(async () => client.refetchQueries({ queryKey: deviceQueryKeys.devices }));
    await settle();

    expect(client.getQueryState(deviceQueryKeys.devices)?.status).toBe("error");
    expect(client.getQueryData(deviceQueryKeys.devices)).toEqual(items);
    expect(trigger().textContent).toContain("Grok");
    expect(document.querySelector('[role="menuitem"][aria-label="Grok, selected"]')).not.toBeNull();
    expect(document.querySelector('[role="menuitem"][aria-label="My phone"]')).toBeNull();
    expect(document.querySelector('[role="menu"]')?.textContent).toContain(
      "Browser configurations are still available.",
    );
    const browser = document.querySelector<HTMLElement>(
      '[role="menuitem"][aria-label="Relay docs"]',
    )!;
    await act(async () => browser.click());
    await settle();
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: docs.id, browserUrl: docs.browserUrl, runnable: false }),
    );
    expect(onSelect.mock.calls[0]![0].runnable).toBe(false);
    expect(client.getQueryData(workspaceDestinationQueryKey)).toEqual({ targetId: "docs" });

    await openPicker();
    const setup = document.querySelector<HTMLElement>('[data-slot="dropdown-menu-sub-trigger"]')!;
    expect(setup.textContent).toContain("Devices");
    expect(setup.textContent).toContain("2");
    await act(async () => setup.click());
    await settle();
    const setupMenu = [...document.querySelectorAll('[role="menu"]')].find((menu) =>
      menu.textContent?.includes("Choose one to open its setup"),
    )!;
    expect(setupMenu.textContent).toContain("Offline phone");
    const phoneSetup = [...setupMenu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent?.trim() === "My phone",
    )!;
    await act(async () => phoneSetup.click());
    await settle();
    expect(route.push).toHaveBeenCalledWith("/devices/phone");
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it.each(["pending", "error"])(
    "offers canonical browser configurations on first load while hardware inventory is %s",
    async (inventoryState) => {
      let releaseInventory: ((devices: readonly ProductDevice[]) => void) | undefined;
      const inventory = new Promise<readonly ProductDevice[]>((resolve) => {
        releaseInventory = resolve;
      });
      const { client, onSelect, list, listSpaces } = await renderPicker([], "grok", {
        seedInventory: false,
        seedSpaces: false,
        spaces: [
          browserSpace("grok", "Grok", "https://grok.com/"),
          browserSpace("docs", "Relay docs", "https://relay.example/docs"),
        ],
        loadInventory: async () => {
          if (inventoryState === "error") throw new Error("Hardware discovery unavailable");
          return inventory;
        },
      });

      expect(list).toHaveBeenCalledOnce();
      expect(listSpaces).toHaveBeenCalledOnce();
      expect(client.getQueryState(deviceQueryKeys.devices)?.status).toBe(inventoryState);
      expect(trigger().textContent).toContain("Grok");
      await openPicker();
      expect(
        document.querySelector('[role="menuitem"][aria-label="Grok, selected"]'),
      ).not.toBeNull();
      const option = document.querySelector<HTMLElement>(
        '[role="menuitem"][aria-label="Relay docs"]',
      )!;
      expect(option).not.toBeNull();
      await act(async () => option.click());
      await settle();
      expect(onSelect.mock.calls[0]![0]).toMatchObject({
        id: "docs",
        serial: "docs",
        platform: "browser",
        status: "virtual",
        runnable: false,
        browserUrl: "https://relay.example/docs",
      });
      expect(client.getQueryData(workspaceDestinationQueryKey)).toEqual({ targetId: "docs" });
      expect(trigger().textContent).toContain("Relay docs");
      releaseInventory?.([]);
      await settle();
    },
  );
});
