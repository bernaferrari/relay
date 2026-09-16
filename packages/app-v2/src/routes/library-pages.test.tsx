/** @jsxImportSource react */
import type { ProductRunSummary, ProductTestSummary } from "@relay/product/catalog";
import { createMemoryHistory } from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RelayV2App } from "../app";
import type { CatalogProductService } from "../data/catalog-product-service";
import type { MapProductService } from "../data/map-product-service";
import type { RecordingProductService } from "../data/recording-product-service";
import type { RunProductService } from "../data/run-product-service";
import type { SuiteProfileProductService } from "../data/suite-profile-product-service";
import type { Platform } from "../platform/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const platform: Platform = {
  platform: "web",
  getServerUrl: () => "http://127.0.0.1:8787",
  storage: {
    get: () => null,
    set: () => undefined,
    remove: () => undefined,
  },
};

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
});

function productRun(
  input: Pick<ProductRunSummary, "id" | "title" | "phase" | "queuedAt"> &
    Partial<ProductRunSummary>,
): ProductRunSummary {
  return {
    action: "canonical execution action",
    status: input.phase,
    identity: { runId: input.id },
    links: { self: `/runs/${input.id}` },
    ...input,
  };
}

const now = Date.now();
const passedRun = productRun({
  id: "run-passed-internal",
  title: "Change language",
  testName: "Change language",
  testId: "test-language-internal",
  appMapId: "app-shop-internal",
  appName: "Shopping",
  phase: "completed",
  outcome: "passed",
  queuedAt: now - 120_000,
  finishedAt: now - 90_000,
  durationMs: 2_500,
});
const tests: readonly ProductTestSummary[] = [
  {
    id: "test-language-internal",
    name: "Change language",
    appMapId: "app-shop-internal",
    appName: "Shopping",
    stepCount: 3,
    status: "ready",
    updatedAt: now - 100_000,
    href: "/tests/test-language-internal",
    recentRun: passedRun,
  },
  {
    id: "test-checkout-internal",
    name: "Complete checkout",
    appMapId: "app-shop-internal",
    appName: "Shopping",
    stepCount: 5,
    status: "needs-review",
    updatedAt: now - 80_000,
    href: "/tests/test-checkout-internal",
  },
];
const runs: readonly ProductRunSummary[] = [
  productRun({
    id: "run-older-internal",
    title: "Change language",
    testName: "Change language",
    testId: "test-language-internal",
    appMapId: "app-shop-internal",
    appName: "Shopping",
    phase: "failed",
    outcome: "product-failure",
    queuedAt: now - 240_000,
  }),
  passedRun,
  productRun({
    id: "run-review-internal",
    title: "Complete checkout",
    testName: "Complete checkout",
    testId: "test-checkout-internal",
    appMapId: "app-shop-internal",
    appName: "Shopping",
    targetName: "Pixel 9",
    phase: "completed",
    outcome: "uncertain",
    queuedAt: now - 60_000,
  }),
  productRun({
    id: "run-active-internal",
    title: "Open account",
    testName: "Open account",
    testId: "test-account-internal",
    appMapId: "app-bank-internal",
    appName: "Banking",
    phase: "running",
    queuedAt: now - 30_000,
  }),
];

function catalog(overrides: Partial<CatalogProductService> = {}): CatalogProductService {
  return {
    listTests: async () => tests,
    getTest: async () => undefined,
    listRuns: async () => runs,
    getRun: async () => undefined,
    ...overrides,
  };
}

function platformWithPointer(workflowId: string): Platform {
  const values = new Map([["activeRecordingWorkflowId", workflowId]]);
  return {
    platform: "web",
    getServerUrl: () => "http://127.0.0.1:8787",
    storage: {
      get: (key) => values.get(key) ?? null,
      set: (key, value) => void values.set(key, value),
      remove: (key) => void values.delete(key),
    },
  };
}

function recordingInspect(appMapId?: string): RecordingProductService {
  return {
    inspect: vi.fn(async () => ({
      status: "recording",
      targets: [],
      snapshot: {
        schemaVersion: 1,
        kind: "author-test",
        title: "Untitled recording",
        phase: "running",
        stage: "recording",
        version: "1",
        progress: { label: "Recording" },
        allowedNextActions: ["stop"],
        problems: [],
        evidenceRefs: [],
        ...(appMapId
          ? {
              frozen: {
                title: "Untitled recording",
                actorId: "human:test",
                appMapId,
                appMapRevision: 1,
                target: { kind: "device", platform: "android", targetId: "emulator-5554" },
              },
            }
          : {}),
      },
    })),
  } as unknown as RecordingProductService;
}

