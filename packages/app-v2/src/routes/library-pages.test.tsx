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

// The review inbox is read over the network; Runs only needs its count.
const inbox = vi.hoisted(() => ({ count: 0, appMapIds: [] as (string | undefined)[] }));
vi.mock("../data/review-product-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../data/review-product-service")>();
  return {
    ...actual,
    createReviewProductService: (platform: Platform) => ({
      ...actual.createReviewProductService(platform),
      inbox: async (input: { appMapId?: string } = {}) => {
        inbox.appMapIds.push(input.appMapId);
        return {
          entries: inbox.count
            ? [{ runId: "r1", title: "Sign in", items: Array.from({ length: inbox.count }) }]
            : [],
          totals: {},
          runsConsidered: 1,
        };
      },
    }),
  };
});

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
  inbox.count = 0;
  inbox.appMapIds = [];
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
  it("puts the library first and does not count an older failure as failing", async () => {
    await render("/tests");
    const main = document.querySelector<HTMLElement>("#main-content")!;
    expect(main.querySelector("h1")?.textContent).toBe("Tests");
    expect(main.textContent).toContain("2 tests");
    expect(document.querySelector('[aria-label="Morning review"]')).toBeNull();
    expect(document.querySelector('[aria-label="Resume work"]')).toBeNull();
    // One search replaces the old status/result filter selects.
    expect(main.querySelector('input[aria-label="Search tests"]')).not.toBeNull();
    expect(main.querySelectorAll('[data-slot="select-trigger"]')).toHaveLength(0);
    // "Change language" failed before but passed last, so nothing is failing.
    expect(main.textContent).not.toMatch(/tests? failing/u);
    expect(main.querySelector("#loose-heading")?.textContent).toBe("All tests");
  });
  it("restores the collection scroll container and row focus after browser Back", async () => {
    const { history } = await render("/tests");
    const main = document.querySelector<HTMLElement>("#main-content");
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
    ).toContain("Fix");
    await clickText("Run");
    expect(history.location.pathname).toBe("/tests/test-language-internal");
    expect(history.location.search).toBe("?setup=run");
    expect(history.location.hash).toBe("");
    expect(document.querySelector('[data-slot="test-run-dialog"]')).toBeNull();
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
  it("lists human Test summaries, plans as groups, and a dominant creation action", async () => {
    const { history } = await render(
      "/tests",
      catalog(),
      undefined,
      {} as RunProductService,
      {
        listSuites: async () => [
          {
            id: "suite-1",
            appMapId: "app-shop-internal",
            appMapRevision: 7,
            appName: "Shopping",
            name: "Release smoke",
            testIds: ["test-language-internal"],
            tests: [{ id: "test-language-internal", name: "Change language", status: "ready" }],
            variableIds: [],
            strategy: "cartesian",
            source: { kind: "app-map-combine", id: "suite-1" },
          },
        ],
      } as unknown as SuiteProfileProductService,
    );

    const main = document.querySelector<HTMLElement>("#main-content")!;
    expect(main.textContent).toContain("2 tests · 1 plans");
    expect(main.querySelector('a[href="/tests/new"]')?.textContent?.trim()).toBe("New test");
    expect(
      [...main.querySelectorAll("button")].some(
        (button) => button.textContent?.trim() === "New plan",
      ),
    ).toBe(true);
    expect(main.querySelector("#plans-heading")?.textContent).toBe("Test plans");
    expect(main.textContent).toContain("Release smoke");
    expect(
      main.querySelector('a[href="/apps/app-shop-internal/suites/suite-1"]')?.textContent?.trim(),
    ).toBe("Run all");
    // The collection links that used to sit on this page now live in the
    // sidebar (Devices) or the command palette (Activity, Changes).
    expect(main.querySelector('a[href="/suites"]')).toBeNull();
    expect(main.querySelector('a[href="/changes"]')).toBeNull();
    expect(main.querySelector('a[href="/sessions"]')).toBeNull();
    expect(document.querySelector('a[href="/devices"]')?.textContent?.trim()).toBe("Devices");
    // Collapsed plan: its test is not listed until opened; the rest are "Other tests".
    expect(main.querySelector("#loose-heading")?.textContent).toBe("Other tests");
    expect(main.textContent).not.toContain("Change language");
    expect(main.textContent).toContain("Complete checkout");
    expect(main.textContent).toContain("Needs setup");
    expect(main.textContent).not.toContain("app-shop-internal");
    expect(main.textContent).not.toContain("test-language-internal");
    expect(document.querySelectorAll("select")).toHaveLength(0);

    const search = main.querySelector<HTMLInputElement>('input[aria-label="Search tests"]')!;
    search.focus();
    expect(document.activeElement).toBe(search);
    await fill(search, "language");
    // Searching flattens plans away and finds the planned test too.
    expect(main.querySelector("#plans-heading")).toBeNull();
    expect(main.textContent).toContain("Change language");
    expect(main.textContent).toContain("Passed");
    expect(main.textContent).not.toContain("Complete checkout");
    expect(history.location.search).toBe("?q=language");

    await act(async () =>
      main.querySelector<HTMLElement>('a[href="/tests/test-language-internal"]')?.click(),
    );
    await settle();
    expect(history.location.pathname).toBe("/tests/test-language-internal");
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

    const recovery = document.querySelector('[data-slot="recovery-centered"]');
    expect(recovery).not.toBeNull();
    expect(recovery?.getAttribute("role")).toBe("alert");
    expect(recovery?.querySelectorAll("h2")).toHaveLength(1);
    expect(recovery?.textContent).toContain("The app could not reach the local Relay service.");
    expect(recovery?.textContent).toContain("Try again");
  });

  it("keeps the failing filter in the route and clears back to the grouped list", async () => {
    const { history } = await render(
      "/tests?result=failed",
      catalog({
        listTests: async () => [
          {
            ...tests[0]!,
            recentRun: { ...passedRun, phase: "failed", outcome: "product-failure" },
          },
          tests[1]!,
        ],
      }),
    );
    const matches = document.querySelector('section[aria-label="Matching tests"]')!;
    expect(matches.textContent).toContain("1 test failing");
    expect(matches.textContent).toContain("Change language");
    expect(matches.textContent).not.toContain("Complete checkout");

    await fill(
      document.querySelector<HTMLInputElement>('input[aria-label="Search tests"]')!,
      "missing",
    );
    expect(matches.textContent).toContain("0 tests failing");
    expect(matches.querySelectorAll("li")).toHaveLength(0);
    await click("Clear");
    expect(history.location.search).toBe("");
    expect(document.querySelector('section[aria-label="Matching tests"]')).toBeNull();
    expect(document.body.textContent).toContain("Change language");
    expect(document.body.textContent).toContain("Complete checkout");
  });

  it("does not invent Suites from Test checkboxes", async () => {
    await render("/tests");
    expect(document.querySelector("#loose-heading")?.textContent).toBe("All tests");
    expect(document.querySelector("#plans-heading")).toBeNull();
    expect(document.querySelectorAll('[data-slot="library-row-select"]')).toHaveLength(0);
    expect(document.querySelectorAll('#main-content [role="checkbox"]')).toHaveLength(0);
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
    const chip = document.querySelector<HTMLAnchorElement>(
      '[aria-label="Needs you"] a[href="/recordings/workflow-shop"]',
    );
    expect(chip?.textContent).toContain("Untitled recording");
    expect(chip?.textContent).toContain("Continue recording");
  });

  it("does not hide a recording whose App ownership is still unknown", async () => {
    await render("/tests?app=app-shop-internal", catalog(), undefined, undefined, undefined, {
      platform: platformWithPointer("workflow-unknown"),
      productService: recordingInspect(),
    });

    const chip = document.querySelector<HTMLAnchorElement>(
      '[aria-label="Needs you"] a[href="/recordings/workflow-unknown"]',
    );
    expect(chip?.textContent).toContain("Continue recording");
  });

  it("hides a recording resume that belongs to a different App", async () => {
    await render("/tests?app=app-bank-internal", catalog(), undefined, undefined, undefined, {
      platform: platformWithPointer("workflow-shop"),
      productService: recordingInspect("app-shop-internal"),
    });

    expect(document.querySelector("#main-content")?.textContent).not.toContain(
      "Continue recording",
    );
    expect(document.querySelector('#main-content a[href="/recordings/workflow-shop"]')).toBeNull();
  });
});

