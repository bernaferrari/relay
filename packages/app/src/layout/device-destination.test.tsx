/** @jsxImportSource react */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
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

async function renderPicker(devices: readonly ProductDevice[], selectedTargetId?: string) {
  const client = new QueryClient();
  clients.push(client);
  client.setQueryData(deviceQueryKeys.devices, devices);
  client.setQueryData(
    workspaceDestinationQueryKey,
    selectedTargetId ? { targetId: selectedTargetId } : null,
  );
  const set = vi.fn();
  const onSelect = vi.fn();
  route.context = {
    deviceService: { list: async () => devices },
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
  return { client, set, onSelect };
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

    expect(onSelect).toHaveBeenCalledWith(local[7]);
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
      expect(onSelect).toHaveBeenCalledWith(target);
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
    expect(document.querySelector('[role="menuitem"][aria-label="Other local browser"]')).toBeNull();
  });
});
