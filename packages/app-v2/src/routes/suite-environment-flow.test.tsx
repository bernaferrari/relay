/** @jsxImportSource react */
import { createMemoryHistory } from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RelayV2App } from "../app";
import type { RecordingProductService } from "../data/recording-product-service";
import type {
  ProductEnvironmentProfile,
  ProductSuite,
  ProductSuiteEditor,
  ProductSuitePreview,
  SuiteProfileProductService,
} from "../data/suite-profile-product-service";
import type {
  BrowserSpacesProductService,
  ProductBrowserAuthFixture,
  ProductBrowserSpace,
} from "../data/browser-spaces-product-service";
import type { Platform } from "../platform/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

const platform: Platform = {
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
  storage: {
    get: () => null,
    set: () => undefined,
    remove: () => undefined,
  },
};

const suite: ProductSuite = {
  id: "suite-1",
  appMapId: "app-1",
  appMapRevision: 7,
  appName: "Checkout",
  name: "Release smoke",
  testIds: ["test-1"],
  tests: [{ id: "test-1", name: "Complete checkout", status: "ready" }],
  variableIds: [],
  strategy: "cartesian",
  source: { kind: "app-map-combine", id: "suite-1" },
};

const editor: ProductSuiteEditor = {
  appMapId: "app-1",
  appName: "Checkout",
  revision: 7,
  tests: [{ id: "test-1", name: "Complete checkout", status: "ready" }],
  dataSets: [],
};

const space: ProductBrowserSpace = {
  id: "space-1",
  name: "Staging browser",
  startUrl: "https://staging.example.test",
  createdAt: 1,
  updatedAt: 2,
  profileRetention: "retain",
  persistent: true,
  source: { kind: "managed-browser-target", id: "space-1" },
};

const environment: ProductEnvironmentProfile = {
  id: "space-1",
  name: "Staging browser",
  targetId: "space-1",
  source: { kind: "managed-target", id: "space-1" },
  target: {
    id: "space-1",
    name: "Staging browser",
    kind: "browser",
    browser: { startUrl: space.startUrl },
  },
  platform: "browser",
  authenticationOptions: [],
  buildOptions: [],
};

const fixture: ProductBrowserAuthFixture = {
  id: "fixture-1",
  reference: "authfx:fixture-1:1",
  revision: 1,
  targetId: "space-1",
  name: "Staging account",
  origins: ["https://staging.example.test"],
  cookieCount: 2,
  createdAt: 1,
};

function suitePreview(blockers: ProductSuitePreview["blockers"] = []): ProductSuitePreview {
  return {
    suite,
    environment,
    caseCount: 1,
    checkCount: 1,
    blockers,
    warnings: [],
  };
}

function suiteService(
  overrides: Partial<SuiteProfileProductService> = {},
): SuiteProfileProductService {
  return {
    listSuites: async () => [suite],
    getSuite: async () => suite,
    getSuiteEditor: async () => editor,
    saveSuite: async () => suite,
    removeSuite: async () => undefined,
    listEnvironmentProfiles: async () => [environment],
    getEnvironmentProfile: async () => environment,
    previewSuite: async () => suitePreview(),
    preflightEnvironment: async () => ({
      profile: environment,
      target: {
        targetId: space.id,
        ok: true,
        checkedAt: 1,
        capabilities: [],
        checks: [],
      },
    }),
    startSuite: async () => ({ batchId: "batch-1" }),
    ...overrides,
  };
}

function browserService(
  overrides: Partial<BrowserSpacesProductService> = {},
): BrowserSpacesProductService {
  return {
    listSpaces: async () => [space],
    createSpace: async () => space,
    openSpace: async () => ({ targetId: space.id, name: space.name, url: space.startUrl }),
    removeSpace: async () => undefined,
    listAuthenticationFixtures: async () => [fixture],
    saveAuthenticationFixture: async () => ({ fixture, space }),
    refreshAuthenticationFixture: async () => ({ fixture, space }),
    revokeAuthenticationFixture: async () => ({ fixture: { ...fixture, revokedAt: 3 }, space }),
    listCompareSets: async () => [],
    saveCompareSet: async () => ({
      id: "compare-1",
      appMapId: "app-1",
      name: "Compare",
      testIds: [],
      variableIds: [],
      source: { kind: "app-map-combine", id: "compare-1" },
      persistence: "saved",
    }),
    removeCompareSet: async () => undefined,
    ...overrides,
  };
}