async function render(
  path: string,
  service = catalog(),
  mapService?: MapProductService,
  runService: RunProductService = {} as RunProductService,
  suiteProfileService: SuiteProfileProductService = {} as SuiteProfileProductService,
  extras?: { platform?: Platform; productService?: RecordingProductService },
) {
  const history = createMemoryHistory({ initialEntries: [path] });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <RelayV2App
        platform={extras?.platform ?? platform}
        history={history}
        productService={extras?.productService ?? ({} as RecordingProductService)}
        runService={runService}
        suiteProfileService={suiteProfileService}
        catalogService={service}
        mapService={mapService}
      />,
    );
  });
  await settle();
  return { history };
}

describe("App overview", () => {
  it("keeps Tests, Reports, coverage, and the next action together", async () => {
    const filters: string[] = [];
    const service = catalog({
      listTests: async (filter) => {
        filters.push(`tests:${filter?.appMapId ?? "all"}`);
        return tests;
      },
      listRuns: async (filter) => {
        filters.push(`runs:${filter?.appMapId ?? "all"}`);
        return runs;
      },
    });
    const mapService: MapProductService = {
      get: async () => ({
        appMapId: "app-shop-internal",
        appName: "Shopping",
        revision: 3,
        screens: [
          {
            id: "home",
            title: "Home",
            variantCount: 1,
            variants: [],
            coveringTests: [],
            recentFailures: [],
          },
        ],
        paths: [],
        coverage: {
          screenCount: 3,
          coveredScreenCount: 2,
          pathCount: 2,
          coveredPathCount: 1,
          testCount: 2,
        },
        pendingProposalCount: 0,
        navigation: { route: "/apps/:appId/map", href: "/apps/app-shop-internal/map" },
      }),
    };

    await render("/apps/app-shop-internal", service, mapService);

    expect(document.body.textContent).toContain("Tests for this app");
    expect(document.body.textContent).toContain("Coverage");
    expect(document.body.textContent).not.toContain("Saved tests");
    expect(document.body.textContent).not.toContain("Recent results");
    expect(document.body.textContent).not.toContain("Workspace resources");
    expect(document.querySelector('a[href="/tests?app=app-shop-internal"]')).not.toBeNull();
    expect(document.querySelector('a[href="/apps/app-shop-internal/map"]')).not.toBeNull();
  });
});

describe("Tests library", () => {
  it("restores the collection scroll container and row focus after browser Back", async () => {
    const { history } = await render("/tests");
    const main = document.querySelector<HTMLElement>(".relay-main");
    if (!main) throw new Error("main scroll container not found");
    main.scrollTop = 384;
    const row = document.querySelector<HTMLAnchorElement>(
      'a[href="/tests/test-checkout-internal"]',
    );
    if (!row) throw new Error("test row not found");
    await act(async () => row.click());
    await settle();
    await act(async () => history.back());
    await settle();
    expect(history.location.pathname).toBe("/tests");
    expect(main.scrollTop).toBe(384);
    expect(document.activeElement).toBe(
      document.querySelector('a[href="/tests/test-checkout-internal"]'),
    );
  });

  it("opens a ready Test at the Run composer instead of a second dialog", async () => {
    const { history } = await render("/tests");
    expect(
      document.querySelector('a[href="/tests/test-checkout-internal/edit"]')?.textContent,
    ).toContain("Review steps");
    await clickText("Run options");
    expect(history.location.pathname).toBe("/tests/test-language-internal");
    expect(history.location.search).toBe("?setup=run");
    expect(history.location.hash).toBe("");
    expect(document.querySelector(".relay-test-run-dialog")).toBeNull();
  });
});

async function clickText(label: string) {
  const target = [...document.querySelectorAll<HTMLElement>("button, a, label")].find(
    (item) =>
      item.textContent?.trim() === label || (label !== "Run" && item.textContent?.includes(label)),
  );
  if (!target) throw new Error(`Control not found: ${label}`);
  await act(async () => target.click());
  await settle();
}

