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
    listVersions: async () => [],
    listBrowserAccounts: async () => [],
    ...overrides,
  };
}

describe("App routes", () => {
  it("signs in inline using one website choice and a fresh isolated browser per account", async () => {
    const external = vi.fn(async () => {});
    const saved = vi.fn(async () => ({}) as never);
    const input = vi.fn(async () => {});
    const preview = vi.fn(async (target) => accountPreview(target, input));
    const createSpace = vi.fn(
      async () => ({ id: `account-browser-${createSpace.mock.calls.length}` }) as never,
    );
    const openSpace = vi.fn(async ({ spaceId }) => ({
      targetId: spaceId,
      name: "Checkout",
      url: "https://checkout.example/",
      sessionId: `session:${spaceId}`,
      configurationDigest: `config:${spaceId}`,
    }));
    await render(
      "/accounts",
      resources({
        listBrowserTargets: async () =>
          Array.from({ length: 40 }, (_, index) => ({
            id: `old-browser-${index}`,
            name: `Checkout browser ${index}`,
            startUrl: "https://checkout.example/",
          })),
        saveBrowserAccount: saved,
        openBrowserAccountForSignIn: external,
      }),
      {
        ...productService,
        previewTarget: preview,
        inspectTargetHealth: async () => ({ input: { state: "ready" } }),
      },
      browserSpaces({ createSpace, openSpace }),
    );
    for (const name of ["Member", "Admin"]) {
      await click(button("Add account"));
      const dialog = document.querySelector('[role="dialog"]')!;
      expect(dialog.querySelectorAll('[role="radio"]').length).toBe(2);
      await click(button("Open to sign in", dialog));
      const canvas = dialog.querySelector<HTMLCanvasElement>(
        'canvas[data-slot="capture-live-target"]',
      );
      expect(canvas).not.toBeNull();
      const id = `account-browser-${createSpace.mock.calls.length}`;
      expect(openSpace).toHaveBeenLastCalledWith({ spaceId: id, presentation: "embedded" });
      expect(preview).toHaveBeenLastCalledWith(
        expect.objectContaining({ kind: "browser", targetId: id }),
        { sessionId: `session:${id}`, configurationDigest: `config:${id}` },
      );
      await tapAccountPreview(canvas!);
      await fill(document.querySelector<HTMLInputElement>("#account-name")!, name);
      await click(button("Save account", dialog));
      expect(saved).toHaveBeenLastCalledWith({ targetId: id, name });
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    }
    expect(createSpace).toHaveBeenCalledTimes(2);
    expect(input).toHaveBeenCalledTimes(2);
    expect(external).not.toHaveBeenCalled();
  });

  it("keeps Save account fenced after an unconfirmed inline sign-in click", async () => {
    const saved = vi.fn(async () => ({}) as never);
    const input = vi.fn(async () => {
      throw Object.assign(new Error("lost response"), { mutationId: "account-input-1" });
    });
    const reconcile = vi.fn(async () => ({
      mutationId: "account-input-1",
      outcome: "applied" as const,
      health: { state: "ready" as const },
    }));
    await render(
      "/accounts",
      resources({ saveBrowserAccount: saved }),
      {
        ...productService,
        previewTarget: async (target) => accountPreview(target, input),
        inspectTargetHealth: async () => ({ input: { state: "ready" } }),
        reconcileInput: reconcile,
      },
      browserSpaces({
        createSpace: async () => ({ id: "new-account" }) as never,
        openSpace: async () => ({
          targetId: "new-account",
          name: "Checkout",
          url: "https://checkout.example/",
          sessionId: "session:new-account",
        }),
      }),
    );
    await click(button("Add account"));
    await fill(document.querySelector<HTMLInputElement>("#account-website")!, "checkout.example");
    await click(button("Open to sign in"));
    await fill(document.querySelector<HTMLInputElement>("#account-name")!, "Member");
    const dialog = document.querySelector('[role="dialog"]')!;
    const canvas = dialog.querySelector<HTMLCanvasElement>("canvas")!;
    expect(canvas).not.toBeNull();
    await tapAccountPreview(canvas);
    expect(button("Save account", dialog).disabled).toBe(true);
    await tapAccountPreview(canvas);
    expect(input).toHaveBeenCalledTimes(1);
    expect(saved).not.toHaveBeenCalled();
    await click(button("It applied", dialog));
    expect(reconcile).toHaveBeenCalledWith(
      expect.objectContaining({ serial: "new-account", mutationId: "account-input-1" }),
    );
    expect(button("Save account", dialog).disabled).toBe(false);
    await click(button("Save account", dialog));
    expect(saved).toHaveBeenCalledWith({ targetId: "new-account", name: "Member" });
  });

  it.each([
    { sessionId: "another-session", frameSequence: 1 },
    { sessionId: "session:new-account", frameSequence: 0 },
  ])("does not save from a foreign session or before its first frame: %j", async (frame) => {
    const saved = vi.fn(async () => ({}) as never);
    const input = vi.fn(async () => {});
    await render(
      "/accounts",
      resources({ saveBrowserAccount: saved }),
      { ...productService, previewTarget: async (target) => accountPreview(target, input, frame) },
      browserSpaces({
        createSpace: async () => ({ id: "new-account" }) as never,
        openSpace: async () => ({
          targetId: "new-account",
          name: "Checkout",
          url: "https://checkout.example/",
          sessionId: "session:new-account",
        }),
      }),
    );
    await click(button("Add account"));
    await fill(document.querySelector<HTMLInputElement>("#account-website")!, "checkout.example");
    await click(button("Open to sign in"));
    await fill(document.querySelector<HTMLInputElement>("#account-name")!, "Member");
    expect(button("Save account").disabled).toBe(true);
    await tapAccountPreview(document.querySelector<HTMLCanvasElement>("canvas")!);
    expect(input).not.toHaveBeenCalled();
    expect(saved).not.toHaveBeenCalled();
  });

  it("fences Save against a same-turn pending sign-in input", async () => {
    let finish!: () => void;
    const input = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const saved = vi.fn(async () => ({}) as never);
    await render(
      "/accounts",
      resources({ saveBrowserAccount: saved }),
      { ...productService, previewTarget: async (target) => accountPreview(target, input) },
      browserSpaces({
        createSpace: async () => ({ id: "new-account" }) as never,
        openSpace: async () => ({
          targetId: "new-account",
          name: "Checkout",
          url: "https://checkout.example/",
          sessionId: "session:new-account",
        }),
      }),
    );
    await click(button("Add account"));
    await fill(document.querySelector<HTMLInputElement>("#account-website")!, "checkout.example");
    await click(button("Open to sign in"));
    await fill(document.querySelector<HTMLInputElement>("#account-name")!, "Member");
    const canvas = document.querySelector<HTMLCanvasElement>("canvas")!;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 320, height: 240 }) as DOMRect;
    canvas.setPointerCapture = () => {};
    await act(async () => {
      canvas.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, clientX: 80, clientY: 100 }),
      );
      canvas.dispatchEvent(
        new MouseEvent("pointerup", { bubbles: true, clientX: 80, clientY: 100 }),
      );
      button("Save account").click();
    });
    expect(saved).not.toHaveBeenCalled();
    expect(button("Save account").disabled).toBe(true);
    await act(async () => finish());
    await settle();
    expect(button("Save account").disabled).toBe(false);
  });

  it("opens the same sign-in profile externally and waits for its new exact preview session", async () => {
    let connect!: (session: LiveTargetSession) => void;
    const nextPreview = new Promise<LiveTargetSession>((resolve) => {
      connect = resolve;
    });
    const input = vi.fn(async () => {});
    const preview = vi
      .fn()
      .mockImplementationOnce(async (target) => accountPreview(target, input))
      .mockImplementationOnce(() => nextPreview);
    const openSpace = vi
      .fn()
      .mockResolvedValueOnce({
        targetId: "new-account",
        name: "Checkout",
        url: "https://checkout.example/",
        sessionId: "session:new-account",
        configurationDigest: "same-profile",
      })
      .mockResolvedValueOnce({
        targetId: "new-account",
        name: "Checkout",
        url: "https://checkout.example/",
        sessionId: "headed-session",
        configurationDigest: "same-profile",
      });
    const createSpace = vi.fn(async () => ({ id: "new-account" }) as never);
    await render(
      "/accounts",
      resources({ saveBrowserAccount: async () => ({}) as never }),
      { ...productService, previewTarget: preview },
      browserSpaces({ createSpace, openSpace }),
    );
    await click(button("Add account"));
    await fill(document.querySelector<HTMLInputElement>("#account-website")!, "checkout.example");
    await click(button("Open to sign in"));
    await fill(document.querySelector<HTMLInputElement>("#account-name")!, "Member");
    expect(button("Save account").disabled).toBe(false);
    await click(button("Open browser window"));
    expect(createSpace).toHaveBeenCalledTimes(1);
    expect(openSpace).toHaveBeenLastCalledWith({
      spaceId: "new-account",
      presentation: "external",
    });
    expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ targetId: "new-account" }), {
      sessionId: "headed-session",
      configurationDigest: "same-profile",
    });
    expect(button("Save account").disabled).toBe(true);
    await act(async () =>
      connect(
        accountPreview({ kind: "browser", platform: "browser", targetId: "new-account" }, input, {
          sessionId: "headed-session",
          frameSequence: 1,
        }),
      ),
    );
    await settle();
    expect(button("Save account").disabled).toBe(false);
  });

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
    expect(alert?.getAttribute("data-slot")).toBe("recovery-centered");
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

  it("explains accounts in one sentence and adds one through a live sign-in", async () => {
    const opened: unknown[] = [];
    const saved: unknown[] = [];
    await render(
      "/apps/checkout-app/accounts",
      resources({
        listBrowserTargets: async () => [
          { id: "first-browser", name: "Checkout browser", startUrl: "https://checkout.example/" },
        ],
        saveBrowserAccount: async (input) => {
          saved.push(input);
          return {} as never;
        },
        openBrowserAccountForSignIn: async (input) => {
          opened.push(input);
        },
      }),
      {
        ...productService,
        previewTarget: async (target) => accountPreview(target, async () => {}),
      },
      browserSpaces({
        createSpace: async () => ({ id: "isolated-checkout" }) as never,
        openSpace: async () => ({
          targetId: "isolated-checkout",
          name: "Checkout",
          url: "https://checkout.example/",
          sessionId: "session:isolated-checkout",
        }),
      }),
    );

    expect(document.querySelector("h1")?.textContent).toBe("Accounts");
    expect(document.body.textContent).toContain("Logins your tests can run as.");
    await click(button("Add account"));
    const dialog = () => document.querySelector('[role="dialog"]')!;
    expect(dialog().textContent).toContain("checkout.example");
    expect(dialog().textContent).toContain("Another website");
    await click(button("Open to sign in", dialog()));
    expect(opened).toEqual([]);
    expect(dialog().textContent).toContain("Sign in to checkout.example");
    await fill(document.querySelector<HTMLInputElement>("#account-name")!, "Staging buyer");
    await click(button("Save account", dialog()));
    expect(saved).toEqual([{ targetId: "isolated-checkout", name: "Staging buyer" }]);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("adds an account for a website that has no browser yet", async () => {
    const created: unknown[] = [];
    const opened: unknown[] = [];
    await render(
      "/accounts",
      resources({
        saveBrowserAccount: async () => ({}) as never,
        openBrowserAccountForSignIn: async (input) => {
          opened.push(input);
        },
      }),
      {
        ...productService,
        previewTarget: async (target) => accountPreview(target, async () => {}),
      },
      browserSpaces({
        createSpace: async (input) => {
          created.push(input);
          return { id: "new-browser" } as never;
        },
        openSpace: async (input) => {
          opened.push(input);
          return {
            targetId: "new-browser",
            name: "App",
            url: "https://app.example.com/",
            sessionId: "session:new-browser",
          };
        },
      }),
    );

    await click(button("Add account"));
    await fill(document.querySelector<HTMLInputElement>("#account-website")!, "app.example.com");
    await click(button("Open to sign in", document.querySelector('[role="dialog"]')!));
    expect(created).toEqual([
      { name: "app.example.com", startUrl: "https://app.example.com/", profileRetention: "retain" },
    ]);
    expect(opened).toEqual([{ spaceId: "new-browser", presentation: "embedded" }]);
  });

  it("shows each account by name, website, sign-in method, status, and last use", async () => {
    await render(
      "/apps/checkout-app/accounts",
      resources({
        listBrowserAccounts: async () => [
          {
            target: {
              id: "browser-private",
              name: "Checkout browser",
              startUrl: "https://checkout.example/login",
            },
            fixture: {
              id: "fixture-1",
              reference: "authfx:fixture-1:1",
              revision: 1,
              targetId: "browser-private",
              name: "Staging buyer",
              origins: ["https://checkout.example", "https://accounts.google.com"],
              cookieCount: 3,
              createdAt: now,
            },
          },
        ],
      }),
    );

    const card = document.querySelector('li[aria-label="Staging buyer on checkout.example"]');
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain("Signed in");
    expect(card?.textContent).toContain("Signs in with Google");
    expect(card?.textContent).toContain("Saved today");
    for (const hidden of ["authfx:", "browser-private", "fixture", "Lane", "lane"]) {
      expect(document.body.textContent).not.toContain(hidden);
    }
    const newTest = card!.querySelector<HTMLAnchorElement>(
      'a[aria-label="New test as this account"]',
    );
    expect(newTest?.getAttribute("href")).toContain("/tests/new?");
    expect(newTest?.getAttribute("href")).toContain("account=fixture-1");
    expect(newTest?.getAttribute("href")).toContain("checkout.example");
  });

  it("opens an account signed in, signs in again, checks, and revokes it", async () => {
    const openedSpaces: unknown[] = [];
    const signIns: unknown[] = [];
    const refreshed: unknown[] = [];
    const probed: unknown[] = [];
    const revoked: unknown[] = [];
    const history = await render(
      "/accounts",
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
              health: { status: "needs-relogin", checkedAt: now, signedIn: false },
            },
          },
        ],
        openBrowserAccountForSignIn: async (input) => {
          signIns.push(input);
        },
        refreshBrowserAccount: async (input) => {
          refreshed.push(input);
          return {} as never;
        },
        probeBrowserAccount: async (input) => {
          probed.push(input);
          return {} as never;
        },
        revokeBrowserAccount: async (input) => {
          revoked.push(input);
          return {} as never;
        },
      }),
      productService,
      browserSpaces({
        openSpace: async (input) => {
          openedSpaces.push(input);
          return { targetId: "browser-private", name: "Checkout browser", url: "" };
        },
      }),
    );

    expect(document.body.textContent).toContain("Needs sign-in");
    expect(document.body.textContent).toContain("1 account needs sign-in");

    await click(button("Sign in again"));
    expect(signIns).toEqual([{ targetId: "browser-private", reference: "authfx:fixture-1:1" }]);
    expect(document.body.textContent).toContain("Finish signing in to checkout.example");
    await click(button("Save sign-in"));
    expect(refreshed).toEqual([
      { targetId: "browser-private", name: "Staging buyer", fixtureId: "fixture-1" },
    ]);

    await menuItem("More actions for Staging buyer", "Check sign-in now");
    expect(probed).toEqual([{ targetId: "browser-private", reference: "authfx:fixture-1:1" }]);

    await menuItem("More actions for Staging buyer", "Revoke…");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "Tests can no longer run as this account",
    );
    await click(button("Revoke account", document.querySelector('[role="dialog"]')!));
    expect(revoked).toEqual([{ targetId: "browser-private", reference: "authfx:fixture-1:1" }]);

    await menuItem("More actions for Staging buyer", "Open signed in");
    expect(openedSpaces).toEqual([
      {
        spaceId: "browser-private",
        presentation: "embedded",
        account: { kind: "fixture", reference: "authfx:fixture-1:1" },
      },
    ]);
    expect(history.location.pathname).toBe("/devices/browser-private");
  });

  it("hides revoked accounts and uses the probed identity as the name", async () => {
    const probed: unknown[] = [];
    await render(
      "/apps/checkout-app/accounts",
      resources({
        listBrowserAccounts: async () => [
          {
            target: { id: "grok-com", name: "Grok.com", startUrl: "https://grok.com/" },
            fixture: {
              id: "7189423f-193e-45ed-b674-154505cc5107",
              reference: "authfx:7189423f-193e-45ed-b674-154505cc5107:1",
              revision: 1,
              targetId: "grok-com",
              name: "SuperGrok lab signed-in",
              origins: ["https://grok.com"],
              cookieCount: 33,
              createdAt: now,
              health: { status: "ready", checkedAt: now, signedIn: true, identity: "lab@x.ai" },
            },
          },
          {
            target: { id: "grok-com", name: "Grok.com", startUrl: "https://grok.com/" },
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
        probeBrowserAccountHealth: async (input) => {
          probed.push(input);
          return {
            accounts: [],
            summary: {
              liveCount: 1,
              revokedCount: 1,
              concurrentAccountsPossible: false,
              concurrentReason: "",
              lanes: [],
            },
          };
        },
      }),
    );

    expect(document.body.textContent).toContain("lab@x.ai");
    expect(document.body.textContent).toContain("Saved as SuperGrok lab signed-in");
    expect(document.body.textContent).toContain("Checked today");
    expect(document.body.textContent).not.toContain("P2.1 lab A");
    await click(button("Show 1 revoked"));
    expect(document.body.textContent).toContain("P2.1 lab A");
    expect(document.body.textContent).toContain("Revoked");
    await click(button("Check all"));
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
              id: "fixture-1",
              reference: "authfx:fixture-1:1",
              revision: 1,
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

    expect(button("Add account").disabled).toBe(true);
    for (const label of [
      "Refresh sign-in for Staging buyer",
      "Revoke Staging buyer",
      "Check Staging buyer",
    ]) {
      expect(document.querySelector(`button[aria-label="${label}"]`)).toBeNull();
    }
  });

  it.each([
    ["/apps/checkout-app/versions", "registered versions", "listVersions"],
    ["/apps/checkout-app/accounts", "saved accounts", "listBrowserAccounts"],
  ] as const)("uses the centered recovery pattern on %s", async (path, subject, method) => {
    await render(path, resources({ [method]: async () => Promise.reject(new Error("offline")) }));
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 1_100))));
    await settle();

    const alert = document.querySelector('[role="alert"]');
    expect(alert?.getAttribute("data-slot")).toBe("recovery-centered");
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
