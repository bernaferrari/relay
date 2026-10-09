/** @jsxImportSource react */
import { createMemoryHistory } from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RelayApp } from "../app";
import type { ProductTestSummary } from "@relay/product/catalog";
import type { AppResourcesProductService } from "../data/app-resources-product-service";
import type { CatalogProductService } from "../data/catalog-product-service";
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

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline test fixture")));
});

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
  referenceReviewMode: "human",
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

const catalogTests: readonly ProductTestSummary[] = [
  {
    id: "test-1",
    name: "Complete checkout",
    appMapId: "app-1",
    appName: "Checkout",
    stepCount: 4,
    status: "ready",
    updatedAt: 1,
    href: "/tests/test-1",
  },
  {
    id: "test-2",
    name: "Pay invoice",
    appMapId: "app-2",
    appName: "Billing",
    stepCount: 2,
    status: "ready",
    updatedAt: 2,
    href: "/tests/test-2",
  },
];

const catalogService: CatalogProductService = {
  listTests: async () => catalogTests,
  getTest: async () => undefined,
  listRuns: async () => [],
  getRun: async () => undefined,
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
      <RelayApp
        platform={{ ...platform, openExternal: options.openExternal }}
        history={history}
        productService={productService}
        catalogService={catalogService}
        suiteProfileService={options.suiteService ?? suiteService()}
        browserSpacesService={options.browserService ?? browserService()}
        appResourcesService={
          {
            listAccountLanes: async () => [],
          } as unknown as AppResourcesProductService
        }
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Suite and Environment routes", () => {
  it("discovers run destinations in the saved app and plan scope", async () => {
    const listEnvironmentProfiles = vi.fn(async () => [environment]);
    await render("/apps/app-1/suites/suite-1", {
      suiteService: suiteService({ listEnvironmentProfiles }),
    });
    expect(listEnvironmentProfiles).toHaveBeenCalledWith({
      appMapId: "app-1",
      combineId: "suite-1",
    });
    expect(document.body.textContent).toContain("Staging browser");
  });

  it("opens the connected device when a native plan needs setup", async () => {
    const native: ProductEnvironmentProfile = {
      ...environment,
      id: "saved-ipad-profile",
      targetId: "ipad-serial",
      name: "iPad Pro",
      platform: "ios",
      target: { id: "ipad-serial", name: "iPad Pro", kind: "ios" },
    };
    await render("/apps/app-1/suites/suite-1", {
      suiteService: suiteService({
        listEnvironmentProfiles: async () => [native],
        previewSuite: async () =>
          suitePreview([{ code: "device-unavailable", message: "Reconnect the iPad." }]),
      }),
    });
    const link = [...document.querySelectorAll<HTMLAnchorElement>("a")].find(
      (item) => item.textContent?.trim() === "Open selected setup",
    );
    expect(link?.getAttribute("href")).toBe("/devices/ipad-serial");
    expect(document.body.textContent).toContain("Reconnect the iPad.");
  });

  it("checks unused prompt values before choosing a device and links to the scoped test", async () => {
    const previewSuite = vi.fn(async () => ({
      ...suitePreview(),
      caseCount: 2,
      warnings: [
        {
          code: "unused-input-data-set",
          message: "Chat prompts are not used. Connect a Type step to run input chat_prompt.",
        },
      ],
    }));
    await render("/apps/app-1/suites/suite-1", {
      suiteService: suiteService({ listEnvironmentProfiles: async () => [], previewSuite }),
    });
    expect(previewSuite).toHaveBeenCalledWith(expect.objectContaining({ profileIds: [] }));
    expect(document.body.textContent).toContain("Prompts aren’t connected");
    expect(document.body.textContent).toContain("Try one combination first");
    const connect = [...document.querySelectorAll<HTMLAnchorElement>("a")].find(
      (item) => item.textContent === "Connect input in Complete checkout",
    );
    expect(connect).toBeTruthy();
    expect(new URL(connect!.href).pathname).toBe("/tests/test-1");
    expect(new URL(connect!.href).searchParams.get("app")).toBe("app-1");
    expect(document.body.textContent).not.toContain("Set up the selected browser");
  });

  it("keeps unused prompt plans from running despite a ready device preview", async () => {
    const startSuite = vi.fn(async () => ({ batchId: "must-not-start" }));
    await render("/apps/app-1/suites/suite-1", {
      suiteService: suiteService({
        startSuite,
        previewSuite: async () => ({
          ...suitePreview(),
          warnings: [
            { code: "unused-input-data-set", message: "Connect chat_prompt before running." },
          ],
        }),
      }),
    });
    const run = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (item) => item.textContent?.trim() === "Run test",
    );
    expect(run?.disabled).toBe(true);
    await act(async () => run?.click());
    expect(startSuite).not.toHaveBeenCalled();
  });

  it("shows only the displayed app's plans as groups on tests", async () => {
    const scopedSuite = { ...suite, appMapId: "app-2", appName: "Billing", name: "Billing smoke" };
    const listSuites = vi.fn(async () => [suite, scopedSuite]);
    await render("/tests?app=app-2&view=plans", {
      apps: [
        { id: "app-1", name: "Checkout" },
        { id: "app-2", name: "Billing" },
      ],
      suiteService: suiteService({ listSuites }),
    });

    expect(listSuites).toHaveBeenCalled();
    const plans = document.querySelector('section[aria-labelledby="plans-heading"]');
    expect(plans?.textContent).toContain("Billing smoke");
    expect(plans?.textContent).not.toContain("Release smoke");
    expect(document.querySelector('a[href="/apps/app-2/suites/suite-1"]')).not.toBeNull();
    expect(document.querySelector('a[href="/apps/app-1/suites/suite-1"]')).toBeNull();
  });

  it("redirects the old plans list to tests and opens a plan's canonical detail route", async () => {
    const { history } = await render("/suites");
    expect(history.location.pathname).toBe("/tests");
    expect(document.querySelector("h1")?.textContent).toBe("Tests");
    const plans = document.querySelector('section[aria-labelledby="plans-heading"]')!;
    expect(plans.querySelector("h2")?.textContent).toBe("Test plans");
    expect(plans.textContent).toContain("Release smoke");
    expect(plans.textContent).toContain("Checkout · 1 test");
    const link = plans.querySelector<HTMLAnchorElement>('a[href="/apps/app-1/suites/suite-1"]');
    expect(link?.textContent?.trim()).toBe("Run all");
    await act(async () => link?.click());
    await settle();
    expect(history.location.pathname).toBe("/apps/app-1/suites/suite-1");
  });

  it("keeps tests search in the URL and restores all saved tests on Clear", async () => {
    const { history } = await render("/tests");
    const search = document.querySelector<HTMLInputElement>('input[aria-label="Search tests"]');
    if (!search) throw new Error("Search tests input missing");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(search, "does not match");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
    expect(history.location.search).toContain("q=does");
    expect(document.querySelector('section[aria-labelledby="plans-heading"]')).toBeNull();
    expect(document.querySelector('a[href="/apps/app-1/suites/suite-1"]')).toBeNull();
    await clickButton("Clear");
    expect(history.location.search).not.toContain("q=");
    expect(search.value).toBe("");
    expect(document.querySelector('section[aria-labelledby="loose-heading"]')).not.toBeNull();
  });

  it("creates a plan from the New plan dialog on tests and opens it", async () => {
    let resolveSave!: (value: ProductSuite) => void;
    const saveReply = new Promise<ProductSuite>((resolve) => {
      resolveSave = resolve;
    });
    const saveSuite = vi.fn(
      (_input: Parameters<SuiteProfileProductService["saveSuite"]>[0]) => saveReply,
    );
    const getSuiteEditor = vi.fn(async () => editor);
    const { history } = await render("/tests?app=app-1&view=plans", {
      suiteService: suiteService({ saveSuite, getSuiteEditor }),
    });
    await clickButton("New plan");
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("New test plan");
    expect(getSuiteEditor).toHaveBeenCalledWith("app-1");
    const save = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Create plan",
    )!;
    expect(save.disabled).toBe(true);

    await fill("suite-name", "Nightly checkout");
    // A name alone is not a plan; it needs at least one test.
    expect(save.disabled).toBe(true);
    const testChoice = [...document.querySelectorAll<HTMLElement>('[role="checkbox"]')].find(
      (box) => box.closest("label")?.textContent?.includes("Complete checkout"),
    );
    if (!testChoice) throw new Error("Test checkbox missing");
    expect(testChoice.getAttribute("aria-checked")).toBe("false");
    // Choosing the whole row (its label) selects the test.
    await act(async () => testChoice.closest("label")!.click());
    await settle();
    expect(testChoice.getAttribute("aria-checked")).toBe("true");
    expect(document.body.textContent).toContain("1 selected");
    expect(save.disabled).toBe(false);

    await act(async () => save.click());
    await settle();
    expect(saveSuite).toHaveBeenCalledTimes(1);
    expect(saveSuite.mock.calls[0]?.[0]).toMatchObject({
      appMapId: "app-1",
      expectedRevision: 7,
      name: "Nightly checkout",
      testIds: ["test-1"],
      variableIds: [],
      strategy: "cartesian",
      referenceReviewMode: "human",
    });
    expect(saveSuite.mock.calls[0]?.[0].suiteId).toMatch(/^suite-nightly-checkout-/u);
    expect(save.disabled).toBe(true);
    expect(dialog?.hasAttribute("data-open")).toBe(true);
    expect(history.location.pathname).toBe("/tests");
    await act(async () => resolveSave(suite));
    await vi.waitFor(async () => {
      await act(async () => {
        expect(history.location.pathname).toBe("/apps/app-1/suites/suite-1");
        // Closed exit markup may remain mounted; the modal must no longer be open.
        expect(document.querySelector('[role="dialog"]:not([data-closed])')).toBeNull();
      });
    });
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
    const run = [...document.querySelectorAll("#suite-run-setup button")].find((candidate) =>
      /^Run (test|all|on)/u.test(candidate.textContent ?? ""),
    );
    expect(run).toBeInstanceOf(HTMLButtonElement);
    expect((run as HTMLButtonElement).disabled).toBe(true);
    expect(document.body.textContent).toContain("Setup needed before running");

    await clickButton("Edit plan");
    expect(document.querySelector("#edit-suite-name")).not.toBeNull();
    await fill("edit-suite-name", "Release smoke updated");
    await clickButton("Save changes");
    expect(calls.save).toHaveLength(1);
    expect(calls.save[0]).toMatchObject({
      appMapId: "app-1",
      suiteId: "suite-1",
      expectedRevision: 7,
      name: "Release smoke updated",
      referenceReviewMode: "human",
    });

    await act(async () =>
      document.querySelector<HTMLElement>('button[aria-label="More plan actions"]')!.click(),
    );
    await settle();
    await clickButton("Remove plan…");
    await clickButton("Remove plan");
    expect(calls.remove).toEqual([{ appMapId: "app-1", suiteId: "suite-1", expectedRevision: 7 }]);
    expect(calls.start).toBe(0);
    // Removing a plan returns to Tests, where plans are listed as groups.
    expect(history.location.pathname).toBe("/tests");
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

    expect(document.body.textContent).toContain("Check it, then continue with the other 1.");
    expect(document.body.textContent).not.toContain("2 cases ready");
    expect(document.body.textContent).toContain("Multi-environment execution is unavailable.");
  });

  it("opens the existing plan result instead of offering a second start", async () => {
    const start = vi.fn(async () => {
      throw Object.assign(new Error("This plan has a run in progress"), {
        body: { code: "ACTIVE_REPEAT_EXISTS", repeatId: "batch-existing" },
      });
    });
    await render("/apps/app-1/suites/suite-1", {
      suiteService: suiteService({ startSuite: start }),
    });
    await clickButton("Run test");
    expect(start).toHaveBeenCalledTimes(1);
    const link = [...document.querySelectorAll<HTMLAnchorElement>("a")].find(
      (item) => item.textContent?.trim() === "Open existing result",
    );
    expect(link?.getAttribute("href")).toBe("/batches/batch-existing");
    expect(document.querySelector("#suite-run-setup")?.textContent).not.toContain("Run test");
  });

  it("creates a browser with labeled fields and opens its canonical detail route", async () => {
    const created = { ...space, id: "space-2", name: "New staging" };
    const create = vi.fn(async () => created);
    const { history } = await render("/environments?view=new", {
      browserService: browserService({ createSpace: create }),
    });
    expect(document.querySelector("h1")?.textContent).toBe("Browsers");
    expect(document.querySelector('[data-slot="page-context"]')).toBeNull();
    expect(document.body.textContent).toContain("Staging browser");
    expect(document.body.textContent).not.toContain("Fresh browser each session");
    expect(document.body.textContent).not.toContain("Open →");

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

  it("collapses revoked account history while expired accounts keep their repair actions", async () => {
    const expired = {
      ...fixture,
      id: "expired",
      reference: "authfx:expired:1",
      name: "Expired member",
      expiresAt: Date.now() - 1_000,
    };
    const revoked = Array.from({ length: 14 }, (_, index) => ({
      ...fixture,
      id: `revoked-${index}`,
      reference: `authfx:revoked-${index}:1`,
      name: `Historical account ${index + 1}`,
      revokedAt: index,
    }));
    const refresh = vi.fn(async () => ({ fixture, space }));
    const revoke = vi.fn(async () => ({ fixture, space }));
    await render("/environments/space-1", {
      browserService: browserService({
        listAuthenticationFixtures: async () => [fixture, expired, ...revoked],
        refreshAuthenticationFixture: refresh,
        revokeAuthenticationFixture: revoke,
      }),
    });

    const accounts = document.querySelector('[data-slot="environment-accounts"]')!;
    expect(accounts.querySelectorAll("li")).toHaveLength(2);
    expect(accounts.textContent).toContain("Staging account");
    const expiredRow = [...accounts.querySelectorAll("li")].find((row) =>
      row.textContent?.includes("Expired member"),
    )!;
    expect(expiredRow.textContent).toContain("Expired");
    expect([...expiredRow.querySelectorAll("button")].map((button) => button.textContent)).toEqual([
      "Update sign-in",
      "Revoke",
    ]);
    const history = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Inactive accounts, 14"]',
    )!;
    expect(history.textContent).toContain("Inactive accounts");
    expect(history.textContent).toContain("14");
    expect(history.getAttribute("aria-expanded")).toBe("false");
    expect(document.body.textContent).not.toContain("Historical account");

    await act(async () => history.click());
    await settle();
    expect(history.getAttribute("aria-expanded")).toBe("true");
    const historyList = document.querySelector('[data-slot="environment-inactive-accounts"]')!;
    expect(historyList.querySelectorAll("li")).toHaveLength(14);
    expect(historyList.textContent).toContain("Historical account 1");
    expect(historyList.textContent).toContain("Historical account 14");
    expect(historyList.textContent).toContain("Revoked");
    expect(historyList.querySelector("button")).toBeNull();

    await act(async () => history.click());
    await settle();
    expect(history.getAttribute("aria-expanded")).toBe("false");
    expect(document.body.textContent).not.toContain("Historical account");
    expect(refresh).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
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
    expect(document.querySelector('[data-slot="breadcrumbs"]')?.textContent).toContain("Browsers");
    expect(document.body.textContent).toContain("Staging account");
    expect(document.querySelector('[data-slot="environment-accounts"]')?.textContent).not.toContain(
      "Available",
    );
    expect(document.body.textContent).not.toContain("Current checks");
    expect(document.body.textContent).not.toContain("Profile storage");
    expect(document.body.textContent).not.toContain("Fresh each time");
    expect(document.body.textContent).not.toContain("cookie");
    expect(document.body.textContent).not.toContain("← Back to recording");
    await clickButton("More");
    await clickButton("Open browser window");
    expect(calls.open).toBe(1);
    expect(openExternal).not.toHaveBeenCalled();

    await clickButton("Open in Relay");
    expect(calls.open).toBe(2);
    expect(history.location.pathname).toBe(`/devices/${space.id}`);
    await act(async () => {
      history.back();
    });

    await clickButton("Save current sign-in");
    await fill("account-fixture-name", "QA member");
    await clickButton("Save");
    expect(calls.save).toEqual([{ spaceId: "space-1", name: "QA member" }]);

    await clickButton("Revoke");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "existing run evidence",
    );
    await clickButton("Revoke sign-in");
    expect(calls.revoke).toEqual([{ spaceId: "space-1", reference: fixture.reference }]);

    await clickButton("More");
    await clickButton("Remove");
    await clickButton("Remove browser");
    expect(calls.remove).toBe(1);
    expect(history.location.pathname).toBe("/environments");
  });

  it("schedules the plan daily on the first selected browser", async () => {
    const schedulePlan = vi.fn(async () => ({ id: "sched-1" }));
    await render("/apps/app-1/suites/suite-1", {
      suiteService: suiteService({ schedulePlan }),
    });
    expect(document.body.textContent).toContain("Schedule");
    expect(document.body.textContent).toContain("8:00 AM");
    const hour = document.querySelector<HTMLInputElement>("#plan-daily-hour");
    if (!hour) throw new Error("Hour field missing");
    await act(async () => hour.click());
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((item) =>
      item.textContent?.includes("9:00 AM"),
    );
    if (!option) throw new Error("9 AM option missing");
    await act(async () => option.click());
    await clickButton("Add schedule");
    expect(schedulePlan).toHaveBeenCalledWith({
      appMapId: "app-1",
      combineId: "suite-1",
      profileId: "space-1",
      profileIds: ["space-1"],
      hour: 9,
      timezone: expect.any(String),
    });
  });

  it("shows next and last run without treating admission failure as a pass", async () => {
    await render("/apps/app-1/suites/suite-1", {
      suiteService: suiteService({
        schedulePlan: vi.fn(async () => ({ id: "sched-1" })),
        listPlanSchedules: async () => [
          {
            id: "sched-1",
            hour: 8,
            timezone: "UTC",
            nextRunAt: Date.UTC(2026, 8, 18, 8),
            lastFailure: "That browser is offline",
            enabled: true,
          },
        ],
      }),
    });
    expect(document.body.textContent).toContain("Next");
    expect(document.body.textContent).toContain("Fri, Sep 18, 8:00 AM");
    expect(document.body.textContent).toContain("Last");
    expect(document.body.textContent).not.toContain("Never");
    expect(document.body.textContent).toContain("That browser is offline");
    expect(document.body.textContent).toContain("Previous scheduled runs");
    expect(document.body.textContent).not.toContain("Looks correct");
  });

  it("updates the selected saved schedule to a half-hour repeat without a daily hour", async () => {
    const schedulePlan = vi.fn(async () => ({ id: "native-schedule" }));
    await render("/apps/app-1/suites/suite-1", {
      suiteService: suiteService({
        schedulePlan,
        listPlanSchedules: async () => [
          {
            id: "native-schedule",
            intervalMinutes: 1_440,
            hour: 8,
            timezone: "UTC",
            nextRunAt: 1,
            enabled: true,
          },
        ],
      }),
    });
    await clickButton("Change frequency");
    await act(async () => document.getElementById("plan-schedule-frequency")!.click());
    const halfHour = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (item) => item.textContent?.trim() === "Every 30 minutes",
    )!;
    await act(async () => halfHour.click());
    await clickButton("Save schedule");
    expect(schedulePlan).toHaveBeenCalledExactlyOnceWith({
      appMapId: "app-1",
      combineId: "suite-1",
      profileId: "space-1",
      profileIds: ["space-1"],
      scheduleId: "native-schedule",
      intervalMinutes: 30,
      timezone: "UTC",
    });
  });

  it("keeps automatic scheduling disabled while plan admission is pending", async () => {
    let finish!: (value: ProductSuitePreview) => void;
    const admission = new Promise<ProductSuitePreview>((resolve) => {
      finish = resolve;
    });
    const schedulePlan = vi.fn(async () => ({ id: "sched-1" }));
    await render("/apps/app-1/suites/suite-1", {
      suiteService: suiteService({ schedulePlan, previewSuite: () => admission }),
    });
    const submit = document.querySelector<HTMLButtonElement>(
      'form[aria-label="Add schedule"] button[type="submit"]',
    )!;
    expect(submit.disabled).toBe(true);
    await act(async () => submit.click());
    expect(schedulePlan).not.toHaveBeenCalled();
    await act(async () => finish(suitePreview()));
    await settle();
    expect(submit.disabled).toBe(false);
  });

  it("keeps automatic scheduling disabled for unavailable native execution", async () => {
    const schedulePlan = vi.fn(async () => ({ id: "sched-1" }));
    await render("/apps/app-1/suites/suite-1", {
      suiteService: suiteService({
        schedulePlan,
        previewSuite: async () => ({
          ...suitePreview(),
          execution: {
            profileCount: 1,
            selectedProfileIds: ["space-1"],
            capacity: "unavailable",
            duration: "unavailable",
            detail: "Native execution unavailable",
          },
        }),
      }),
    });
    const submit = document.querySelector<HTMLButtonElement>(
      'form[aria-label="Add schedule"] button[type="submit"]',
    )!;
    expect(submit.disabled).toBe(true);
    await act(async () => submit.click());
    expect(schedulePlan).not.toHaveBeenCalled();
  });
});
