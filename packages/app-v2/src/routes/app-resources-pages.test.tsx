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

    expect(document.querySelector("h1")?.textContent).toBe("Versions");
    expect(document.body.textContent).toContain("Builds Relay can run against.");
    expect(document.body.textContent).toContain("Checkout 3.4.0");
    expect(document.body.textContent).toContain("iOS · release · com.example.checkout");
    expect(document.body.textContent).not.toContain("build-private");
    expect(document.body.textContent).not.toContain("private-revision");
  });

  it("creates and edits versions through build.save and does not invent removal", async () => {
    const created: unknown[] = [];
    const updated: unknown[] = [];
    await render(
      "/apps/checkout-app/versions",
      resources({
        listVersions: async () => [
          {
            id: "build-private",
            name: "Checkout 3.4.0",
            platform: "ios",
            status: "ready",
            updatedAt: now,
          },
        ],
        createVersion: async (input) => {
          created.push(input);
          return { ...input, updatedAt: now };
        },
        updateVersion: async (input) => {
          updated.push(input);
          return { ...input, updatedAt: now };
        },
      }),
    );

    await click(button("Add version"));
    await fill(document.querySelector<HTMLInputElement>("#version-id")!, "checkout-ios-3-5");
    await fill(document.querySelector<HTMLInputElement>("#version-name")!, "Checkout 3.5.0");
    await click(button("Add version", document.querySelector('[role="dialog"]')!));
    expect(created).toEqual([
      {
        id: "checkout-ios-3-5",
        name: "Checkout 3.5.0",
        platform: "ios",
        status: "uploaded",
      },
    ]);
    expect(document.body.textContent).not.toContain("Remove version");

    await click(button("Edit"));
    await fill(document.querySelector<HTMLInputElement>("#version-name")!, "Checkout 3.4.1");
    await click(button("Save version", document.querySelector('[role="dialog"]')!));
    expect(updated).toEqual([
      {
        id: "build-private",
        name: "Checkout 3.4.1",
        platform: "ios",
        status: "ready",
      },
    ]);
  });

  it("keeps the version dialog open and reports canonical save failures", async () => {
    await render(
      "/apps/checkout-app/versions",
      resources({
        createVersion: async () => Promise.reject(new Error("revision conflict")),
      }),
    );

    await click(button("Add version"));
    await fill(document.querySelector<HTMLInputElement>("#version-id")!, "checkout-ios-3-5");
    await fill(document.querySelector<HTMLInputElement>("#version-name")!, "Checkout 3.5.0");
    await click(button("Add version", document.querySelector('[role="dialog"]')!));

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("revision conflict");
  });

  it("offers an existing browser when saving the first account", async () => {
    const opened: unknown[] = [];
    await render(
      "/apps/checkout-app/accounts",
      resources({
        listBrowserTargets: async () => [{ id: "first-browser", name: "First browser" }],
        saveBrowserAccount: async () => {
          throw new Error("capture failed");
        },
        openBrowserAccountForSignIn: async (input) => {
          opened.push(input);
        },
      }),
    );
    expect(button("Save sign-in").disabled).toBe(false);
    await click(button("Open headed browser"));
    expect(opened).toEqual([{ targetId: "first-browser" }]);
    expect(document.body.textContent).toContain("Complete OAuth in the browser, then Save sign-in");
    await click(button("Save sign-in"));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("First browser");
  });

  it("shows reviewed browser sign-ins with their true target ownership", async () => {
    const history = await render(
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

    expect(document.querySelector("h1")?.textContent).toBe("Sign-ins");
    expect(document.body.textContent).toContain("Check health before the daily Plan");
    expect(document.body.textContent).toContain("1 ready");
    expect(document.body.textContent).toContain("Staging buyer");
    expect(document.body.textContent).toContain("Checkout browser · https://checkout.example");
    expect(document.body.textContent).not.toContain("authfx:");
    expect(document.body.textContent).not.toContain("browser-private");
    const browserLink = document.querySelector<HTMLAnchorElement>(
      'a[href="/devices/browser-private"]',
    );
    expect(browserLink).not.toBeNull();
    await click(browserLink!);
    expect(history.location.pathname).toBe("/devices/browser-private");
  });

  it("saves, refreshes, and revokes accounts with exact target identity without rendering secrets", async () => {
    const saved: unknown[] = [];
    const refreshed: unknown[] = [];
    const revoked: unknown[] = [];
    await render(
      "/apps/checkout-app/accounts",
      resources({
        listBrowserAccounts: async () => [
          {
            target: { id: "browser-private", name: "Checkout browser" },
            fixture: {
              schemaVersion: 1,
              id: "fixture-1",
              reference: "authfx:fixture-1:1",
              revision: 1,
              projectId: "default",
              targetId: "browser-private",
              name: "Staging buyer",
              origins: ["https://checkout.example"],
              cookieCount: 3,
              createdAt: now,
            },
          },
        ],
        saveBrowserAccount: async (input) => {
          saved.push(input);
          return {} as never;
        },
        refreshBrowserAccount: async (input) => {
          refreshed.push(input);
          return {} as never;
        },
        revokeBrowserAccount: async (input) => {
          revoked.push(input);
          return {} as never;
        },
      }),
    );

    await click(button("Save sign-in"));
    await fill(document.querySelector<HTMLInputElement>("#account-name")!, "Reviewed buyer");
    await click(button("Save sign-in", document.querySelector('[role="dialog"]')!));
    expect(saved).toEqual([{ targetId: "browser-private", name: "Reviewed buyer" }]);

    await click(button("Refresh"));
    await click(button("Refresh sign-in", document.querySelector('[role="dialog"]')!));
    expect(refreshed).toEqual([
      { targetId: "browser-private", name: "Staging buyer", fixtureId: "fixture-1" },
    ]);

    await click(button("Revoke"));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "existing Runs keep their saved evidence",
    );
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "future authenticated Tests",
    );
    await click(button("Revoke sign-in", document.querySelector('[role="dialog"]')!));
    expect(revoked).toEqual([{ targetId: "browser-private", reference: "authfx:fixture-1:1" }]);
    expect(document.body.textContent).not.toContain("authfx:fixture-1:1");
  });

  it("checks sign-in health and opens a headed browser for OAuth", async () => {
    const probed: unknown[] = [];
    const opened: unknown[] = [];
    await render(
      "/apps/checkout-app/accounts",
      resources({
        listBrowserAccounts: async () => [
          {
            target: { id: "browser-private", name: "Checkout browser" },
            fixture: {
              id: "fixture-1",
              reference: "authfx:fixture-1:1",
              revision: 1,
              targetId: "browser-private",
              name: "Staging buyer",
              origins: ["https://checkout.example"],
              cookieCount: 3,
              createdAt: now,
              health: {
                status: "needs-relogin",
                checkedAt: now,
                signedIn: false,
              },
            },
          },
        ],
        probeBrowserAccount: async (input) => {
          probed.push(input);
          return {} as never;
        },
        openBrowserAccountForSignIn: async (input) => {
          opened.push(input);
        },
      }),
    );

    expect(document.body.textContent).toContain("need sign-in");
    expect(document.body.textContent).toContain("Needs relogin");
    await click(button("Check health"));
    expect(probed).toEqual([{ targetId: "browser-private", reference: "authfx:fixture-1:1" }]);
    await click(button("Sign in now"));
    expect(opened).toEqual([{ targetId: "browser-private", reference: "authfx:fixture-1:1" }]);
    expect(document.body.textContent).toContain("Complete OAuth in the browser, then Refresh");
  });

  it("hides revoked lab accounts and checks live health without inventing a second account", async () => {
    const probed: unknown[] = [];
    await render(
      "/apps/checkout-app/accounts",
      resources({
        listBrowserAccounts: async () => [
          {
            target: { id: "grok-com", name: "Grok.com" },
            fixture: {
              id: "7189423f-193e-45ed-b674-154505cc5107",
              reference: "authfx:7189423f-193e-45ed-b674-154505cc5107:1",
              revision: 1,
              targetId: "grok-com",
              name: "SuperGrok lab signed-in",
              origins: ["https://grok.com"],
              cookieCount: 33,
              createdAt: now,
              health: { status: "ready", checkedAt: now, signedIn: true },
            },
          },
          {
            target: { id: "grok-com", name: "Grok.com" },
            fixture: {
              id: "addeb648-90e6-43fe-9a6a-6e2c11d8bd09",
              reference: "authfx:addeb648-90e6-43fe-9a6a-6e2c11d8bd09:1",
              revision: 1,
              targetId: "grok-com",
              name: "P2.1 lab A",
              origins: ["https://grok.com"],
              cookieCount: 1,
              createdAt: now,
              revokedAt: now,
              health: { status: "revoked", checkedAt: now },
            },
          },
        ],
        listAccountLanes: async () => [
          { id: "grok-daily", targetId: "grok-com", kind: "signed-out" },
          {
            id: "grok-lab",
            targetId: "grok-com",
            kind: "fixture",
            reference: "authfx:7189423f-193e-45ed-b674-154505cc5107:1",
          },
        ],
        probeBrowserAccountHealth: async (input) => {
          probed.push(input);
          return {
            accounts: [],
            summary: {
              liveCount: 1,
              revokedCount: 1,
              concurrentAccountsPossible: false,
              concurrentReason: "One live account.",
              lanes: [],
            },
          };
        },
        probeBrowserAccount: async () => ({}) as never,
      }),
    );

    expect(document.body.textContent).toContain("SuperGrok lab signed-in");
    expect(document.body.textContent).toContain("Lane grok-lab");
    expect(document.body.textContent).toContain("One live account");
    expect(document.body.textContent).not.toContain("P2.1 lab A");
    await click(button("Show 1 revoked"));
    expect(document.body.textContent).toContain("P2.1 lab A");
    await click(button("Check live health"));
    expect(probed).toEqual([{ targetId: "grok-com" }]);
  });

  it("does not show account mutations when the adapter is read-only", async () => {
    await render(
      "/apps/checkout-app/accounts",
      resources({
        listBrowserAccounts: async () => [
          {
            target: { id: "browser-private", name: "Checkout browser" },
            fixture: {
              schemaVersion: 1,
              id: "fixture-1",
              reference: "authfx:fixture-1:1",
              revision: 1,
              projectId: "default",
              targetId: "browser-private",
              name: "Staging buyer",
              origins: [],
              cookieCount: 0,
              createdAt: now,
            },
          },
        ],
      }),
    );

    expect(button("Save sign-in").disabled).toBe(true);
    expect(document.querySelector('button[aria-label="Refresh Staging buyer"]')).toBeNull();
    expect(document.querySelector('button[aria-label="Revoke Staging buyer"]')).toBeNull();
    expect(document.querySelector('button[aria-label="Check health of Staging buyer"]')).toBeNull();
    expect(document.querySelector('button[aria-label="Sign in now for Staging buyer"]')).toBeNull();
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
    expect(alert?.textContent).toContain("Could not load resources");
    expect(alert?.textContent).toContain(`try loading ${subject} again`);
    expect(alert?.querySelectorAll("button")).toHaveLength(1);
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
