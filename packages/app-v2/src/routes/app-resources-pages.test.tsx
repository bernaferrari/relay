/** @jsxImportSource react */
import { createMemoryHistory } from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { RelayV2App } from "../app";
import type { AppResourcesProductService } from "../data/app-resources-product-service";
import type { CatalogProductService } from "../data/catalog-product-service";
import type { MapProductService } from "../data/map-product-service";
import type { RecordingProductService } from "../data/recording-product-service";
import type { RunProductService } from "../data/run-product-service";
import type { Platform } from "../platform/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
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
});

async function render(
  path: string,
  appResourcesService: AppResourcesProductService,
  recordingService: RecordingProductService = productService,
) {
  const history = createMemoryHistory({ initialEntries: [path] });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <RelayV2App
        platform={platform}
        history={history}
        productService={recordingService}
        catalogService={catalogService}
        mapService={mapService}
        appResourcesService={appResourcesService}
        runService={{} as RunProductService}
      />,
    );
  });
  await settle();
  return history;
}

function resources(
  overrides: Partial<AppResourcesProductService> = {},
): AppResourcesProductService {
  return {
    createApp: async (name) => ({ id: "created-app", name }),
    listVersions: async () => [],
    listBrowserAccounts: async () => [],
    ...overrides,
  };
}

describe("App routes", () => {
  it("lists production apps and creates an App through the canonical service", async () => {
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
    expect(document.body.textContent).toContain("1 Test · Last run");
    expect(document.querySelector('a[href="/apps/checkout-app"]')).not.toBeNull();
    await click(button("Add App"));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await fill(document.querySelector<HTMLInputElement>("#new-app-name")!, "Inventory");
    await click(button("Add App", document.querySelector('[role="dialog"]')!));

    expect(created).toEqual(["Inventory"]);
    expect(history.location.pathname).toBe("/apps/inventory-app");
  });

  it("uses one centered recovery message when apps cannot load", async () => {
    await render("/apps", resources(), {
      listApps: async () => Promise.reject(new Error("offline")),
    } as RecordingProductService);
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 1_100))));
    await settle();

    const alert = document.querySelector('[role="alert"]');
    expect(alert?.classList.contains("relay-recovery-state--centered")).toBe(true);
    expect(alert?.textContent).toContain("Relay is not connected");
    expect(alert?.textContent).toContain("Start Relay, then try loading your apps again.");
    expect(alert?.querySelectorAll("button")).toHaveLength(1);
  });

  it("shows real workspace builds without inventing an App association", async () => {
    await render(
      "/apps/checkout-app/versions",
      resources({
        listVersions: async () => [
          {
            id: "build-private",
            name: "Checkout 3.4.0",
            platform: "ios",
            status: "ready",
            applicationId: "com.example.checkout",
            configuration: "release",
            sourceSha: "private-revision",
            updatedAt: now,
          },
        ],
      }),
    );

    expect(document.body.textContent).toContain("Registered versions");
    expect(document.body.textContent).toContain("Builds are project-scoped");
    expect(document.body.textContent).toContain("Checkout 3.4.0");
    expect(document.body.textContent).toContain("iOS · release · com.example.checkout");
    expect(document.body.textContent).not.toContain("build-private");
    expect(document.body.textContent).not.toContain("private-revision");
  });

  it("shows reviewed browser sign-ins with their true target ownership", async () => {
    await render(
      "/apps/checkout-app/accounts",
      resources({
        listBrowserAccounts: async () => [
          {
            target: { id: "browser-private", name: "Checkout browser" },
            fixture: {
              schemaVersion: 1,
              id: "1da46c45-cf4d-43fb-bb5f-1bd2fe761154",
              reference: "authfx:1da46c45-cf4d-43fb-bb5f-1bd2fe761154:1",
              revision: 1,
              projectId: "default",
              targetId: "browser-private",
              name: "Staging buyer",
              origins: ["https://checkout.example"],
              cookieCount: 3,
              createdAt: now,
              createdBy: "human:test",
            },
          },
        ],
      }),
    );

    expect(document.body.textContent).toContain("Saved browser sign-ins");
    expect(document.body.textContent).toContain("Sign-ins belong to an exact managed browser");
    expect(document.body.textContent).toContain("Staging buyer");
    expect(document.body.textContent).toContain("Checkout browser · https://checkout.example");
    expect(document.body.textContent).not.toContain("authfx:");
    expect(document.body.textContent).not.toContain("browser-private");
  });

  it.each([
    ["/apps/checkout-app/versions", "registered versions", "listVersions"],
    ["/apps/checkout-app/accounts", "saved browser sign-ins", "listBrowserAccounts"],
  ] as const)("uses the centered recovery pattern on %s", async (path, subject, method) => {
    await render(path, resources({ [method]: async () => Promise.reject(new Error("offline")) }));
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 1_100))));
    await settle();

    const alert = document.querySelector('[role="alert"]');
    expect(alert?.classList.contains("relay-recovery-state--centered")).toBe(true);
    expect(alert?.textContent).toContain("Relay is not connected");
    expect(alert?.textContent).toContain(`try loading ${subject} again`);
    expect(alert?.querySelectorAll("button")).toHaveLength(1);
    expect(document.body.textContent).toContain("Checkout");
  });
});

function button(name: string, root: ParentNode = document): HTMLButtonElement {
  const match = [...root.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (!(match instanceof HTMLButtonElement)) throw new TypeError(`Button not found: ${name}`);
  return match;
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
