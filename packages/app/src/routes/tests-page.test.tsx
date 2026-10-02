/** @jsxImportSource react */
import type { ProductRunSummary, ProductTestSummary } from "@relay/product/catalog";
import type { ReviewInboxResult } from "@relay/protocol";
import { createMemoryHistory } from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RelayApp } from "../app";
import type { CatalogProductService } from "../data/catalog-product-service";
import type { RecordingProductService } from "../data/recording-product-service";
import type { RunProductService } from "../data/run-product-service";
import type {
  ProductSuite,
  SuiteProfileProductService,
} from "../data/suite-profile-product-service";
import type { Platform } from "../platform/types";

// The review inbox is read over the network; the Tests home only needs its counts.
const inbox = vi.hoisted(() => ({ current: undefined as ReviewInboxResult | undefined }));
vi.mock("../data/review-product-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../data/review-product-service")>();
  return {
    ...actual,
    createReviewProductService: (platform: Platform) => ({
      ...actual.createReviewProductService(platform),
      inbox: async () => {
        if (!inbox.current) throw new TypeError("Failed to fetch");
        return inbox.current;
      },
    }),
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const now = Date.now();

beforeEach(() => {
  inbox.current = undefined;
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline test fixture")));
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function run(
  input: Pick<ProductRunSummary, "id" | "phase"> & Partial<ProductRunSummary>,
): ProductRunSummary {
  return {
    title: input.id,
    action: "test",
    status: input.phase,
    queuedAt: now - 60_000,
    identity: { runId: input.id },
    links: { self: `/runs/${input.id}` },
    ...input,
  };
}

function test(
  input: Pick<ProductTestSummary, "id" | "name"> & Partial<ProductTestSummary>,
): ProductTestSummary {
  return {
    appMapId: "app-shop",
    appName: "Shopping",
    stepCount: 3,
    status: "ready",
    updatedAt: now - 100_000,
    href: `/tests/${input.id}`,
    ...input,
  };
}

const login = test({
  id: "test-login",
  name: "Sign in",
  recentRun: run({ id: "run-login", phase: "completed", outcome: "passed", testId: "test-login" }),
});
const cart = test({
  id: "test-cart",
  name: "Add to cart",
  recentRun: run({
    id: "run-cart",
    phase: "failed",
    outcome: "product-failure",
    testId: "test-cart",
  }),
});
const invoice = test({
  id: "test-invoice",
  name: "Pay invoice",
  appMapId: "app-bank",
  appName: "Banking",
});
const catalogTests = [login, cart, invoice] as const;

const smoke: ProductSuite = {
  id: "suite-smoke",
  appMapId: "app-shop",
  appMapRevision: 3,
  appName: "Shopping",
  name: "Release smoke",
  testIds: ["test-login", "test-cart"],
  tests: [
    { id: "test-login", name: "Sign in", status: "ready" },
    { id: "test-cart", name: "Add to cart", status: "ready" },
  ],
  variableIds: [],
  strategy: "cartesian",
  referenceReviewMode: "human",
  source: { kind: "app-map-combine", id: "suite-smoke" },
};

function storagePlatform(values: Record<string, string> = {}): Platform {
  const store = new Map(Object.entries(values));
  return {
    platform: "web",
    getServerUrl: () => "http://127.0.0.1:8787",
    storage: {
      get: (key) => store.get(key) ?? null,
      set: (key, value) => void store.set(key, value),
      remove: (key) => void store.delete(key),
    },
  };
}

async function render(
  path: string,
  options: {
    tests?: readonly ProductTestSummary[];
    runs?: readonly ProductRunSummary[];
    suites?: readonly ProductSuite[];
    platform?: Platform;
    productService?: RecordingProductService;
  } = {},
) {
  const history = createMemoryHistory({ initialEntries: [path] });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const catalogService: CatalogProductService = {
    listTests: async () => options.tests ?? catalogTests,
    getTest: async () => undefined,
    listRuns: async () => options.runs ?? [],
    getRun: async () => undefined,
  };
  await act(async () => {
    root.render(
      <RelayApp
        platform={options.platform ?? storagePlatform()}
        history={history}
        productService={
          options.productService ??
          ({ listApps: async () => [] } as unknown as RecordingProductService)
        }
        runService={{} as RunProductService}
        catalogService={catalogService}
        suiteProfileService={
          {
            listSuites: async () => options.suites ?? [smoke],
          } as unknown as SuiteProfileProductService
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

function main() {
  return document.querySelector<HTMLElement>("#main-content")!;
}

function needsYou() {
  return document.querySelector<HTMLElement>('[aria-label="Needs you"]');
}

async function search(value: string) {
  const input = main().querySelector<HTMLInputElement>('input[aria-label="Search tests"]')!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

async function press(element: HTMLElement | null | undefined) {
  if (!element) throw new Error("Control not found");
  await act(async () => element.click());
  await settle();
}

function buttonNamed(label: string, scope: ParentNode = document) {
  return [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === label,
  );
}

describe("Tests home", () => {
  it("offers a scoped first test when only other Apps have tests", async () => {
    await render("/tests?app=app-empty");
    expect(main().textContent).toContain("No tests for this App yet");
    const links = [...main().querySelectorAll<HTMLAnchorElement>('a[href^="/tests/new"]')];
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => new URL(link.href).searchParams.get("app") === "app-empty")).toBe(
      true,
    );
    expect(main().textContent).not.toContain("Pay invoice");
  });
  it("summarizes tests and plans for the chosen App", async () => {
    await render("/tests?app=app-shop");
    expect(main().querySelector("h1")?.textContent).toBe("Tests");
    // Banking's invoice test is out of scope.
    expect(main().textContent).toContain("2 tests · 1 plan");
    expect(main().textContent).not.toContain("Pay invoice");
  });

  it("uses singular test wording when one Test belongs to the chosen App", async () => {
    await render("/tests?app=app-bank");
    expect(main().textContent).toContain("1 test");
    expect(main().textContent).not.toContain("1 tests");
  });

  it("groups a plan's tests under its card, shown on expand, and lists the rest as Other tests", async () => {
    await render("/tests");
    const plans = main().querySelector<HTMLElement>('section[aria-labelledby="plans-heading"]')!;
    const toggle = plans.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
    expect(toggle.textContent).toContain("Release smoke");
    expect(toggle.textContent).toContain("Shopping · 2 tests");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(plans.querySelector('a[href="/tests/test-login"]')).toBeNull();
    expect(
      plans.querySelector('a[href="/apps/app-shop/suites/suite-smoke"]')?.textContent?.trim(),
    ).toBe("Run all");

    const other = main().querySelector<HTMLElement>('section[aria-labelledby="loose-heading"]')!;
    expect(other.querySelector("h2")?.textContent).toBe("Other tests");
    expect(other.textContent).toContain("Tests that are not in a plan yet.");
    expect(other.querySelector('a[href="/tests/test-invoice"]')).not.toBeNull();
    expect(other.querySelector('a[href="/tests/test-login"]')).toBeNull();
    expect(other.querySelector('a[href="/tests/test-cart"]')).toBeNull();

    await press(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const panel = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(panel).not.toBeNull();
    const memberLinks = [
      ...panel.querySelectorAll<HTMLAnchorElement>("li a[href^='/tests/test-']"),
    ].filter((link) => !link.href.includes("setup="));
    expect(memberLinks.map((link) => new URL(link.href).pathname)).toEqual([
      "/tests/test-login",
      "/tests/test-cart",
    ]);
    for (const link of memberLinks) {
      const url = new URL(link.href);
      expect(url.searchParams.get("plan")).toBe("suite-smoke");
      expect(url.searchParams.get("planApp")).toBe("app-shop");
      expect(link.textContent).toContain("3 steps");
    }
    expect(panel.textContent).toContain("Passed");

    await press(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(plans.querySelector('a[href="/tests/test-login"]')).toBeNull();
  });

  it("restores the expanded plan from the return URL", async () => {
    await render("/tests?plan=suite-smoke&planApp=app-shop");
    const plans = main().querySelector<HTMLElement>('section[aria-labelledby="plans-heading"]')!;
    expect(plans.querySelector('button[aria-expanded="true"]')?.textContent).toContain(
      "Release smoke",
    );
    expect(plans.querySelector('a[href^="/tests/test-login?"]')).not.toBeNull();
    expect(plans.querySelector('a[href^="/tests/test-cart?"]')).not.toBeNull();
  });

  it("titles the list All tests when there are no plans", async () => {
    await render("/tests", { suites: [] });
    expect(main().querySelector('section[aria-labelledby="plans-heading"]')).toBeNull();
    const all = main().querySelector<HTMLElement>('section[aria-labelledby="loose-heading"]')!;
    expect(all.querySelector("h2")?.textContent).toBe("All tests");
    for (const id of ["test-login", "test-cart", "test-invoice"]) {
      expect(all.querySelector(`a[href="/tests/${id}"]`)).not.toBeNull();
    }
  });

  it("turns the failing chip into a flat, URL-backed list of failing tests", async () => {
    const { history } = await render("/tests");
    const chip = buttonNamed("1 test failing", needsYou() ?? document);
    expect(chip).toBeTruthy();

    await press(chip);
    expect(history.location.search).toBe("?result=failed");
    expect(main().querySelector('section[aria-labelledby="plans-heading"]')).toBeNull();
    const matches = main().querySelector<HTMLElement>('section[aria-label="Matching tests"]')!;
    expect(matches.textContent).toContain("1 test failing");
    expect(matches.querySelector('a[href="/tests/test-cart"]')).not.toBeNull();
    expect(matches.querySelector('a[href="/tests/test-login"]')).toBeNull();
    expect(matches.querySelector('a[href="/tests/test-invoice"]')).toBeNull();

    await press(buttonNamed("Clear", matches));
    expect(history.location.search).toBe("");
    expect(main().querySelector('section[aria-label="Matching tests"]')).toBeNull();
    expect(main().querySelector('section[aria-labelledby="plans-heading"]')).not.toBeNull();
  });

  it("hides the failing chip when the failing test belongs to another App", async () => {
    await render("/tests?app=app-bank");
    expect(needsYou()).toBeNull();
    expect(main().textContent).not.toMatch(/failing/u);
  });

  it("flattens plans away while searching and finds planned tests too", async () => {
    const { history } = await render("/tests");
    await search("cart");
    expect(history.location.search).toBe("?q=cart");
    expect(main().querySelector('section[aria-labelledby="plans-heading"]')).toBeNull();
    expect(main().querySelector('section[aria-labelledby="loose-heading"]')).toBeNull();
    const matches = main().querySelector<HTMLElement>('section[aria-label="Matching tests"]')!;
    expect(matches.textContent).toContain("1 test");
    expect(matches.querySelector('a[href="/tests/test-cart"]')).not.toBeNull();
    expect(matches.querySelector('a[href="/tests/test-login"]')).toBeNull();

    // App names match too.
    await search("banking");
    expect(matches.querySelector('a[href="/tests/test-invoice"]')).not.toBeNull();
    expect(matches.querySelector('a[href="/tests/test-cart"]')).toBeNull();

    await press(buttonNamed("Clear", matches));
    expect(history.location.search).toBe("");
    expect(main().querySelector<HTMLInputElement>('input[aria-label="Search tests"]')?.value).toBe(
      "",
    );
    expect(main().querySelector('section[aria-labelledby="plans-heading"]')).not.toBeNull();
  });

  it("restores a search from the URL", async () => {
    await render("/tests?q=sign");
    expect(main().querySelector<HTMLInputElement>('input[aria-label="Search tests"]')?.value).toBe(
      "sign",
    );
    const matches = main().querySelector<HTMLElement>('section[aria-label="Matching tests"]')!;
    expect(matches.querySelector('a[href="/tests/test-login"]')).not.toBeNull();
    expect(matches.querySelectorAll("li")).toHaveLength(1);
  });

  it("links an in-progress recording chip to that recording", async () => {
    const inspect = vi.fn(async () => ({
      status: "recording",
      targets: [],
      snapshot: {
        stage: "recording",
        frozen: { title: "Checkout draft", appMapId: "app-shop" },
      },
    }));
    const { history } = await render("/tests", {
      platform: storagePlatform({ activeRecordingWorkflowId: "workflow-7" }),
      productService: { listApps: async () => [], inspect } as unknown as RecordingProductService,
    });
    expect(inspect).toHaveBeenCalledWith("workflow-7");
    const chip = needsYou()?.querySelector<HTMLAnchorElement>('a[href="/recordings/workflow-7"]');
    expect(chip?.textContent).toContain("Checkout draft");
    expect(chip?.textContent).toContain("Continue recording");

    await press(chip);
    expect(history.location.pathname).toBe("/recordings/workflow-7");
  });

  it("asks to review steps once a recording has stopped, and drops finished recordings", async () => {
    let stage = "reviewing";
    const inspect = vi.fn(async () => ({
      status: "reviewing",
      targets: [],
      snapshot: { stage },
    }));
    await render("/tests", {
      platform: storagePlatform({ activeRecordingWorkflowId: "workflow-8" }),
      productService: { listApps: async () => [], inspect } as unknown as RecordingProductService,
    });
    const chip = needsYou()?.querySelector('a[href="/recordings/workflow-8"]');
    expect(chip?.textContent).toContain("Recording");
    expect(chip?.textContent).toContain("Review steps");

    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    document.body.replaceChildren();
    stage = "committed";
    await render("/tests", {
      platform: storagePlatform({ activeRecordingWorkflowId: "workflow-8" }),
      productService: { listApps: async () => [], inspect } as unknown as RecordingProductService,
    });
    expect(document.querySelector('#main-content a[href="/recordings/workflow-8"]')).toBeNull();
  });

  it("offers to watch the run this person started while it is still going", async () => {
    await render("/tests", {
      platform: storagePlatform({
        activeRunWorkflow: JSON.stringify({
          workflowId: "wf-run",
          runId: "run-live",
          testId: "test-login",
        }),
      }),
      runs: [run({ id: "run-live", phase: "running", testName: "Sign in", appMapId: "app-shop" })],
    });
    const chip = needsYou()?.querySelector<HTMLAnchorElement>('a[href="/runs/run-live"]');
    expect(chip?.textContent).toContain("Sign in");
    expect(chip?.textContent).toContain("Watch");
  });

  it("links screenshots waiting for review, counting only the chosen App", async () => {
    inbox.current = {
      entries: [
        { runId: "r1", title: "Sign in", appMapId: "app-shop", finishedAt: now, items: [{}, {}] },
        { runId: "r2", title: "Pay", appMapId: "app-bank", finishedAt: now, items: [{}] },
      ],
      totals: {},
      runsConsidered: 2,
    } as unknown as ReviewInboxResult;

    await render("/tests");
    const all = needsYou()?.querySelector<HTMLAnchorElement>('a[href="/review"]');
    expect(all?.textContent).toContain("3 screenshots to review");

    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    document.body.replaceChildren();
    await render("/tests?app=app-bank");
    const scoped = needsYou()?.querySelector<HTMLAnchorElement>('a[href="/review"]');
    expect(scoped?.textContent).toContain("1 screenshot to review");
  });

  it("shows no attention strip when nothing needs the person", async () => {
    await render("/tests", { tests: [login, invoice] });
    expect(needsYou()).toBeNull();
  });
});