async function settle() {
  for (let index = 0; index < 5; index += 1) {
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
  }
}

async function fill(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

async function click(label: string) {
  const target = [...document.querySelectorAll<HTMLElement>("button, a")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!target) throw new Error(`Control not found: ${label}`);
  await act(async () => target.click());
  await settle();
}

describe("Tests workspace", () => {
  it("lists human Test summaries, recent outcomes, and a dominant creation action", async () => {
    const { history } = await render("/tests");

    const devices = document.querySelector<HTMLAnchorElement>('a[href="/devices"]');
    expect(devices?.className).not.toContain("relay-nav-link--quiet");
    expect(devices?.textContent?.trim()).toBe("Devices");
    expect(devices?.hasAttribute("aria-disabled")).toBe(false);
    expect(document.querySelector('a[href="/tests/new"]')?.textContent).toBe("New Test");
    expect(document.querySelector('a[href="/suites"]')?.textContent).toBe("Plans");
    expect(document.querySelector('a[href="/changes"]')?.textContent).toBe("Changes");
    expect(document.body.textContent).toContain("Change language");
    expect(document.body.textContent).toContain("Complete checkout");
    expect(document.body.textContent).toContain("Passed");
    expect(document.body.textContent).toContain("Not run yet");
    expect(document.body.textContent).not.toContain("app-shop-internal");
    expect(document.body.textContent).not.toContain("test-language-internal");
    expect(document.querySelectorAll("select")).toHaveLength(0);
    expect(document.querySelectorAll('[data-slot="select-trigger"]')).toHaveLength(2);
    expect(document.querySelector('[data-slot="library-search-control"] svg')).not.toBeNull();

    const search = document.querySelector<HTMLInputElement>("#test-search")!;
    search.focus();
    expect(document.activeElement).toBe(search);
    await fill(search, "checkout");
    expect(document.body.textContent).not.toContain("Change language");
    expect(document.body.textContent).toContain("Complete checkout");

    await act(async () =>
      document.querySelector<HTMLElement>('a[href="/tests/test-checkout-internal"]')?.click(),
    );
    await settle();
    expect(history.location.pathname).toBe("/tests/test-checkout-internal");
  });

  it("uses the centered shared recovery state when saved Tests cannot load", async () => {
    await render(
      "/tests",
      catalog({
        listTests: async () => {
          throw new TypeError("Failed to fetch");
        },
      }),
    );
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 1_100))));
    await settle();

    const recovery = document.querySelector(".relay-recording-problem");
    expect(recovery?.className).toContain("relay-recovery-state--centered");
    expect(recovery?.getAttribute("data-slot")).toBe("empty");
    expect(recovery?.querySelectorAll('[data-slot="empty-description"]')).toHaveLength(1);
    expect(recovery?.textContent).toContain("The app could not reach the local Relay service.");
    expect(recovery?.textContent).toContain("Try again");
  });

  it("keeps status filters in the route and explains an empty result", async () => {
    const { history } = await render("/tests?status=needs-review");
    expect(document.body.textContent).toContain("Complete checkout");
    expect(document.body.textContent).not.toContain("Change language");

    await fill(document.querySelector<HTMLInputElement>("#test-search")!, "missing");
    expect(document.body.textContent).toContain("No Tests match these filters");
    await click("Clear filters");
    expect(history.location.search).toBe("");
    expect(document.body.textContent).toContain("Change language");
  });

  it("does not invent Suites from Test checkboxes", async () => {
    await render("/tests");
    expect(document.body.textContent).toContain(
      "Reusable steps that check your app. Run a Test to get a result.",
    );
    expect(document.querySelectorAll(".relay-library-row-select")).toHaveLength(0);
    expect(document.body.textContent).not.toContain("Create Suite");
    expect(document.body.textContent).not.toContain("Save Suite");
    expect(document.body.textContent).not.toContain("Your selection spans Apps");
  });

  it("keeps a recording resume when the selected App owns it", async () => {
    const productService = recordingInspect("app-shop-internal");
    await render("/tests?app=app-shop-internal", catalog(), undefined, undefined, undefined, {
      platform: platformWithPointer("workflow-shop"),
      productService,
    });

    expect(productService.inspect).toHaveBeenCalledWith("workflow-shop");
    expect(document.body.textContent).toContain("Continue your test");
    expect(document.body.textContent).toContain("Continue recording");
    expect(
      document.querySelector<HTMLAnchorElement>('a[href="/recordings/workflow-shop"]'),
    ).not.toBeNull();
  });

  it("does not hide a recording whose App ownership is still unknown", async () => {
    await render("/tests?app=app-shop-internal", catalog(), undefined, undefined, undefined, {
      platform: platformWithPointer("workflow-unknown"),
      productService: recordingInspect(),
    });

    expect(document.body.textContent).toContain("Continue your test");
    expect(
      document.querySelector<HTMLAnchorElement>('a[href="/recordings/workflow-unknown"]'),
    ).not.toBeNull();
  });

  it("hides a recording resume that belongs to a different App", async () => {
    await render("/tests?app=app-bank-internal", catalog(), undefined, undefined, undefined, {
      platform: platformWithPointer("workflow-shop"),
      productService: recordingInspect("app-shop-internal"),
    });

    expect(document.body.textContent).not.toContain("Finish the Test you started");
    expect(document.querySelector('a[href="/recordings/workflow-shop"]')).toBeNull();
  });
});