describe("Runs workspace", () => {
  it("folds screenshot review into Runs with a count and a focused review entry", async () => {
    inbox.count = 3;
    await render("/runs?app=app-shop-internal", catalog({ listRuns: async () => [passedRun] }));
    const main = document.querySelector("main")!;
    expect(main.querySelector("h1")?.textContent).toBe("Runs");
    expect(main.textContent).toContain("Everything that ran, newest first.");
    const tab = [...main.querySelectorAll('[role="tab"]')].find((item) =>
      item.textContent?.startsWith("Needs review"),
    );
    expect(tab?.textContent).toBe("Needs review3");
    const review = main.querySelector<HTMLAnchorElement>('a[href^="/review"]');
    expect(review?.textContent).toBe("Review screenshots (3)");
    expect(review?.getAttribute("href")).toBe("/review?app=app-shop-internal");
    expect(inbox.appMapIds).toContain("app-shop-internal");
  });

  it("hides the review entry when no screenshots are waiting", async () => {
    await render("/runs", catalog({ listRuns: async () => [passedRun] }));
    expect(document.querySelector('main a[href^="/review"]')).toBeNull();
  });

  it("shows completed collection separately from screenshots waiting for review", async () => {
    await render(
      "/runs?view=needs-review",
      catalog({
        listRuns: async () => [
          {
            ...passedRun,
            captureSummary: {
              captured: 8,
              pending: 8,
              accepted: 0,
              missing: 0,
              issue: 0,
              needMoreEvidence: 0,
            },
          },
        ],
      }),
    );
    // The run outcome stays Passed; waiting screenshots are counted beside it.
    const row = document.querySelector('a[href="/runs/run-passed-internal"]');
    expect(row?.textContent).toContain("Passed");
    expect(row?.textContent).toContain("8 to review");
    expect(row?.textContent).not.toContain("Needs review");
  });

  it("keeps the whole Plan outcome when searching for one successful Test", async () => {
    const planRuns = [
      productRun({
        id: "ok",
        title: "Morning QA · Open home",
        testName: "Open home",
        batchId: "mixed",
        phase: "completed",
        outcome: "passed",
        queuedAt: now - 1000,
      }),
      productRun({
        id: "failed",
        title: "Morning QA · Settings",
        testName: "Settings",
        batchId: "mixed",
        phase: "failed",
        outcome: "harness-failure",
        queuedAt: now - 900,
      }),
    ];
    await render("/runs?q=Open%20home", catalog({ listRuns: async () => planRuns }));
    const row = document.querySelector('a[href="/batches/mixed"]');
    expect(row?.textContent).toContain("Could not complete");
    expect(row?.textContent).toContain("2 Tests");
    expect(row?.textContent).not.toContain("Passed");
  });

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
    expect(document.body.textContent).toContain("That is everything Relay has kept.");
    expect(document.body.textContent).toContain("Open account");
  });

  it("keeps loaded results visible when polling fails and recovers on retry", async () => {
    let unavailable = false;
    const listRuns = vi.fn(async () => {
      if (unavailable) throw new TypeError("Failed to fetch");
      return runs;
    });
    await render("/runs", catalog({ listRuns }));
    const row = document.querySelector('a[href="/runs/run-passed-internal"]');
    expect(row).not.toBeNull();
    unavailable = true;
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 4_300))));
    await settle();
    expect(listRuns.mock.calls.length).toBeGreaterThan(1);
    expect(document.querySelector('a[href="/runs/run-passed-internal"]')).toBe(row);
    expect(document.body.textContent).toContain("Couldn’t refresh runs");
    unavailable = false;
    await click("Refresh");
    await settle();
    expect(document.querySelector('a[href="/runs/run-passed-internal"]')).toBe(row);
    expect(document.body.textContent).not.toContain("Couldn’t refresh runs");
  }, 10_000);

  it("keeps the Run view tabs on their own rail above the filters", async () => {
    await render("/runs");

    const tabs = document.querySelector('[data-slot="tabs"]');
    const filters = document.querySelector('[aria-label="Filter Runs"]');
    expect(tabs?.className).not.toContain("border-b");
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
    expect(document.querySelector('[aria-label="Morning review"]')).toBeNull();
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

    const recovery = document.querySelector('[data-slot="recovery-centered"]');
    expect(recovery).not.toBeNull();
    expect(recovery?.getAttribute("role")).toBe("alert");
    expect(recovery?.querySelectorAll("h2")).toHaveLength(1);
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
    expect(document.body.textContent).toContain("Nothing failed");
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
    expect(document.querySelector('[data-slot="windowed-run-scroll"]')).not.toBeNull();
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
