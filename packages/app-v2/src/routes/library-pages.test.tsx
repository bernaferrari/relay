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

async function render(
  path: string,
  service = catalog(),
  mapService?: MapProductService,
  runService: RunProductService = {} as RunProductService,
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
        productService={{} as RecordingProductService}
        runService={runService}
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

    expect(filters).toContain("tests:app-shop-internal");
    expect(filters).toContain("runs:app-shop-internal");
    expect(document.body.textContent).toContain("Saved journeys");
    expect(document.body.textContent).toContain("Recent results");
    expect(document.body.textContent).toContain("2 of 3");
    expect(document.querySelector('a[href="/tests/new?app=app-shop-internal"]')).not.toBeNull();
    const advanced = [...document.querySelectorAll("button")].find(
      (item) => item.textContent?.trim() === "Advanced",
    );
    if (!advanced) throw new Error("Advanced disclosure not found");
    await act(async () => advanced.click());
    await settle();
    expect(document.querySelector('a[href="/apps/app-shop-internal/map"]')).not.toBeNull();
  });
});

describe("Tests library", () => {
  it("runs a ready Test from the row with an explicit target", async () => {
    const start = vi.fn(async () => ({ workflow: { workflowId: "workflow-library" } }));
    let inspectAttempts = 0;
    const inspect = vi.fn(async () => {
      inspectAttempts += 1;
      if (inspectAttempts === 1) throw new Error("temporary inspection failure");
      return { run: { runId: "run-library" } };
    });
    const runService = {
      listTargets: async () => [
        {
          kind: "browser" as const,
          targetId: "browser-library",
          name: "Staging browser",
          detail: "Chrome · staging",
        },
      ],
      start,
      inspect,
    } as unknown as RunProductService;
    const storage = new Map<string, string>();
    const runPlatform = {
      ...platform,
      storage: {
        get: (key: string) => storage.get(key) ?? null,
        set: (key: string, value: string) => void storage.set(key, value),
        remove: (key: string) => void storage.delete(key),
      },
    };
    const history = createMemoryHistory({ initialEntries: ["/tests"] });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <RelayV2App
          platform={runPlatform}
          history={history}
          productService={{} as RecordingProductService}
          runService={runService}
          catalogService={catalog()}
        />,
      );
    });
    await settle();
    expect(
      document.querySelector('a[href="/tests/test-checkout-internal/edit"]')?.textContent,
    ).toContain("Review steps");
    await clickText("Run");
    expect(document.body.textContent).toContain("Choose a ready device or browser");
    await clickText("Staging browser");
    await clickText("Start Run");
    expect(document.body.textContent).toContain("Relay could not complete this request");
    expect(document.body.textContent).toContain("Run started. Retry to finish opening it.");
    expect(
      document.querySelector<HTMLInputElement>('input[value="browser-library"]')?.disabled,
    ).toBe(true);
    await clickText("Try again");
    await settle();
    expect(start).toHaveBeenCalledWith({
      testId: "test-language-internal",
      appMapId: "app-shop-internal",
      targetId: "browser-library",
    });
    expect(inspect.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(start).toHaveBeenCalledTimes(1);
    expect(storage.has("activeRunWorkflow")).toBe(true);
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

    const changes = document.querySelector<HTMLAnchorElement>('a[href="/changes"]');
    expect(changes?.className).not.toContain("relay-nav-link--quiet");
    expect(changes?.textContent?.trim()).toBe("Changes");
    expect(changes?.hasAttribute("aria-disabled")).toBe(false);
    expect(document.querySelector('a[href="/tests/new"]')?.textContent).toBe("New Test");
    expect(document.body.textContent).toContain("Change language");
    expect(document.body.textContent).toContain("Complete checkout");
    expect(document.body.textContent).toContain("Passed");
    expect(document.body.textContent).toContain("Not run yet");
    expect(document.body.textContent).not.toContain("app-shop-internal");
    expect(document.body.textContent).not.toContain("test-language-internal");
    expect(document.querySelectorAll("select")).toHaveLength(0);
    expect(document.querySelectorAll('[data-slot="select-trigger"]')).toHaveLength(3);
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

  it("defaults to the latest Run per Test and keeps every row durably addressable", async () => {
    await render("/runs");

    expect(document.body.textContent?.match(/Change language/g)).toHaveLength(1);
    expect(document.body.textContent).toContain("Complete checkout");
    expect(document.body.textContent).toContain("Open account");
    expect(document.body.textContent).toContain("Needs review");
    expect(document.body.textContent).toContain("Running");
    expect(document.body.textContent?.match(/2\.5 s/g)).toHaveLength(1);
    expect(document.body.textContent).not.toContain("run-passed-internal");
    expect(document.querySelector('a[href="/runs/run-passed-internal"]')).not.toBeNull();
    expect(document.querySelectorAll("select")).toHaveLength(0);
    expect(document.querySelectorAll('[data-slot="select-trigger"]')).toHaveLength(1);
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
    await click("Show latest Runs");
    expect(history.location.search).toBe("");
    expect(document.body.textContent).toContain("Complete checkout");
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