describe("Runs workspace", () => {
  it("uses the cursor-following catalog before calling history complete", async () => {
    const listRuns = vi.fn(async () => runs.slice(0, 1));
    const listRunsComplete = vi.fn(async () => runs);
    await render(
      "/runs?view=all",
      catalog({
        listRuns,
        listRunsComplete,
      }),
    );

    expect(listRunsComplete).toHaveBeenCalledOnce();
    expect(listRuns).not.toHaveBeenCalledWith({ view: "all" });
    expect(document.body.textContent).toContain("Complete history");
    expect(document.body.textContent).toContain("Open account");
  });

  it("keeps the Run view tabs on their own rail above the filters", async () => {
    await render("/runs");

    const tabs = document.querySelector('[data-slot="tabs"]');
    const filters = document.querySelector('[aria-label="Filter Runs"]');
    expect(tabs?.className).toContain("border-b");
    expect(filters?.className).not.toContain("mt-3");
    expect(filters?.parentElement?.className).toMatch(/gap-5|gap-6/);
  });

  it("defaults to All Runs and keeps every row durably addressable", async () => {
    await render("/runs");

    expect(document.body.textContent?.match(/Change language/g)).toHaveLength(2);
    expect(document.body.textContent).toContain("Complete checkout");
    expect(document.body.textContent).toContain("Open account");
    expect(document.body.textContent).toContain("Needs review");
    expect(document.body.textContent).toContain("In progress");
    expect(document.body.textContent).toContain("Morning review");
    expect(document.body.textContent).toContain("Check Sign-ins");
    expect(document.body.textContent).toContain("Check live health");
    expect(document.body.textContent).toContain("Accounts health");
    expect(document.body.textContent).toContain("Neither accepts a screenshot baseline");
    expect(document.body.textContent).toContain("Needs attention on this Mac");
    expect(document.body.textContent).toContain("Signed desktop build");
    expect(document.body.textContent).toContain("OPENROUTER_API_KEY");
    expect(document.body.textContent).toContain("Grok.com logged-out judged chrome");
    expect(document.body.textContent).toContain("grok-web-judged");
    expect(document.body.textContent).toContain("not grok-web-daily");
    expect(document.body.textContent).toContain("Weekly pauses stay off daily");
    expect(
      [...document.querySelectorAll('a[href="/suites"]')].some((link) =>
        Boolean(link.textContent?.includes("Grok.com weekly manual")),
      ),
    ).toBe(true);
    expect(document.body.textContent).toContain("emulator cannot install Grok");
    expect(document.body.textContent).toContain("do not Recover-kill or dump");
    expect(document.body.textContent).toContain("Lab Mac launchd stays unloaded");
    expect(document.body.textContent).toContain("dev.relay.lab-server");
    expect(document.body.textContent?.match(/2\.5 s/g)).toHaveLength(1);
    expect(document.body.textContent).not.toContain("run-passed-internal");
    expect(document.querySelector('a[href="/runs/run-passed-internal"]')).not.toBeNull();
    expect(document.querySelectorAll("select")).toHaveLength(0);
    expect(document.querySelectorAll('[data-slot="select-trigger"]')).toHaveLength(0);
  });

  it("uses the centered shared recovery state when Runs cannot load", async () => {
    await render(
      "/runs",
      catalog({
        listRuns: async () => {
          throw new TypeError("Failed to fetch");
        },
      }),
    );
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 1_100))));
    await settle();

    const recovery = document.querySelector(".relay-recording-problem");
    expect(recovery?.className).toContain("relay-recovery-state--centered");
    expect(recovery?.getAttribute("data-slot")).toBe("empty");
    expect(recovery?.querySelectorAll('[data-slot="empty-description"]')).toHaveLength(1);
    expect(recovery?.textContent).toContain("The app could not reach the local Relay service.");
    expect(recovery?.textContent).toContain("Try again");
  });

  it("stores useful views in the URL and renders a calm empty state", async () => {
    const { history } = await render("/runs");
    await click("Failed");

    expect(history.location.search).toContain("view=failed");
    expect(document.body.textContent).toContain("Change language");
    expect(document.body.textContent).not.toContain("Complete checkout");

    await fill(document.querySelector<HTMLInputElement>("#run-search")!, "missing");
    expect(document.body.textContent).toContain("No problem Runs match");
    await click("Show all Runs");
    expect(history.location.search).toBe("");
    expect(document.body.textContent).toContain("Complete checkout");
  });

  it("opens a Plan Result grid instead of one Test Run from a Run Across pack", async () => {
    await render(
      "/runs",
      catalog({
        listRuns: async () => [
          ...runs,
          productRun({
            id: "run-plan-upload",
            title: "Upload a file while logged out",
            testName: "Upload a file while logged out",
            testId: "test-grok-web-upload",
            appMapId: "grok-web",
            appName: "Grok.com daily",
            phase: "completed",
            outcome: "passed",
            queuedAt: now - 20_000,
            finishedAt: now - 5_000,
            batchId: "batch-daily",
            caseCount: 8,
            links: { self: "/runs/run-plan-upload", batch: "/batches/batch-daily" },
          }),
          productRun({
            id: "run-plan-imagine",
            title: "Open Imagine",
            testName: "Open Imagine",
            testId: "test-grok-web-imagine",
            appMapId: "grok-web",
            appName: "Grok.com daily",
            phase: "completed",
            outcome: "passed",
            queuedAt: now - 19_000,
            finishedAt: now - 6_000,
            batchId: "batch-daily",
          }),
        ],
      }),
    );

    expect(document.querySelector('a[href="/batches/batch-daily"]')).not.toBeNull();
    expect(document.querySelector('a[href="/runs/run-plan-upload"]')).toBeNull();
    expect(document.body.textContent).toContain("Grok.com daily Result");
    expect(document.body.textContent).toContain("Plan Result");
    expect(document.body.textContent).toContain("8 Tests");
    expect(document.body.textContent).not.toContain("Run Across");
  });

  it("windows very large histories and keeps every rendered Report as a keyboard URL", async () => {
    const largeHistory = Array.from({ length: 500 }, (_, index) =>
      productRun({
        id: `run-${index}`,
        title: `Regression pass ${index + 1}`,
        testName: `Regression pass ${index + 1}`,
        testId: `test-${index}`,
        appMapId: "app-shop-internal",
        appName: "Shopping",
        phase: "completed",
        outcome: "passed",
        queuedAt: now - index * 1_000,
        durationMs: 1_200,
      }),
    );
    await render(
      "/runs?view=all",
      catalog({
        listRuns: async () => largeHistory,
      }),
    );

    const links = document.querySelectorAll<HTMLAnchorElement>("[data-run-index]");
    expect(document.querySelector(".relay-windowed-run-scroll")).not.toBeNull();
    expect(links.length).toBeGreaterThan(0);
    expect(links.length).toBeLessThan(40);
    expect(links[0]?.getAttribute("href")).toBe("/runs/run-0");
    expect(links[0]?.tabIndex).toBe(0);
    expect(links[0]?.closest("li")?.getAttribute("aria-setsize")).toBe("500");

    await act(async () => {
      links[0]?.focus();
      links[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    await settle();

    const last = document.querySelector<HTMLAnchorElement>('[data-run-index="499"]');
    expect(last?.getAttribute("href")).toBe("/runs/run-499");
    expect(document.activeElement).toBe(last);
    expect(document.querySelectorAll("[data-run-index]").length).toBeLessThan(40);
  });
});