async function render(
  path: string,
  options: {
    suiteService?: SuiteProfileProductService;
    browserService?: BrowserSpacesProductService;
    apps?: readonly { id: string; name: string }[];
    openExternal?: (url: string) => void;
  } = {},
) {
  const history = createMemoryHistory({ initialEntries: [path] });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const productService = {
    listApps: async () => options.apps ?? [{ id: "app-1", name: "Checkout" }],
  } as RecordingProductService;
  await act(async () => {
    root.render(
      <RelayV2App
        platform={{ ...platform, openExternal: options.openExternal }}
        history={history}
        productService={productService}
        suiteProfileService={options.suiteService ?? suiteService()}
        browserSpacesService={options.browserService ?? browserService()}
      />,
    );
  });
  await settle();
  return { history };
}

async function settle() {
  for (let index = 0; index < 6; index += 1) {
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
  }
}

async function clickButton(label: string) {
  const button = [...document.querySelectorAll("button, [role='menuitem']")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!(button instanceof HTMLElement)) throw new Error(`Button not found: ${label}`);
  await act(async () => button.click());
  await settle();
}

async function fill(id: string, value: string) {
  const input = document.getElementById(id);
  if (!(input instanceof HTMLInputElement)) throw new Error(`Input not found: ${id}`);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
});

