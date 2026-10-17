/** @jsxImportSource react */
import { createMemoryHistory } from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RelayApp } from "../app";
import type { AppResourcesProductService } from "../data/app-resources-product-service";
import type { BrowserSpacesProductService } from "../data/browser-spaces-product-service";
import type { CatalogProductService } from "../data/catalog-product-service";
import type { MapProductService } from "../data/map-product-service";
import type { RecordingProductService } from "../data/recording-product-service";
import type { RunProductService } from "../data/run-product-service";
import type { Platform } from "../platform/types";
import type { LiveTargetSession, LiveTargetSnapshot } from "../data/live-target-session";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
beforeEach(() => {
  // Route services are fakes; shell queries must not contact the running Relay server.
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline test fixture")));
});
const now = Date.now();
const platform: Platform = {
  platform: "web",
  getServerUrl: () => "http://127.0.0.1:8787",
  storage: { get: () => null, set: () => undefined, remove: () => undefined },
};
const productService = {
  listApps: async () => [
    { id: "checkout-app", name: "Checkout" },
    { id: "support-app", name: "Support" },
  ],
} as unknown as RecordingProductService;
const catalogService: CatalogProductService = {
  listTests: async () => [
    {
      id: "checkout-test",
      name: "Complete checkout",
      appMapId: "checkout-app",
      appName: "Checkout",
      stepCount: 3,
      status: "ready",
      updatedAt: now,
      href: "/tests/checkout-test",
    },
  ],
  getTest: async () => undefined,
  listRuns: async () => [
    {
      id: "checkout-run",
      title: "Complete checkout",
      action: "Open report",
      status: "completed",
      phase: "completed",
      outcome: "passed",
      appMapId: "checkout-app",
      queuedAt: now - 60_000,
      finishedAt: now - 30_000,
      identity: { runId: "checkout-run", appMapId: "checkout-app" },
      links: { self: "/runs/checkout-run", app: "/apps/checkout-app" },
    },
  ],
  getRun: async () => undefined,
};
const mapService: MapProductService = {
  get: async (appMapId) => ({
    appMapId,
    appName: appMapId === "checkout-app" ? "Checkout" : "Support",
    revision: 1,
    screens: [],
    paths: [],
    coverage: {
      screenCount: 0,
      coveredScreenCount: 0,
      pathCount: 0,
      coveredPathCount: 0,
      testCount: 0,
    },
    pendingProposalCount: 0,
    navigation: { route: "/apps/:appId/map", href: `/apps/${appMapId}/map` },
  }),
};

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

async function render(
  path: string,
  appResourcesService: AppResourcesProductService,
  recordingService: RecordingProductService = productService,
  browserSpacesService: BrowserSpacesProductService = browserSpaces(),
) {
  const history = createMemoryHistory({ initialEntries: [path] });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <RelayApp
        platform={platform}
        history={history}
        productService={recordingService}
        catalogService={catalogService}
        mapService={mapService}
        appResourcesService={appResourcesService}
        runService={{} as RunProductService}
        browserSpacesService={browserSpacesService}
      />,
    );
  });
  await settle();
  return history;
}

function browserSpaces(
  overrides: Partial<BrowserSpacesProductService> = {},
): BrowserSpacesProductService {
  return {
    listSpaces: async () => [],
    ...overrides,
  } as BrowserSpacesProductService;
}

function resources(
  overrides: Partial<AppResourcesProductService> = {},
): AppResourcesProductService {
  return {
    createApp: async (name) => ({ id: "created-app", name }),
    listBrowserAccounts: async () => [],
    ...overrides,
  };
}

describe("App routes", () => {
  it("lists production apps and creates an app through the canonical service", async () => {
    const created: string[] = [];
    const history = await render(
      "/apps",
      resources({
        createApp: async (name) => {
          created.push(name);
          return { id: "inventory-app", name };
        },
      }),
    );

    expect(document.body.textContent).toContain("Checkout");
    expect(document.body.textContent).toContain("1 test · Last run");
    expect(document.querySelector('a[href="/tests?app=checkout-app"]')).not.toBeNull();
    await click(button("Add app"));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await fill(document.querySelector<HTMLInputElement>("#new-app-name")!, "Inventory");
    await click(button("Add app", document.querySelector('[role="dialog"]')!));

    expect(created).toEqual(["Inventory"]);
    expect(history.location.pathname).toBe("/tests/new");
    expect(history.location.search).toBe("?app=inventory-app");
  });

  it("uses one centered recovery message when apps cannot load", async () => {
    await render("/apps", resources(), {
      listApps: async () => Promise.reject(new Error("offline")),
    } as RecordingProductService);
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 1_100))));
    await settle();

    const alert = document.querySelector('[role="alert"]');
    expect(alert?.getAttribute("data-slot")).toBe("recovery-centered");
    expect(alert?.textContent).toContain("Relay is not connected");
    expect(alert?.textContent).toContain("Start Relay, then try loading your apps again.");
    expect(alert?.querySelectorAll("button")).toHaveLength(1);
  });

  it("sends old Accounts links to Devices, where browser sign-ins live", async () => {
    const history = await render("/accounts", resources());
    expect(history.location.pathname).toBe("/devices");
  });
});

function button(name: string, root: ParentNode = document): HTMLButtonElement {
  const match = [...root.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (!(match instanceof HTMLButtonElement)) throw new TypeError(`Button not found: ${name}`);
  return match;
}

function accountPreview(
  target: LiveTargetSnapshot["target"],
  input: LiveTargetSession["input"],
  frame?: { sessionId: string; frameSequence: number },
): LiveTargetSession {
  let snapshot: LiveTargetSnapshot = { status: "connecting", target };
  const listeners = new Set<(snapshot: LiveTargetSnapshot) => void>();
  return {
    snapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    mount(canvas) {
      canvas.width = 320;
      canvas.height = 240;
      snapshot = {
        status: "streaming",
        target,
        frameSequence: frame?.frameSequence ?? 1,
        browserContext: {
          sessionId: frame?.sessionId ?? `session:${target.targetId}`,
          engine: "chromium",
          viewport: { width: 320, height: 240 },
          locale: "en-US",
        },
      };
      listeners.forEach((listener) => listener(snapshot));
      return () => {};
    },
    input,
    close() {
      listeners.clear();
    },
  };
}

async function tapAccountPreview(canvas: HTMLCanvasElement) {
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 320, height: 240 }) as DOMRect;
  canvas.setPointerCapture = () => {};
  await act(async () => {
    canvas.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, clientX: 80, clientY: 100 }),
    );
    canvas.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 80, clientY: 100 }));
  });
  await settle();
}

async function menuItem(trigger: string, label: string) {
  const opener = document.querySelector<HTMLElement>(`button[aria-label="${trigger}"]`);
  if (!opener) throw new TypeError(`Menu not found: ${trigger}`);
  await click(opener);
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!item) throw new TypeError(`Menu item not found: ${label}`);
  await click(item);
}

async function click(target: HTMLElement) {
  await act(async () => target.click());
  await settle();
}

async function fill(target: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(target, value);
    target.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

async function settle() {
  for (let index = 0; index < 5; index += 1) {
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
  }
}