describe("Suite and Environment routes", () => {
  it("passes the displayed App scope to the Suite collection", async () => {
    const scopedSuite = { ...suite, appMapId: "app-2", appName: "Billing" };
    const listSuites = vi.fn(async (appMapId?: string) =>
      appMapId === "app-2" ? [scopedSuite] : [],
    );
    await render("/suites?app=app-2", {
      apps: [
        { id: "app-1", name: "Checkout" },
        { id: "app-2", name: "Billing" },
      ],
      suiteService: suiteService({ listSuites }),
    });

    expect(listSuites).toHaveBeenCalledWith("app-2");
    expect(document.body.textContent).toContain("Billing");
    expect(document.querySelector('a[href="/apps/app-2/suites/suite-1"]')).not.toBeNull();
    expect(document.querySelector('a[href="/apps/app-1/suites/suite-1"]')).toBeNull();
  });

  it("renders Suites and navigates to the canonical Suite detail route", async () => {
    const { history } = await render("/suites");
    expect(document.querySelector("h1")?.textContent).toBe("Suites");
    expect(document.body.textContent).toContain("Release smoke");
    expect(document.body.textContent).toContain("1 Test");
    const link = document.querySelector<HTMLAnchorElement>('a[href="/apps/app-1/suites/suite-1"]');
    expect(link?.getAttribute("aria-label")).toBeNull();
    await act(async () => link?.click());
    await settle();
    expect(history.location.pathname).toBe("/apps/app-1/suites/suite-1");
  });

  it("keeps a blocked Suite pilot disabled and sends reviewed edits/removal through services", async () => {
    const calls = { save: [] as unknown[], remove: [] as unknown[], start: 0 };
    const service = suiteService({
      previewSuite: async () =>
        suitePreview([{ code: "target-not-ready", message: "Browser needs attention" }]),
      saveSuite: async (input) => {
        calls.save.push(input);
        return suite;
      },
      removeSuite: async (input) => {
        calls.remove.push(input);
      },
      startSuite: async () => {
        calls.start += 1;
        return { batchId: "batch-1" };
      },
    });
    const { history } = await render("/apps/app-1/suites/suite-1", { suiteService: service });
    const run = [...document.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("Run"),
    );
    expect(run).toBeInstanceOf(HTMLButtonElement);
    expect((run as HTMLButtonElement).disabled).toBe(true);
    expect(document.body.textContent).toContain("Needs attention");

    await clickButton("Edit");
    expect(document.querySelector("#edit-suite-name")).not.toBeNull();
    await fill("edit-suite-name", "Release smoke updated");
    await clickButton("Save changes");
    expect(calls.save).toHaveLength(1);
    expect(calls.save[0]).toMatchObject({
      appMapId: "app-1",
      suiteId: "suite-1",
      expectedRevision: 7,
      name: "Release smoke updated",
    });

    await clickButton("Remove");
    await clickButton("Remove Suite");
    expect(calls.remove).toEqual([{ appMapId: "app-1", suiteId: "suite-1", expectedRevision: 7 }]);
    expect(calls.start).toBe(0);
    expect(history.location.pathname).toBe("/suites");
  });

  it("labels an unavailable multi-environment result as previewed, not ready", async () => {
    await render("/apps/app-1/suites/suite-1", {
      suiteService: suiteService({
        previewSuite: async () => ({
          ...suitePreview(),
          caseCount: 2,
          execution: {
            profileCount: 2,
            selectedProfileIds: ["space-1", "space-2"],
            capacity: "unavailable",
            duration: "unavailable",
            detail: "Multi-environment execution is unavailable.",
          },
        }),
      }),
    });

    expect(document.body.textContent).toContain("2 cases previewed");
    expect(document.body.textContent).not.toContain("2 cases ready");
    expect(document.body.textContent).toContain("Multi-environment execution is unavailable.");
  });

  it("creates a browser with labeled fields and opens its canonical detail route", async () => {
    const created = { ...space, id: "space-2", name: "New staging" };
    const create = vi.fn(async () => created);
    const { history } = await render("/environments", {
      browserService: browserService({ createSpace: create }),
    });
    expect(document.querySelector("h1")?.textContent).toBe("Browsers");
    expect(document.body.textContent).toContain("Staging browser");
    await clickButton("New browser");
    await fill("space-name", "New staging");
    await fill("space-url", "https://new.example.test");
    expect(document.querySelector('label[for="space-name"]')?.textContent).toBe("Name");
    expect(document.querySelector('label[for="space-url"]')?.textContent).toBe("Website");
    expect(document.body.textContent).not.toContain("Keep this browser profile");
    expect(document.body.textContent).not.toContain("Keep data if you need");
    await clickButton("Create browser");
    expect(create).toHaveBeenCalledWith({
      name: "New staging",
      startUrl: "https://new.example.test",
      profileRetention: "retain",
    });
    expect(history.location.pathname).toBe("/environments/space-2");
  });

  it("opens, saves/revokes account metadata, and removes an Environment safely", async () => {
    const calls = { open: 0, save: [] as unknown[], revoke: [] as unknown[], remove: 0 };
    const openExternal = vi.fn();
    const { history } = await render("/environments/space-1", {
      openExternal,
      browserService: browserService({
        openSpace: async () => {
          calls.open += 1;
          return { targetId: space.id, name: space.name, url: space.startUrl };
        },
        saveAuthenticationFixture: async (input) => {
          calls.save.push(input);
          return { fixture, space };
        },
        revokeAuthenticationFixture: async (input) => {
          calls.revoke.push(input);
          return { fixture: { ...fixture, revokedAt: 3 }, space };
        },
        removeSpace: async () => {
          calls.remove += 1;
        },
      }),
    });
    expect(document.querySelector("h1")?.textContent).toBe("Staging browser");
    expect(document.body.textContent).toContain("Staging account");
    expect(document.body.textContent).not.toContain("Current checks");
    expect(document.body.textContent).not.toContain("Profile storage");
    expect(document.body.textContent).not.toContain("Fresh each time");
    expect(document.body.textContent).not.toContain("cookie");
    await clickButton("More");
    await clickButton("Open in system browser");
    expect(calls.open).toBe(1);
    expect(openExternal).toHaveBeenCalledWith(space.startUrl);

    await clickButton("Open");
    expect(calls.open).toBe(2);
    expect(history.location.pathname).toBe(`/devices/${space.id}`);
    history.push(`/environments/${space.id}`);
    await settle();

    await clickButton("Save current sign-in");
    await fill("account-fixture-name", "QA member");
    await clickButton("Save sign-in");
    expect(calls.save).toEqual([{ spaceId: "space-1", name: "QA member" }]);

    await clickButton("Revoke");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "existing Run evidence",
    );
    await clickButton("Revoke sign-in");
    expect(calls.revoke).toEqual([{ spaceId: "space-1", reference: fixture.reference }]);

    await clickButton("More");
    await clickButton("Remove");
    await clickButton("Remove browser");
    expect(calls.remove).toBe(1);
    expect(history.location.pathname).toBe("/environments");
  });
});
